# Nightshift tracker (lead-owned, updated Oct 4, about 5 a.m.)

Honesty key: VERIFIED = seen working on the real thing. LOCAL = ran on this laptop, simulator or stand-in only. REPORTED = a session says it works, lead has not seen it. NOT TESTED / NOT BUILT as named.

## 1. Verified working
| Item | Evidence |
|---|---|
| SpacetimeDB module (grants, changes, trust, events, expiry) | Published; 12 identity checks passed earlier (re-run after the warden and gate re-claims) |
| Pixel 9 Pro over adb | Wi-Fi toggled by hand via adb, mirrored with scrcpy 4.1 |
| FREE-WILi stock firmware restored (MAIN 024, DISPLAY 020) | GUI shows "Up to date" |
| FREE-WILi buttons (all five, press and release) via stream_io(20) button events | User pressed green, blue, gray, yellow, red on the real board; log in scratchpad btnstream.out |
| FREE-WILi accelerometer shake detection | User shook the board: still peak 310 mg, shakes 900 to 2450 mg, all detected; gyro reads 0 |
| FREE-WILi display words and LED colors | User confirmed APPROVE amber, AUTOFIX/HEALTHY green, BLOCKED red, UNDO white, IDLE off |
| Tailscale on laptop, DB and approval ports forwarded to the tailnet | `tailscale serve status` |
| NVIDIA RTX 4070 and local model (qwen2.5-coder:7b, about 50 tokens/s, 100% GPU) | `ollama ps` |
| Dashboard renders live data and was viewed by the user | Screenshots |

| Live test through the real warden: green press approves a real grant, double shake revokes it (grant #172) | User ran agents/warden/src/live-test.ts on the real board: 2 PASS |

| Full live loop on the real stack (Oct 4, about 07:40 to 07:53): POST /break service on web-1, monitor and alert, agent loop (gemini-3.1-flash-lite after 3.8-flash 429), grant, real green press on the FREE-WILi, restart-web, health ok, board HEALTHY | Seen in hub and warden logs and by the user: 10 s, about $0.001, 1 press; later runs healed alone (AUTOFIX) after trust |

## 2. Reported or only local (not yet seen end to end by the lead)
| Item | State |
|---|---|
| Gateway end to end with Claude (alert, grant, fix, health, trust promotion, `rm -rf` denied) | REPORTED: 1 run, about 31k tokens, $0.036, 16 s |
| Gateway with Gemini (one clean run) | REPORTED: about 100k tokens, $0.09, 87 s. The 15-run benchmark is INVALID (Gemini CLI swaps models silently) |
| Container executors, snapshots, auto-rollback | REPORTED and visible in the dashboard from test runs |
| Warden state machine, keyboard keys 1 to 5 | LOCAL (simulator and real-board output only) |
| Phone approval page over HTTP with token | LOCAL (curl tests); not opened on the phone yet |
| Warden onewili backend driving the real board | REPORTED: ran without errors; the lead's visual check used its own script |
| `/break` endpoint | REPORTED: CORS and refusals tested; faults not exercised through the endpoint |
| Android policy and fixes on the real phone through the gateway | ASSUMED, not run |
| 33 policy classification checks | REPORTED |

## 2b. New measurements (own agent loop on the real stack, n=1 each, prices UNVERIFIED)
| Scenario | Model | Result |
|---|---|---|
| service down | gemini-3.1-flash-lite | ok, 3,041 tokens, about $0.0012, 3.9 s, no press |
| bad config | gemini-3.1-flash-lite | ok, 6,066 tokens, about $0.0022, 6.4 s |
| poison log | gemini-3.1-flash-lite | ok, 4,841 tokens, about $0.0018, 8.9 s; the model ignored the hostile line, so the gate was NOT exercised by the model |
| service down | qwen2.5-coder:7b on GPU | ok, 1 command, 1,392 tokens, 2.2 s warm, 7 s cold; skips diagnosis |
Note: gemini-3.8-flash returns 429 on every request (quota); flash-lite serves everything. Poison beat in the demo needs a deliberately gullible test agent (stub harness), labelled as such.

## 3. Known broken or limited
- FREE-WILi `read_buttons` and the panels menu still return Failed, but real buttons work through `stream_io(20)` events (found by the lead). ns-warden is wiring it. Keys 1 to 5 and the phone page stay as fallback.
- FREE-WILi sound: tones stick for seconds. Sound is OFF by default.
- Gemini free key: daily quota exhausted on 3-flash-preview and pro; 3.8-flash and 3.1-flash-lite work. CLI hides fallbacks.
- Cost numbers: only 1 clean run per model. Do not quote averages.
- Dashboard shows stale incidents from failed benchmark runs; reset the DB before the demo.
- Dev secrets (`tally-warden-dev`, `tally-gate-dev`) are in public source history; rotate before submission.
- Repo is public. Decide whether to make it private until submission.

## 3b. Incidents and lessons from the live runs (Oct 4)
- spacetime login for credits replaced the CLI identity, so it no longer owned the local database (publish and reset got 403). Fix: moved ~/.local/share/spacetime/data to data.bak-0733, started a fresh server, republished; CLI is the owner now. Old data is in the backup folder.
- Warden crash loop: up.sh bound the phone page to 0.0.0.0:8899 which clashes with the tailscale serve forward; now bound to 127.0.0.1.
- Live hub was swapped to the stub harness by a session; restarted with the default loop chain. Rule: sessions are frozen from touching the live stack while demo runs happen.
- web-1 config got corrupted during a run; cause not fully identified (possibly a dashboard Break button click).
- Two alerts on one device (one from /break, one from the monitor) made the agent flail; dedupe to one incident per device is being added by ns-gateway.

## 4. In progress (sessions)
| Session | Task |
|---|---|
| ns-exec | Real monitor (probe every 3 s, vitals events, auto alert on 2 failures); then laptop sandbox device and "folder deleted" heal |
| ns-warden | `agents/loop`: own agent loop (Gemini REST, Ollama, fallback chain) |
| ns-gateway | Stub harness for free pipeline tests, `NS_HARNESS=loop`, `demo/reset-all.sh`, exercise `/break` |
| ns-ui | Break-something panel, Good morning report, blocked moment, Failed state, Lantern rename |

## 5. Not built yet
- Vitals on the dashboard flowers (needs ns-exec monitor first)
- Warden using real FREE-WILi buttons and shake-to-revoke (ns-warden, in progress)
- Wearing and trying the band; Lantern physical form (strap, placement)
- VM as a more realistic server (KVM works; Multipass not installed); optional
- B2C beat: Manim video with a skills file and render script, repo clone and deploy; stretch
- Codex CLI harness test (supported in code, not run)
- Companion website on the .tech domain; domain not claimed
- Architecture diagram image, README screenshot (`docs/img/dashboard.png`), demo GIF
- Devpost write-ups per track, 30 s, 2 min and 5 min pitches
- Demo video (backup), copied to USB 3 hours before the deadline
- Notability sketch pages and 2 screenshots (user)

- SpacetimeDB Maincloud publish (credits are claimed): second copy of the module for "from anywhere" and for showing the cloud side to the Spacetime judges. Local stays primary for the demo; clients pick the URI by env (UI already has VITE_STDB_URI). Rotate secrets first.

## 5b. Main idea and tracks (so nothing is lost)
Idea: Nightshift, an AI agent that fixes what breaks while you sleep; the Lantern (FREE-WILi wristband) glows when it needs you; autonomy ladder (observe, alone, ask, hold, never); earned trust; undo; kill switch. Pitch: "Sleep. Nightshift's on."
Tracks to enter: Grand Prize, Beyond the Code (only if the band truly works), Actually Intelligent, Best Use of FREE-WILi (only if it works), Best use of Spacetime, Notability (free add), Judged by an LLM (optional). Dropped: Fetch ASI:One, Sustainability, FinTech, Useless AI, Dumbest Idea, Photon, Neon, Relay, SpaceXAI/Cursor, Nessie, Figma, MLH Gemini/ElevenLabs/Solana/Tiger Data/Presage/.Tech.

## 6. Open decisions and asks
- Measure cost with Claude (about $0.20 for 5 scenarios) or wait for the Gemini quota
- Gemini booth: credits or higher quota (booth was closed)
- AWS credits and Raspberry Pi: unconfirmed, not blocking
- Track list: Beyond the Code and FREE-WILi claims only if the band truly works in the demo
- Claim the .Tech offer (code expires Oct 6) and ElevenLabs: not needed

## 7. Demo readiness checklist (run all on the real setup, then 5 times offline)
1. DB reset, trust at zero, all devices green
2. Mock or monitor alert on web-1, agent reads logs, Lantern amber (ask), press, fixed, health ok, trust 1
3. Same fault, heals alone
4. Poisoned log line, blocked, no press
5. Undo with gray (key), kill switch with red
6. Phone Wi-Fi fault and heal, mirrored with scrcpy
7. Deleted-folder heal in the sandbox
8. Phone over Tailscale on mobile data approves a fix
9. Dashboard on a big screen, Do Not Disturb on the phone
10. Fallback if the model is down: local model, then recorded video
