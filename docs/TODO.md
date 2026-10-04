# TODO (maintained by the lead session). Updated Oct 4 00:40.

## A. Aneesh now (physical and accounts)
- [ ] FREE-WILi: run `~/fwcom-app/run.sh`, then Setup -> FreeWili OG updater -> Firmware tab -> Update and verify (restores stock firmware; keep USB connected; no unplugging). Then tell the lead.
- [ ] Lead then runs `agents/freewili/smoke.py` (text, amber LEDs, beep, button read) and switches the warden bridge to the onewili backend
- [ ] Optional: post the Discord question in #free-wili if the update fails (message in chat)
- [ ] Phone: Stay awake while charging, keep unlocked, Developer options on (done: USB debugging works)
- [ ] Laptop on power, disable suspend and screen lock during demos
- [ ] Ask AWS booth about credits, MLH table about a Raspberry Pi (neither blocks the build)
- [ ] Post Discord asks: spacetime-db, amazon-web-services, beyond-the-code, rules/ask-mhacks (AI disclosure, deadline time, judging format)
- [ ] Notability Pro: sketch the demo flow and UI, take 2 screenshots (sponsor track)
- [ ] Models: pick one sponsor model route and run a 10 task smoke test (Gemini CLI first), see docs/ref/models.md
- [ ] Repo hygiene before public: rotate dev secrets in spacetime/spacetimedb/src/index.ts, decide on docs/ref

## B. Done
- [x] Repo pushed, monorepo layout, README, CLAUDE.md, STATE.md, CONTRACT v3.2, briefs
- [x] SpacetimeDB module published and tested (12 security checks pass), bindings generated in agents/common
- [x] Phone Pixel 9 Pro works over adb
- [x] FREE-WILi root cause found (board runs WiLiDoro, needs stock firmware); GUI runs via ~/fwcom-app/run.sh
- [x] Research digests in docs/ref (spacetimedb, freewili, mcp, harnesses, aws, targets, ui, models)

## C. Parallel sessions (started by Aneesh)
- [ ] ns-gateway: hub/ MCP gateway, policy engine, workspaces (SKILL.md and policy.yaml), harness launcher, mock alert webhook
- [ ] ns-exec: agents/exec docker and android executors, snapshots, health checks, auto-rollback, demo/ docker targets and break scripts
- [ ] ns-warden: agents/warden and agents/freewili/bridge.py (sim, legacy, onewili backends), warden UX state machine
- [ ] ns-ui: ui/ dashboard (devices, tally mirror, grants with countdown, timeline, trace, changes, trust, cost meter, request box)

## D. Lead
- [ ] Integrate sessions, run end to end, keep CONTRACT and the main page current
- [ ] Wire real FREE-WILi once stock firmware is back
- [ ] Hour 12 checkpoint: full demo works, Devpost draft submitted
- [ ] Cost meter numbers real (tokens times price) and labelled; $22 human benchmark labelled MetricNet via HDI

## E. Stretch, in order
- [ ] Shake to revoke (accelerometer), on-device audit log, wristband prop
- [ ] Raspberry Pi or AWS VM as an extra target, reroute beat
- [ ] Phone browser Lantern as fallback if FREE-WILi fails
- [ ] Manim or Vercel phone beat, Fetch (default drop)

## F. Ship
- [ ] Offline run-through with Wi-Fi off, 5 times
- [ ] Backup video recorded 3 hours before the deadline, copy to USB
- [ ] README, diagram, Devpost per track (Beyond the Code, Actually Intelligent, FREE-WILi, Spacetime, Notability)
- [ ] Pitches 30s, 2min, 5min; chargers, cables, power strip, hotspot
