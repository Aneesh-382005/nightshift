#!/usr/bin/env python3
"""FREE-WILi bridge. JSON lines over stdio (see docs/CONTRACT.md, v3.2 warden section).

to bridge (stdin):   {"op":"text","text":"..."}  {"op":"led","r":0,"g":0,"b":0,"mode":"solid|pulse|blink","leds":[0..6]|"all"}
                     {"op":"tone","hz":880,"ms":200,"amp":0.3}  {"op":"clear"}
                     {"op":"press","name":"green"}   (sim backend only: inject a button press)
from bridge (stdout): {"event":"shake"} (double shake, onewili only)  {"event":"ready"}  {"event":"button","name":"gray|yellow|green|blue|red"}  {"event":"error","message":"..."}

Backends: --backend sim (default, stdlib only), legacy (`freewili` pip package, FW1 firmware),
onewili (OneWili, stock OG firmware). Every device call runs on one worker thread with a timeout,
so a hung device cannot freeze the bridge. Human-readable logs go to stderr, never stdout.

Sim keys (when stdin is a terminal, or via the warden): g green, b blue, r red, w gray (white), y yellow.
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import re
import signal
import sys
import threading
import time

BUTTONS = ["gray", "yellow", "green", "blue", "red"]       # bit 0..4 of the OneWili bitmask
KEYS = {"g": "green", "b": "blue", "r": "red", "w": "gray", "y": "yellow",
        "1": "gray", "2": "yellow", "3": "green", "4": "blue", "5": "red"}
NUM_LEDS = 7

_out_lock = threading.Lock()


def emit(obj: dict) -> None:
    with _out_lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


def log(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def led_list(spec) -> list[int]:
    if spec in (None, "all"):
        return list(range(NUM_LEDS))
    return [int(i) for i in spec if 0 <= int(i) < NUM_LEDS]


class ShakeDetector:
    """Double shake = revoke all. Verified on the board: |accel| is about 1000 mg at rest, resting jitter peaks at
    310 mg deviation, real shakes reach 900 to 2450 mg, frames arrive at about 18 Hz, gyro reads 0 (ignored).
    One shake = |magnitude - 1000| above `threshold` for `frames` consecutive frames. Two shakes within `window`
    seconds trigger, so a single bump never stops things. After a trigger it stays quiet for `cooldown` seconds."""

    def __init__(self, threshold: float = 700.0, frames: int = 2, window: float = 1.5, cooldown: float = 3.0) -> None:
        self.threshold, self.frames, self.window, self.cooldown = threshold, frames, window, cooldown
        self.run = 0
        self.armed = True            # a shake must settle (run back to 0) before the next one counts
        self.shakes: list[float] = []
        self.quiet_until = 0.0

    def feed(self, ax: float, ay: float, az: float, t: float) -> bool:
        dev = abs((ax * ax + ay * ay + az * az) ** 0.5 - 1000.0)
        if dev <= self.threshold:
            self.run = 0
            self.armed = True
            return False
        self.run += 1
        if self.run < self.frames or not self.armed:
            return False
        self.armed = False           # counted: this shake is one event however long it lasts
        if t < self.quiet_until:
            return False
        self.shakes = [x for x in self.shakes if t - x <= self.window] + [t]
        if len(self.shakes) >= 2:
            self.shakes = []
            self.quiet_until = t + self.cooldown
            return True
        return False


class ButtonEdges:
    """Turns '0 0 1 0 0' state frames (gray yellow green blue red) into rising-edge presses.
    A held button fires once; the 1 Hz heartbeat repeats and a bounce within `debounce` seconds are ignored."""

    def __init__(self, debounce: float = 0.05) -> None:
        self.debounce = debounce
        self.state = [0] * len(BUTTONS)
        self.last_rise = [0.0] * len(BUTTONS)

    def feed(self, response: str, t: float) -> list[str]:
        try:
            vals = [1 if int(x) else 0 for x in response.split()[:len(BUTTONS)]]
        except ValueError:
            return []
        if len(vals) < len(BUTTONS):
            return []
        out = []
        for i, v in enumerate(vals):
            if v and not self.state[i] and t - self.last_rise[i] >= self.debounce:
                out.append(BUTTONS[i])
                self.last_rise[i] = t
            self.state[i] = v
        return out


class Backend:
    name = "base"

    def open(self) -> None: ...
    def close(self) -> None: ...
    def text(self, text: str) -> None: ...
    def led(self, leds: list[int], r: int, g: int, b: int, mode: str) -> None: ...
    def tone(self, hz: float, ms: float, amp: float) -> None: ...
    def clear(self) -> None: ...
    def poll_buttons(self) -> list[str]:
        """Names of buttons newly pressed since the last poll."""
        return []


class SimBackend(Backend):
    name = "sim"

    def __init__(self) -> None:
        self.pressed: "queue.Queue[str]" = queue.Queue()

    def open(self) -> None:
        log("[sim] FREE-WILi simulator. keys: g=green b=blue r=red w=gray(undo) y=yellow(audit)")

    def text(self, text: str) -> None:
        lines = text.split("\n")
        width = max([len(x) for x in lines] + [24])
        log("[sim] +" + "-" * width + "+")
        for ln in lines:
            log("[sim] |" + ln.ljust(width) + "|")
        log("[sim] +" + "-" * width + "+")

    def led(self, leds, r, g, b, mode) -> None:
        which = "all" if len(leds) == NUM_LEDS else ",".join(map(str, leds))
        log(f"[sim] LED {which} rgb({r},{g},{b}) {mode}")

    def tone(self, hz, ms, amp) -> None:
        log(f"[sim] TONE {hz:.0f}Hz {ms:.0f}ms amp {amp}")

    def clear(self) -> None:
        log("[sim] display cleared")

    def poll_buttons(self) -> list[str]:
        out = []
        while True:
            try:
                out.append(self.pressed.get_nowait())
            except queue.Empty:
                return out


class LegacyBackend(Backend):
    """`freewili` pip package, legacy FW1 firmware. Pulse and blink are animated in software."""
    name = "legacy"

    def __init__(self) -> None:
        self.fw = None
        self.last: dict = {}
        self.anim_stop = threading.Event()
        self.anim_thread: threading.Thread | None = None
        self.dev_lock = threading.Lock()

    def open(self) -> None:
        from freewili import FreeWili
        self.fw = FreeWili.find_first().expect("no FreeWili found")
        self.fw.open().expect("open failed")
        try:
            self.last = {c: bool(s) for c, s in self.fw.read_all_buttons().expect("buttons").items()}
        except Exception:
            self.last = {}

    def close(self) -> None:
        self._stop_anim()
        if self.fw:
            try:
                self.fw.close()
            except Exception:
                pass

    def _set(self, leds, r, g, b) -> None:
        with self.dev_lock:
            for i in leds:
                self.fw.set_board_leds(i, r, g, b).expect("led")

    def _stop_anim(self) -> None:
        self.anim_stop.set()
        if self.anim_thread and self.anim_thread is not threading.current_thread():
            self.anim_thread.join(timeout=1)

    def text(self, text: str) -> None:
        with self.dev_lock:
            self.fw.show_text_display(text)

    def led(self, leds, r, g, b, mode) -> None:
        self._stop_anim()
        self.anim_stop = threading.Event()
        if mode == "solid":
            self._set(leds, r, g, b)
            return
        stop = self.anim_stop

        def run() -> None:
            t0 = time.time()
            while not stop.is_set():
                t = time.time() - t0
                if mode == "blink":
                    k = 1.0 if int(t * 4) % 2 == 0 else 0.0
                else:   # pulse, 1.2 s triangle wave
                    ph = (t % 1.2) / 1.2
                    k = 1 - abs(2 * ph - 1)
                try:
                    self._set(leds, int(r * k), int(g * k), int(b * k))
                except Exception:
                    return
                stop.wait(0.1)

        self.anim_thread = threading.Thread(target=run, daemon=True)
        self.anim_thread.start()

    def tone(self, hz, ms, amp) -> None:
        with self.dev_lock:
            self.fw.play_audio_tone(hz, ms / 1000.0, amp)

    def clear(self) -> None:
        with self.dev_lock:
            self.fw.show_text_display("")

    def poll_buttons(self) -> list[str]:
        with self.dev_lock:
            cur = {c: bool(s) for c, s in self.fw.read_all_buttons().expect("buttons").items()}
        out = []
        for color, state in cur.items():
            if state and not self.last.get(color, False):
                name = getattr(color, "name", str(color)).lower()
                if name in BUTTONS:
                    out.append(name)
        self.last = cur
        return out


class Reconnecting(Exception):
    """The board is gone and the recovery thread is bringing it back. Callers drop the call quietly."""


_IO_ERR = re.compile(r"errno (5|9|19)\b|input/output|write failed|read failed|no such device|device (disconnected|reports)"
                     r"|port is closed|not open|broken pipe|device not configured|not responding", re.I)


def guarded(fn):
    """Device op wrapper: while the board is gone, drop the call; an I/O error marks the board gone."""
    def wrapper(self, *a, **k):
        if self.broken:
            raise Reconnecting()
        try:
            return fn(self, *a, **k)
        except Reconnecting:
            raise
        except Exception as e:  # noqa: BLE001
            if isinstance(e, OSError) or _IO_ERR.search(str(e)):
                self._mark_broken(str(e))
            raise
    return wrapper


def call_with_timeout(fn, seconds: float):
    """Run fn on a daemon thread. A hung USB call cannot block recovery; the thread is abandoned."""
    box: list = []
    done = threading.Event()

    def run() -> None:
        try:
            box.append(("ok", fn()))
        except BaseException as e:  # noqa: BLE001
            box.append(("err", e))
        done.set()

    threading.Thread(target=run, daemon=True).start()
    if not done.wait(seconds):
        raise TimeoutError(f"timed out after {seconds}s")
    kind, val = box[0]
    if kind == "err":
        raise val
    return val


class OneWiliBackend(Backend):
    """OneWili on the stock OG firmware. read_buttons() fails on the board (verified), so buttons come from
    the spontaneous '*button' stream (gui.stream_io), and the accelerometer from the '*motion' stream.
    Both arrive on dev._transport.events, which this poller is the only consumer of.

    Recovery: on an I/O error, or `silence_s` without frames, the board is marked gone, a recovery thread closes
    the old handle, re-scans by USB id (onewili.connect() discovers the board, so ttyACM renumbering does not
    matter), reconnects, restarts the streams and redraws the last word and LEDs. One log line per attempt,
    backoff 0.5 s doubling to 3 s."""
    name = "onewili"

    def __init__(self, stream: bool = True, shake: bool = True, shake_threshold: float = 700.0, lib=None,
                 silence_s: float = 5.0, backoff: tuple[float, float] = (0.5, 3.0), connect_timeout: float = 10.0) -> None:
        self.dev = None
        self.onewili = lib
        self.modes: dict = {}
        self._last_word = None
        self.want_buttons = stream
        self.want_shake = shake
        self.shake_threshold = shake_threshold
        self.edges = ButtonEdges()
        self.shaker = ShakeDetector(shake_threshold)
        self.streaming = False
        self.retry_at = 0.0
        self.last_frame = 0.0
        self.silence_s = silence_s
        self.backoff = backoff
        self.connect_timeout = connect_timeout
        self.broken = False
        self._closing = False
        self._led_ops: list[tuple] = []
        self._lock = threading.Lock()
        self._recovering = False

    def open(self) -> None:
        if self.onewili is None:
            import onewili
            self.onewili = onewili
        enums = self.onewili.enums
        M = enums.owLEDManagerLEDMode
        self.modes = {"solid": M.SIMPLEVALUE, "pulse": M.PULSE, "blink": M.FLASH}
        self.dev = self.onewili.connect()
        if self.want_buttons or self.want_shake:
            self._start_streams()

    def _start_streams(self) -> None:
        if self.want_buttons:
            self._ok(self.dev.gui.stream_io(20), "stream_io")             # '*button' frames on change, about 20 Hz
        if self.want_shake:
            self._ok(self.dev.io.sensors.enable_motion_stream(10), "enable_motion_stream")
        self.streaming = True
        self.last_frame = time.time()

    def stop_streams(self) -> None:
        """Best effort, never raises. Called on shutdown and after errors."""
        self.streaming = False
        for fn in (lambda: self.dev.gui.stream_io(0), lambda: self.dev.io.sensors.enable_motion_stream(0)):
            try:
                fn()
            except Exception:
                pass

    def close(self) -> None:
        self._closing = True
        if self.dev:
            self.stop_streams()
            try:
                self.dev.close()
            except Exception:
                pass

    def _ok(self, res, what: str):
        if isinstance(res, self.onewili.Err):
            raise RuntimeError(f"{what}: {res}")
        return res.ok_value if hasattr(res, "ok_value") else res

    # ---- recovery ----
    def _mark_broken(self, why: str) -> None:
        with self._lock:
            if self.broken:
                return
            self.broken = True
            self.streaming = False
            start = not self._recovering
            self._recovering = True
        log(f"[bridge] board lost ({why[:80]}); reconnecting")
        emit({"event": "error", "message": "board disconnected, reconnecting"})
        if start:
            threading.Thread(target=self._recover_loop, daemon=True).start()

    def _recover_loop(self) -> None:
        delay = self.backoff[0]
        attempt = 0
        while not self._closing:
            attempt += 1
            try:
                self._reconnect_once()
            except Exception as e:  # noqa: BLE001
                log(f"[bridge] reconnect attempt {attempt}: failed ({str(e)[:80]}), retry in {delay:g}s")
                time.sleep(delay)
                delay = min(self.backoff[1], delay * 2)
                continue
            log(f"[bridge] reconnect attempt {attempt}: ok")
            with self._lock:
                self.broken = False
                self._recovering = False
            emit({"event": "ready"})
            return

    def _reconnect_once(self) -> None:
        old = self.dev                                # stays in place until the new handle is up
        if old is not None:
            try:
                call_with_timeout(old.close, 2)       # may hang on a dead handle: abandon it
            except Exception:
                pass
        if not self.onewili.find_devices():           # USB id scan, independent of ttyACM numbers
            raise RuntimeError("board not found on USB")
        self.dev = call_with_timeout(self.onewili.connect, self.connect_timeout)
        self.edges = ButtonEdges()                    # drop any stale held state
        self.shaker = ShakeDetector(self.shake_threshold)
        if self.want_buttons or self.want_shake:
            self._start_streams()
        if self._last_word:                           # redraw the current state
            self._ok(self.dev.gui.show_text(self._last_word), "show_text")
        for leds, r, g, b, mode in self._led_ops:
            for i in leds:
                self._ok(self.dev.gui.set_led_color(i, r, g, b, 3000, self.modes[mode]), "set_led_color")

    # ---- device ops ----
    @guarded
    def text(self, text: str) -> None:
        # Verified on the board: the display shows only the first line, about 8 characters.
        word = (text.split("\n")[0].strip() or " ")[:8]
        if word == self._last_word:     # the warden re-sends countdown text every second
            return
        self._ok(self.dev.gui.show_text(word), "show_text")
        self._last_word = word

    @guarded
    def led(self, leds, r, g, b, mode) -> None:
        # duration semantics are UNVERIFIED on hardware; the warden re-sends state every 2 s.
        for i in leds:
            self._ok(self.dev.gui.set_led_color(i, r, g, b, 3000, self.modes[mode]), "set_led_color")
        op = (list(leds), r, g, b, mode)             # remembered for the redraw after a reconnect
        self._led_ops = [op] if len(leds) >= NUM_LEDS else self._led_ops + [op]

    @guarded
    def tone(self, hz, ms, amp) -> None:
        # Only reached with --sound on. Verified workaround: a 200 ms tone once stuck on. Always 100 ms, then silence.
        a = self.dev.io.audio
        self._ok(a.tone(float(hz), 100.0, 0.3), "tone")
        time.sleep(0.12)
        self._ok(a.tone(440.0, 50.0, 0.0), "tone off")
        self._ok(a.enable_audio_stream(0), "enable_audio_stream")

    @guarded
    def clear(self) -> None:
        self._ok(self.dev.gui.clear_display(), "clear_display")
        self._last_word = None

    @guarded
    def poll_buttons(self) -> list[str]:
        if not (self.want_buttons or self.want_shake):
            return []
        now = time.time()
        out: list[str] = []
        import queue as _q
        ev = self.dev._transport.events
        while True:
            try:
                f = ev.get_nowait()
            except _q.Empty:
                break
            self.last_frame = now
            path = getattr(f, "path", "")
            if path == "*button" and self.want_buttons:
                out += self.edges.feed(f.response, now)
            elif path == "*motion" and self.want_shake:
                try:
                    ax, ay, az = (float(x) for x in f.response.split()[:3])
                except ValueError:
                    continue
                if self.shaker.feed(ax, ay, az, now):
                    log("[bridge] double shake")
                    try:
                        self.text("SHAKEN")          # immediate feedback; the warden follows with REVOKED
                    except Exception:
                        pass
                    out.append("shake")
        if now - self.last_frame > self.silence_s:  # the button stream heartbeats about once a second
            raise RuntimeError("no stream frames for %gs: device not responding" % self.silence_s)
        return out


class Worker:
    """Runs every device call on one thread. A call that exceeds its timeout is reported and the
    worker is marked wedged: further calls are dropped (not queued) until it frees up."""

    def __init__(self, timeout: float) -> None:
        self.timeout = timeout
        self.q: "queue.Queue[tuple]" = queue.Queue()
        self.busy_since = 0.0
        self.t = threading.Thread(target=self._run, daemon=True)
        self.t.start()

    def _run(self) -> None:
        while True:
            fn, args, box, done = self.q.get()
            self.busy_since = time.time()
            try:
                box.append(("ok", fn(*args)))
            except Exception as e:  # noqa: BLE001
                box.append(("err", e))
            self.busy_since = 0.0
            done.set()

    def call(self, fn, *args, timeout: float | None = None):
        if self.busy_since and time.time() - self.busy_since > self.timeout:
            raise TimeoutError("device wedged, call dropped")
        box: list = []
        done = threading.Event()
        self.q.put((fn, args, box, done))
        if not done.wait(timeout or self.timeout):
            raise TimeoutError(f"device call timed out after {timeout or self.timeout}s")
        kind, val = box[0]
        if kind == "err":
            raise val
        return val


def make_backend(args) -> Backend:
    name = "sim" if args.sim else args.backend
    if name == "onewili":
        return OneWiliBackend(stream=args.buttons in ("auto", "stream"), shake=args.shake == "on",
                              shake_threshold=args.shake_threshold)
    return {"sim": SimBackend, "legacy": LegacyBackend}[name]()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["sim", "legacy", "onewili"], default="sim")
    ap.add_argument("--sim", action="store_true", help="alias for --backend sim")
    ap.add_argument("--timeout", type=float, default=3.0, help="per device call, seconds")
    ap.add_argument("--connect-timeout", type=float, default=10.0)
    ap.add_argument("--buttons", choices=["auto", "device", "stream", "none"], default="auto",
                    help="button source. auto = device polling for sim/legacy, the '*button' stream for onewili "
                         "(read_buttons fails on the board, verified). none = presses come from the warden keyboard or phone page")
    ap.add_argument("--shake", choices=["on", "off"], default="on", help="onewili: double shake sends a separate shake event (the warden revokes everything)")
    ap.add_argument("--shake-threshold", type=float, default=700.0, help="single-shake threshold: |accel magnitude - 1000| in mg, 2 frames in a row")
    ap.add_argument("--sound", choices=["auto", "on", "off"], default="auto",
                    help="auto = off for onewili (tones got stuck on the real board), on for sim and legacy")
    ap.add_argument("--leds-brightness", type=float, default=1.0, help="scale LED rgb, 0.0 to 1.0")
    ap.add_argument("--poll", type=float, default=None, help="button poll interval, seconds (default 0.1, 0.02 for streams)")
    args = ap.parse_args()
    backend = make_backend(args)
    worker = Worker(args.timeout)
    sound = args.sound == "on" or (args.sound == "auto" and backend.name != "onewili")
    bright = max(0.0, min(1.0, args.leds_brightness))
    log(f"[bridge] sound {'on' if sound else 'OFF (tone ops ignored)'}, led brightness {bright}")

    try:
        worker.call(backend.open, timeout=args.connect_timeout)
    except Exception as e:  # noqa: BLE001
        emit({"event": "error", "message": f"connect failed ({backend.name}): {e}"})
        os._exit(2)   # a hung device thread would block a normal exit
    emit({"event": "ready"})
    log(f"[bridge] backend {backend.name} ready")

    stop = threading.Event()
    last_err = {"msg": "", "t": 0.0}

    def report(e: Exception) -> None:
        msg = str(e) or type(e).__name__
        if msg != last_err["msg"] or time.time() - last_err["t"] > 5:   # rate limit repeats
            emit({"event": "error", "message": msg})
            last_err.update(msg=msg, t=time.time())

    def poller() -> None:
        while not stop.is_set():
            try:
                for name in worker.call(backend.poll_buttons):
                    emit({"event": "shake"} if name == "shake" else {"event": "button", "name": name})
            except Reconnecting:
                pass                                     # board is being recovered, logged once by the backend
            except Exception as e:  # noqa: BLE001
                report(e)
            stop.wait(poll_s)

    poll_s = args.poll if args.poll is not None else (0.02 if backend.name == "onewili" else 0.1)
    if backend.name == "onewili":
        use_poller = args.buttons in ("auto", "stream") or args.shake == "on"
    else:
        use_poller = args.buttons in ("auto", "device")
    if use_poller:
        threading.Thread(target=poller, daemon=True).start()
    else:
        log(f"[bridge] device buttons off ({backend.name}); presses come from the warden")

    # sim: when stdin is a terminal, read single keys instead of JSON
    if args.backend == "sim" or args.sim:
        if sys.stdin.isatty():
            import termios
            import tty
            fd = sys.stdin.fileno()
            old = termios.tcgetattr(fd)
            tty.setcbreak(fd)

            def keys() -> None:
                try:
                    while not stop.is_set():
                        ch = sys.stdin.read(1)
                        if ch in KEYS and isinstance(backend, SimBackend):
                            backend.pressed.put(KEYS[ch])
                        elif ch in ("\x03", "q"):
                            stop.set()
                finally:
                    termios.tcsetattr(fd, termios.TCSADRAIN, old)

            keys()
            return 0

    def shutdown() -> None:
        try:
            worker.call(backend.close, timeout=3)     # onewili: stream_io(0), motion stream off, close
        except Exception:
            pass

    signal.signal(signal.SIGTERM, lambda *_: (shutdown(), os._exit(0)))
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            m = json.loads(line)
            op = m.get("op")
            if op == "text":
                worker.call(backend.text, str(m.get("text", "")))
            elif op == "led":
                worker.call(backend.led, led_list(m.get("leds", "all")),
                            int(int(m.get("r", 0)) * bright), int(int(m.get("g", 0)) * bright),
                            int(int(m.get("b", 0)) * bright), m.get("mode", "solid"))
            elif op == "tone":
                if sound:
                    worker.call(backend.tone, float(m.get("hz", 880)), float(m.get("ms", 200)), float(m.get("amp", 0.3)))
            elif op == "clear":
                worker.call(backend.clear)
            elif op == "press" and isinstance(backend, SimBackend):
                name = m.get("name")
                if name in BUTTONS:
                    backend.pressed.put(name)
            else:
                emit({"event": "error", "message": f"unknown op: {op}"})
        except Reconnecting:
            pass
        except Exception as e:  # noqa: BLE001
            report(e)
    stop.set()
    shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
