# CONTRACT (owned by the orchestrator session. Others do not edit.)

## SpacetimeDB tables
| Table | Columns |
|---|---|
| device | id (string pk), name, kind (laptop, phone, warden), capabilities (string[]), status (online, offline), last_heartbeat, identity |
| trust | id (autoinc), requester, target, capability (auto-approve edge) |
| grant | id (u64 autoinc pk), requester, target, capability (screen.view, input.control), reason, status (pending, active, denied, expired, revoked), created_at, decided_at, expires_at, decided_by (identity) |
| event | id (autoinc), ts, kind, device, grant_id (0 if none), detail |
| summary | id (autoinc), grant_id, device, text, flagged (bool) |

## Reducers
- register_device(id, name, kind, capabilities), heartbeat(id)
- claim_warden(secret): first caller with the secret becomes the only identity allowed to call decide_grant and revoke_all
- request_grant(requester, target, capability, reason, ttl_s): auto-activates if a trust edge exists, else pending
- decide_grant(grant_id, approve, ttl_s): warden identity only
- revoke_all(): warden identity only
- record_summary(grant_id, device, text, flagged)
- scheduled: expire_grants (every 1s), reap_devices (every 2s, heartbeat older than 6s means offline)

## Event kinds
device.online, device.offline, grant.requested, grant.approved, grant.denied, grant.expired, grant.revoked, capture.started, capture.finished, summary.created, injection.flagged

## MCP tools (hub/)
- view_screen(device, reason): blocks until approved, denied, or 60s timeout. Returns redacted text summary, or an error string.
- request_input_control(device, reason): same flow, returns approved or denied (stub action).
- list_devices(): ids, kinds, capabilities, status.

## Warden UX
| State | LEDs | Display | Sound |
|---|---|---|---|
| idle | dim green, one LED | "Nightshift idle" | none |
| pending | amber pulse | who wants what, which device, TTL | chime |
| active | amber solid | countdown | shutter tick at start |
| expiring (under 15s) | red blink | countdown | none |
| revoked or denied | red flash 2s then idle | "Revoked" or "Denied" | low tone |

Buttons: green approve 2 min, blue approve 30s, red deny (pending) or revoke all (active), white show last 5 audit lines. Shake (accelerometer) means revoke all.

## Capture rules
Perception agents capture only while a matching active grant row exists for them. Pixels never leave the device. Redact emails, tokens, card-like numbers before writing the summary. Flag instruction-like text ("ignore previous", "assistant:", tool names) and set flagged=true.


## v3 additions (Oct 3): capability tiers, change log, policy
Capability tiers replace the single screen capability:
| Capability | Approval |
|---|---|
| shell.read | auto for trusted pairs, 2 min grant |
| shell.write | physical press, exact command shown |
| shell.destructive | press and hold, one command only |
| screen.view | physical press |
| gui.control (stretch) | press and hold, short TTL |

New table `change`: id, grant_id, device, command, pre_state (json), inverse_command, status (applied, rolled_back, irreversible), ts.
New reducers: record_change, rollback_last (warden only), rollback_to(change_id) (warden only).
Warden: white button = rollback last change. Event kinds add change.recorded, change.rolled_back, cost.update.
Policy: each device workspace has `workspaces/<type>/policy.yaml` (read, write, destructive patterns) and `SKILL.md`. The gate classifies commands from policy, never from the agent.
Cost meter: event kind cost.update carries tokens, seconds, commands, presses.

## v3.1 additions (Oct 3): autonomy
Levels: 0 observe, 1 heal allowlist (auto, verify, auto-rollback), 2 ask (press), 3 hold (press and hold), never (policy forbids).
policy.yaml per device type adds `autonomous:` (allowlisted fix ids with command, health_check, inverse, risk) and `forbidden:` patterns.
New table `runbook_trust`: runbook_id, device_type, successes, failures, level, updated_at. Promotion threshold: 3 verified successes moves a fix from level 2 to level 1.
New table `incident`: id, device, alert, runbook_id, status (open, healed, rolled_back, escalated), attempts, ts.
Circuit breaker: 2 failed fixes on a device, or more than 6 autonomous actions per hour per device, sets incident status escalated and stops.
Event kinds add fix.autonomous, health.passed, health.failed, trust.promoted, incident.escalated.
Warden: autonomous fix = brief amber flash and a tick, then green. Escalation = amber pulse and chime. Policy block = red and low tone.

## v3.2 implemented surface (authoritative, matches the published module)
Tables (all public except warden, gate, expire_tick, reap_tick): device, trust, access_grant(+plan), event, change, incident, runbook_trust, run_result, user_request.
New: run_result(grantId pk, device, exitCode, output, healthOk, rolledBack, tsUs), user_request(id, text, status new|running|done|failed, result, tsUs).
Reducers added: recordResult (gate or device), requestRollback (warden only; logs event rollback.requested with detail = changeId, device = target), submitRequest (anyone), updateRequest (gate only). markChange now allows device identities. requestGrant args: requester, target, capability, reason, command, plan, ttlSeconds, autoApprove.
Execution rule: an executor runs each ACTIVE grant targeting its own device exactly once (dedupe by run_result existence), calls consumeGrant first, then records run_result. One grant per command.
plan JSON (written by the gate, read by the executor):
{"snapshots":[{"kind":"file","path":"/etc/app.conf"},{"kind":"service","name":"web"},{"kind":"android_setting","ns":"global","key":"wifi_on"}],"inverse":"<command that undoes it>","health":"<command, exit 0 means healthy>","timeoutS":30,"runbookId":"restart-web","deviceType":"linux-server"}
Auto-rollback: if health fails the executor runs inverse itself and records run_result with rolledBack true and markChange rolled_back.
Undo button: warden calls requestRollback(changeId); the target's executor watches event rollback.requested for its device, runs change.inverseCommand, markChange rolled_back.
Cost event: logEvent kind cost.update, detail = JSON {"tokens":int,"usd":number,"seconds":number,"commands":int,"presses":int,"model":string}.
Warden bridge protocol (JSON lines over stdio between agents/warden Node and agents/freewili/bridge.py):
 to bridge: {"op":"text","text":"..."} {"op":"led","r":0-255,"g":0,"b":0,"mode":"solid|pulse|blink","leds":[0..6]|"all"} {"op":"tone","hz":880,"ms":200,"amp":0.3} {"op":"clear"}
 from bridge: {"event":"button","name":"gray|yellow|green|blue|red"} {"event":"shake"} (double shake: warden calls revokeAll) {"event":"ready"} {"event":"error","message":"..."}
Button map: green approve 120s, blue approve 30s, red deny pending or revoke all, gray undo last applied change, yellow show last 5 audit lines. Double shake revokes all (verified detection on the real board; bridge emits its own shake event). Real buttons come from the board's stream_io(20) button events; the bridge also has a --sim mode (keys g b r w y x for shake).
Gateway ports: mock alert webhook POST http://127.0.0.1:8787/alert {"device":"web-1","alert":"service down"}.
Device ids: docker targets `web-1`, `web-2`; phone `pixel`; the gate and warden are not devices.
