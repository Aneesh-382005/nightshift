# agents/freewili

`bridge.py` connects the FREE-WILi (the Lantern) to the warden over JSON lines on stdio. Protocol: docs/CONTRACT.md (v3.2 warden section). Logs go to stderr.

```
.venv/bin/python bridge.py --backend sim|legacy|onewili [flags]
.venv/bin/python tests/test_logic.py     # button edge and shake logic, no hardware
```

| Flag | Meaning |
|---|---|
| `--backend` | `sim` (default, keys g b r w y or 3 4 5 1 2), `legacy` (FW1 `freewili` package), `onewili` (stock OG firmware) |
| `--sound auto\|on\|off` | auto = off for onewili (tones got stuck on the board), on elsewhere |
| `--leds-brightness 0..1` | scales LED colours |
| `--buttons auto\|device\|stream\|none` | onewili: auto = stream. `read_buttons` fails on the board, so presses come from the `*button` stream (`gui.stream_io(20)`). `none` = presses only from the warden keyboard or phone page |
| `--shake on\|off` | onewili, default on: a double shake emits its own `{"event":"shake"}` line (not red); the warden answers with revokeAll |
| `--shake-threshold` | single shake = abs(accel magnitude - 1000 mg) above this (default 700) for 2 frames in a row |

## onewili behaviour
- Display: only the first line is shown, 8 characters, so the warden sends one word per screen.
- Buttons: frames `0 0 1 0 0` (gray yellow green blue red) arrive on change (about 20 Hz) plus a heartbeat about once a second. A button press is emitted on the rising edge only, with a 50 ms debounce. A held state or a heartbeat never fires twice.
- Shake: `*motion` frames (about 18 Hz) are turned into a magnitude. One shake is 2 consecutive frames over the threshold. Two shakes within 1.5 s trigger, with a 3 s cooldown. The screen shows SHAKEN, then the warden calls revokeAll and shows REVOKED with red LEDs.
- Streams are switched off (`stream_io(0)`, motion stream 0) on shutdown, on SIGTERM and after a poll error. The poller restarts them after at most 5 s, and also if no frames arrive for 5 s.
- Do not hold red on the board: it powers off the display app.

## Reconnect (onewili)
If the board re-enumerates (cable bump, power-off; ttyACM numbers change), the bridge recovers by itself. A write or read I/O error, or 5 s without stream frames, marks the board gone. A recovery thread closes the old handle, re-scans USB with `onewili.find_devices()` and `onewili.connect()` (by USB id, never fixed ttyACM numbers), restarts the button and motion streams, and redraws the last word and LEDs. One log line per attempt, backoff 0.5 s doubling to 3 s. While the board is gone, warden writes are dropped silently (no error spam); the bridge emits one `error` event ("board disconnected, reconnecting") and a `ready` event when it is back. Test: `.venv/bin/python tests/test_recovery.py` (mocked disconnect, no hardware).

## Verified vs simulated
Verified on the real board: connect, text, LEDs, the `*button` frame format and press/release behaviour (the lead and the user, scripts in the lead's scratchpad), the motion frame format and rest values (recorded in `tests/rest_sample.json`), bridge start with both streams and no events or errors for 7 s at rest, no frames flowing after the bridge exits.
Recovery is tested only against a mocked device (it passes; a real unplug and replug is not yet verified).
Tested only on recorded or synthetic data: the edge and shake logic (`tests/test_logic.py`; rest data is real, shake frames are synthetic). Not yet verified end to end through the bridge on the real board: a real press producing a `button` JSON line, a real double shake, and `stream_io(0)` being the thing that stops the stream (it may also stop on disconnect).
