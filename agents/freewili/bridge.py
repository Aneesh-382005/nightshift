#!/usr/bin/env python3
"""FREE-WILi bridge. JSON lines over stdio (see docs/CONTRACT.md, v3.2 warden section).

to bridge (stdin):   {"op":"text","text":"..."}  {"op":"led","r":0,"g":0,"b":0,"mode":"solid|pulse|blink","leds":[0..6]|"all"}
                     {"op":"tone","hz":880,"ms":200,"amp":0.3}  {"op":"clear"}
                     {"op":"press","name":"green"}   (sim backend only: inject a button press)
from bridge (stdout): {"event":"ready"}  {"event":"button","name":"gray|yellow|green|blue|red"}  {"event":"error","message":"..."}

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


class OneWiliBackend(Backend):
    """OneWili on the stock OG firmware. read_buttons() is a latched bitmask and has ONE consumer: this poller."""
    name = "onewili"

    def __init__(self) -> None:
        self.dev = None
        self.onewili = None
        self.modes: dict = {}
        self._last_word = None

    def open(self) -> None:
        import onewili
        from onewili import enums
        self.onewili = onewili
        M = enums.owLEDManagerLEDMode
        self.modes = {"solid": M.SIMPLEVALUE, "pulse": M.PULSE, "blink": M.FLASH}
        self.dev = onewili.connect()

    def close(self) -> None:
        if self.dev:
            try:
                self.dev.close()
            except Exception:
                pass

    def _ok(self, res, what: str):
        if isinstance(res, self.onewili.Err):
            raise RuntimeError(f"{what}: {res}")
        return res.ok_value if hasattr(res, "ok_value") else res

    def text(self, text: str) -> None:
        # Verified on the board: the display shows only the first line, about 8 characters.
        word = (text.split("\n")[0].strip() or " ")[:8]
        if word == self._last_word:     # the warden re-sends countdown text every second
            return
        self._ok(self.dev.gui.show_text(word), "show_text")
        self._last_word = word

    def led(self, leds, r, g, b, mode) -> None:
        # duration semantics are UNVERIFIED on hardware; the warden re-sends state every 2 s.
        for i in leds:
            self._ok(self.dev.gui.set_led_color(i, r, g, b, 3000, self.modes[mode]), "set_led_color")

    def tone(self, hz, ms, amp) -> None:
        # Verified workaround: a 200 ms tone once stuck on. Always 100 ms, then silence and stream off.
        a = self.dev.io.audio
        self._ok(a.tone(float(hz), 100.0, 0.3), "tone")
        time.sleep(0.12)
        self._ok(a.tone(440.0, 50.0, 0.0), "tone off")
        self._ok(a.enable_audio_stream(0), "enable_audio_stream")

    def clear(self) -> None:
        self._ok(self.dev.gui.clear_display(), "clear_display")
        self._last_word = None

    def poll_buttons(self) -> list[str]:
        mask = self._ok(self.dev.gui.panels.read_buttons(), "read_buttons")
        if not isinstance(mask, int) or not mask:
            return []
        return [name for bit, name in enumerate(BUTTONS) if mask & (1 << bit)]


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


def make_backend(name: str) -> Backend:
    return {"sim": SimBackend, "legacy": LegacyBackend, "onewili": OneWiliBackend}[name]()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["sim", "legacy", "onewili"], default="sim")
    ap.add_argument("--sim", action="store_true", help="alias for --backend sim")
    ap.add_argument("--timeout", type=float, default=3.0, help="per device call, seconds")
    ap.add_argument("--connect-timeout", type=float, default=10.0)
    ap.add_argument("--buttons", choices=["auto", "device", "none"], default="auto",
                    help="button source. auto = device, except onewili where device reads fail (verified): none, "
                         "so presses come from the warden keyboard or phone page")
    ap.add_argument("--sound", choices=["auto", "on", "off"], default="auto",
                    help="auto = off for onewili (tones got stuck on the real board), on for sim and legacy")
    ap.add_argument("--leds-brightness", type=float, default=1.0, help="scale LED rgb, 0.0 to 1.0")
    ap.add_argument("--poll", type=float, default=0.1, help="button poll interval, seconds")
    args = ap.parse_args()
    backend = make_backend("sim" if args.sim else args.backend)
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
                    emit({"event": "button", "name": name})
            except Exception as e:  # noqa: BLE001
                report(e)
            stop.wait(args.poll)

    use_device_buttons = args.buttons == "device" or (args.buttons == "auto" and backend.name != "onewili")
    if use_device_buttons:
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
        except Exception as e:  # noqa: BLE001
            report(e)
    stop.set()
    try:
        backend.close()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
