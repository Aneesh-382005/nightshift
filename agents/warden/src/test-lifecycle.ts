// Pure-mapping tests for the Lantern lifecycle. Run: npx tsx src/test-lifecycle.ts
import assert from 'node:assert/strict';
import { DownTracker, RANK, WORDS, alternateLeds, chaseLeds, pickState, sweepLeds, thinkActive, vitalsStatus, type StateName } from './lifecycle.js';

// words fit the 8 char display
for (const w of Object.values(WORDS)) assert.ok(w.length <= 8, w);
for (const w of ['APPROVE', 'HOLD', 'TRUST 99', 'EARNED']) assert.ok(w.length <= 8);

// priority: BLOCKED, APPROVE/HOLD, ESCALATE, FIXING, THINK, DOWN, TRUST/HEALTHY, WATCH, IDLE
const order: StateName[] = ['BLOCKED', 'PENDING', 'ESCALATE', 'FIXING', 'THINK', 'DOWN', 'HEALTHY', 'WATCH', 'IDLE'];
for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
  assert.equal(pickState([order[j], order[i]]), order[i], `${order[i]} beats ${order[j]}`);
  assert.equal(pickState([order[i], order[j]]), order[i]);
}
assert.equal(pickState([]), 'IDLE');
assert.ok(RANK.FEEDBACK > RANK.PENDING && RANK.FEEDBACK < RANK.ESCALATE, 'button feedback sits between APPROVE and ESCALATE');

// LED patterns
const lit = (l: number[][] | undefined, c: number[]) => l!.map((x, i) => (x[0] === c[0] && x[1] === c[1] && x[2] === c[2] ? i : -1)).filter(i => i >= 0);
assert.deepEqual([0, 150, 300, 450, 599].map(t => lit(sweepLeds(1000, 1000 + t), [255, 190, 0])[0]), [0, 1, 3, 5, 6], 'one gold LED sweeps across 7 LEDs in 600 ms');
assert.equal(sweepLeds(1000, 1600), undefined); assert.equal(sweepLeds(1000, 999), undefined);
assert.deepEqual(chaseLeds(0).filter(c => c[0] === 255).length, 1);
assert.deepEqual([0, 150, 300, 1050].map(t => lit(chaseLeds(t), [255, 140, 0])[0]), [0, 1, 2, 0], 'amber chase wraps after 7 steps');
const a0 = alternateLeds(0), a1 = alternateLeds(500);
assert.equal(a0.length, 7); assert.notDeepEqual(a0, a1); assert.deepEqual(alternateLeds(1000), a0);
assert.ok(a0.every((c, i) => c[0] === 255 && (i % 2 === 0 ? c[1] === 0 : c[1] === 140)), 'red and amber alternate');

// vitals
assert.equal(vitalsStatus('{"health":200,"diskPct":40}'), 'ok');
assert.equal(vitalsStatus('{"health":0,"diskPct":40}'), 'failing');
assert.equal(vitalsStatus('{"health":500}'), 'failing');
assert.equal(vitalsStatus('{"diskPct":40}'), 'unknown'); assert.equal(vitalsStatus('nope'), 'unknown');

// DOWN tracker
const d = new DownTracker(1000);
assert.equal(d.onEvent('vitals', 'web-1', '{"health":200}', 0), false);
assert.equal(d.onEvent('vitals', 'web-1', '{"health":0}', 10), true); assert.deepEqual(d.list(10), ['web-1']);
assert.equal(d.onEvent('vitals', 'web-1', '{"health":0}', 20), false, 'refresh is not a change');
assert.equal(d.onEvent('vitals', 'web-1', '{"health":200}', 30), true); assert.deepEqual(d.list(30), []);
d.onEvent('incident.opened', 'web-2', '#4 down', 100); assert.deepEqual(d.list(100), ['web-2']);
assert.deepEqual(d.list(100 + 1001), [], 'drops after the ttl without a refresh');
d.onEvent('incident.opened', 'web-2', '', 5000); d.onEvent('health.passed', 'web-2', '', 5001); assert.deepEqual(d.list(5001), []);
d.onEvent('incident.opened', 'web-2', '', 6000); d.onEvent('incident.healed', 'web-2', '', 6001); assert.deepEqual(d.list(6001), []);

// THINK
assert.equal(thinkActive(0, 1000, true), false, 'no thought yet');
assert.equal(thinkActive(1000, 5000, false), true); assert.equal(thinkActive(1000, 8000, false), false);
assert.equal(thinkActive(1000, 15000, true), true, 'a running user request keeps THINK up longer'); assert.equal(thinkActive(1000, 22000, true), false);
console.log('lifecycle mapping tests passed');
