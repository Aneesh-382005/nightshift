# Demo script (90 seconds). This is the build spec.

1. Problem (10s). "AI agents want to see your screen. Today that is all or nothing, and invisible."
2. Trigger (15s). Ask the laptop agent: "What is the error on my phone?"
3. Aha (25s). FREE-WILi shows: "Laptop agent requests screen access to Phone, 5 min". Press the button. Summary comes back.
4. Resilience (20s). Unplug one device mid-task. Work reroutes and finishes.
5. Close (20s). Grant counts down and revokes itself. Toggle to the trace view: every event is there.

## Must work every time
- Request, approval on FREE-WILi, result on screen.
- Reroute after killing a device.
- Grant expiry visible in UI and on the FREE-WILi.

## Fallbacks
- FREE-WILi unavailable: approve with a button in the UI, labelled clearly in the video.
- No internet: scripted planner, cached screen summary.
- Phone capture flaky: laptop second display or a cached screenshot.
