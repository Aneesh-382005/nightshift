import fs from 'node:fs';
import path from 'node:path';
import { tables, type DbConnection } from '../../common/src/module_bindings/index.js';
import type { AccessGrant } from '../../common/src/module_bindings/types.js';
import { inverseFrom, takeAll, verifyRestored, type Snap, type SnapStep } from './snapshot.js';
import type { Target } from './targets.js';
import { STATE_DIR } from './spacetime.js';
import { Monitor } from './monitor.js';
import { clip, sleep } from './util.js';

interface Plan {
  snapshots?: SnapStep[]; inverse?: string; health?: string; timeoutS?: number;
  runbookId?: string; deviceType?: string; healthWaitS?: number;   // healthWaitS is optional, default 6
}
interface LedgerEntry { grantId: string; inverse: string; snaps: Snap[] }

const CAPS = ['shell.read', 'shell.write', 'shell.destructive'];

function parsePlan(s: string): Plan {
  try { const p = JSON.parse(s || '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; }
}

/**
 * Runs approved grants for ONE device. Rules:
 * - each active grant targeting this device runs exactly once (in-memory set plus run_result check)
 * - consumeGrant is called before anything touches the target
 * - rollbacks only run for changes this executor recorded itself (ledger), never for rows someone else inserted
 * - one job at a time per device
 */
export class DeviceExecutor {
  private seen = new Set<string>();
  private ready = false;
  private chain: Promise<void> = Promise.resolve();
  private ledger = new Map<string, LedgerEntry>();   // change id -> entry
  private ledgerFile: string;
  private timer?: NodeJS.Timeout;
  private active = 0;
  monitor?: Monitor;

  constructor(readonly target: Target, readonly conn: DbConnection, private caps = CAPS) {
    this.ledgerFile = path.join(STATE_DIR, `${target.id}.ledger.json`);
    try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(this.ledgerFile, 'utf8')))) this.ledger.set(k, v as LedgerEntry); } catch { /* none yet */ }
  }

  private log(msg: string) { console.log(`[${this.target.id}] ${msg}`); }
  private event(kind: string, grantId: bigint, detail: string) {
    this.conn.reducers.logEvent({ kind, device: this.target.id, grantId, detail: clip(detail, 500) }).catch(() => {});
  }
  private saveLedger() {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(this.ledgerFile, JSON.stringify(Object.fromEntries(this.ledger)));
  }
  private enqueue(job: () => Promise<void>) {
    this.active++;
    this.chain = this.chain.then(job).catch(e => this.log(`job error: ${e?.stack ?? e}`)).finally(() => { this.active--; });
  }

  async start() {
    const t = this.target;
    await this.conn.reducers.registerDevice({ id: t.id, name: t.name, kind: t.kind, capabilities: this.caps });
    this.timer = setInterval(() => {
      this.conn.reducers.heartbeat({ id: t.id }).catch(e => this.log(`heartbeat: ${e?.message ?? e}`));
    }, 2000);

    await new Promise<void>((resolve, reject) => {
      this.conn.subscriptionBuilder()
        .onApplied(() => resolve())
        .onError(ctx => reject(new Error(String(ctx.event))))
        .subscribe([
          tables.accessGrant.where(r => r.target.eq(t.id)),
          tables.runResult.where(r => r.device.eq(t.id)),
          tables.change.where(r => r.device.eq(t.id)),
          tables.event.where(r => r.device.eq(t.id)),
          tables.incident.where(r => r.device.eq(t.id)),
        ]);
    });

    this.conn.db.accessGrant.onInsert((_c, g) => this.consider(g));
    this.conn.db.accessGrant.onUpdate((_c, _o, g) => this.consider(g));
    this.conn.db.event.onInsert((_c, e) => {
      if (this.ready && e.kind === 'rollback.requested' && e.device === t.id) {
        const id = e.detail.trim();
        this.enqueue(() => this.handleRollbackRequest(id));
      }
    });
    this.ready = true;
    for (const g of this.conn.db.accessGrant.iter()) this.consider(g);   // grants approved while we were down
    if (process.env.NIGHTSHIFT_MONITOR !== '0') {
      this.monitor = new Monitor(t, this.conn, {
        busy: () => this.active > 0,
        incidentOpen: () => { for (const i of this.conn.db.incident.iter()) if (i.device === t.id && i.status === 'open') return true; return false; },
        alertUrl: process.env.NIGHTSHIFT_ALERT_URL ?? 'http://127.0.0.1:8787/alert',
      });
      this.monitor.start();
    }
    this.log(`online (${t.name})`);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.monitor?.stop(); }

  private consider(g: AccessGrant) {
    if (!this.ready || g.target !== this.target.id || g.status !== 'active' || !CAPS.includes(g.capability)) return;
    const key = String(g.id);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.conn.db.runResult.grantId.find(g.id)) return;   // already executed (maybe before a restart)
    this.enqueue(() => this.runGrant(g));
  }

  private async runGrant(g: AccessGrant) {
    const t = this.target;
    const plan = parsePlan(g.plan);
    const write = g.capability !== 'shell.read';
    const timeoutS = Math.min(Math.max(Number(plan.timeoutS) || 30, 1), 120);
    const result = (exitCode: number, output: string, healthOk: boolean, rolledBack: boolean) =>
      this.conn.reducers.recordResult({ grantId: g.id, device: t.id, exitCode, output: clip(output, 3800), healthOk, rolledBack });

    try { await this.conn.reducers.consumeGrant({ grantId: g.id }); }
    catch (e: any) { this.log(`grant ${g.id} not consumable, skipped: ${e?.message ?? e}`); return; }
    this.log(`grant ${g.id} ${g.capability}: ${g.command}`);

    let snaps: Snap[] = [];
    if (write && plan.snapshots?.length) {
      try { snaps = await takeAll(t, plan.snapshots); }
      catch (e: any) {
        this.log(`snapshot failed, command NOT run: ${e.message}`);
        await result(-2, `snapshot failed, command not run: ${e.message}`, false, false);
        return;
      }
    }

    const res = await t.run(g.command, timeoutS);
    this.log(`  exit ${res.code}${res.timedOut ? ' (timeout)' : ''}`);

    let inverse = '';
    let change: bigint | undefined;
    if (write) {
      inverse = (plan.inverse ?? '').trim() || inverseFrom(snaps);
      await this.conn.reducers.recordChange({
        grantId: g.id, device: t.id, command: g.command,
        preState: JSON.stringify(snaps), inverseCommand: inverse, irreversible: !inverse,
      });
      change = await this.findChange(g.id);
      if (change !== undefined && inverse) {
        this.ledger.set(String(change), { grantId: String(g.id), inverse, snaps });
        this.saveLedger();
      }
    }

    // Health: no health command means exit 0 is the verdict.
    let healthOk = res.code === 0;
    if (healthOk && plan.health) healthOk = await this.waitHealthy(plan.health, plan.healthWaitS ?? 6);
    this.log(`  health ${healthOk ? 'ok' : 'FAILED'}`);

    let rolledBack = false;
    let note = '';
    if (write && !healthOk) {
      if (change !== undefined && inverse) {
        this.log('  auto-rollback');
        const rb = await this.rollback(change, g.id);
        rolledBack = rb.ok;
        note = rb.ok ? '\n[auto-rolled back]' : `\n[auto-rollback FAILED: ${rb.why}]`;
      } else note = '\n[no inverse available, not rolled back]';
    }
    await result(res.code, res.output + note, healthOk, rolledBack);
  }

  private async waitHealthy(cmd: string, waitS: number): Promise<boolean> {
    const deadline = Date.now() + waitS * 1000;
    for (;;) {
      if ((await this.target.run(cmd, 10)).code === 0) return true;
      if (Date.now() + 1000 > deadline) return false;
      await sleep(1000);
    }
  }

  /** The change row arrives over the subscription after recordChange resolves. */
  private async findChange(grantId: bigint): Promise<bigint | undefined> {
    for (let i = 0; i < 25; i++) {
      let best: bigint | undefined;
      for (const c of this.conn.db.change.iter()) if (c.grantId === grantId && c.device === this.target.id && (best === undefined || c.id > best)) best = c.id;
      if (best !== undefined) return best;
      await sleep(200);
    }
    this.log(`change row for grant ${grantId} never appeared`);
    return undefined;
  }

  private async rollback(changeId: bigint, grantId: bigint): Promise<{ ok: boolean; why?: string }> {
    const entry = this.ledger.get(String(changeId));
    if (!entry) return { ok: false, why: 'not in executor ledger' };
    const r = await this.target.run(entry.inverse, 30);
    if (r.code !== 0) {
      this.event('rollback.failed', grantId, `change ${changeId}: inverse exit ${r.code}: ${r.output}`);
      return { ok: false, why: `inverse exit ${r.code}: ${r.output.slice(0, 200)}` };
    }
    if (entry.snaps.length) {
      const diff = await verifyRestored(this.target, entry.snaps);
      if (diff) {
        this.event('rollback.mismatch', grantId, `change ${changeId}: ${diff}`);
        return { ok: false, why: `state differs after inverse: ${diff}` };
      }
    }
    await this.conn.reducers.markChange({ changeId, status: 'rolled_back' });
    this.ledger.delete(String(changeId));
    this.saveLedger();
    return { ok: true };
  }

  private async handleRollbackRequest(idStr: string) {
    if (!/^\d+$/.test(idStr)) return;
    const id = BigInt(idStr);
    const row = this.conn.db.change.id.find(id);
    if (!row || row.device !== this.target.id) return;
    if (row.status !== 'applied') { this.log(`rollback ${id}: status is ${row.status}, ignored`); return; }
    this.log(`rollback requested for change ${id}: ${row.command}`);
    const rb = await this.rollback(id, row.grantId);
    this.log(`  rollback ${rb.ok ? 'done' : 'FAILED: ' + rb.why}`);
    if (!rb.ok && rb.why === 'not in executor ledger') this.event('rollback.refused', row.grantId, `change ${id} was not recorded by this executor`);
  }
}
