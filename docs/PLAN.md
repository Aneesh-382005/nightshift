# Build order (solo orchestrator plus parallel sessions)

| Hours | Work | Owner | Done |
|---|---|---|---|
| H0-1 | Installs, FREE-WILi smoke test, Wayland capture test, phone adb test, freeze CONTRACT.md | you + lead | [ ] |
| H1-3 | SpacetimeDB module with tables, reducers, scheduled expiry | tally-core | [ ] |
| H1-3 | FREE-WILi bridge: LEDs, display, buttons, chime, accelerometer | tally-warden | [ ] |
| H1-3 | Perception: adb capture, gnome-screenshot, tesseract, redaction, injection flags | tally-eyes | [ ] |
| H3-6 | Node warden talks to bridge and SpacetimeDB. Perception agents gated by grants | warden + eyes | [ ] |
| H3-6 | MCP server: view_screen, request_input_control, list_devices | lead | [ ] |
| H3-6 | UI skeleton subscribed to tables | tally-ui | [ ] |
| H6-9 | Run real harness (Claude Code and Codex) against MCP, pick one by reliability | lead | [ ] |
| H9-12 | Red-team beat, UI polish, tally light mirror. **H12: full demo works. Draft Devpost** | all | [ ] |
| H12-17 | Shake-to-revoke, audit log on device, wristband prop, optional Fetch, optional reroute | by priority | [ ] |
| H17-21 | Offline run-through, README, track write-ups | lead | [ ] |
| H21-23 | Rehearse 5 times, record backup video (3h before deadline) | you | [ ] |
| H23-24 | Buffer. No new features | | [ ] |
