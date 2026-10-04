"""Mocked-disconnect test for the onewili backend recovery. No hardware, no sleeps beyond a few hundred ms.
Run: .venv/bin/python tests/test_recovery.py"""
import os, queue, sys, time, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import bridge

class Err:
    def __init__(self, m): self.m = m
    def __str__(self): return self.m
class Ok:
    def __init__(self, v=None): self.ok_value = v

class FakeDev:
    """A OneWili device. die() makes every call fail like a re-enumerated board."""
    def __init__(self, name):
        self.name, self.dead, self.calls, self.shown, self.leds, self.streams = name, False, 0, [], [], []
        self._transport = types.SimpleNamespace(events=queue.Queue())
        d = self
        def op(label, record=None):
            def f(*a):
                d.calls += 1
                if d.dead: return Err("write failed: [Errno 5] Input/output error")
                if record is not None: record.append((label,) + a)
                return Ok()
            return f
        self.gui = types.SimpleNamespace(show_text=op("text", self.shown), set_led_color=op("led", self.leds), stream_io=op("stream_io", self.streams),
                                         clear_display=op("clear"))
        self.io = types.SimpleNamespace(sensors=types.SimpleNamespace(enable_motion_stream=op("motion", self.streams)),
                                        audio=types.SimpleNamespace())
    def close(self): pass
    def die(self): self.dead = True

class FakeLib:
    Err, Ok = Err, Ok
    enums = types.SimpleNamespace(owLEDManagerLEDMode=types.SimpleNamespace(SIMPLEVALUE=0, PULSE=2, FLASH=1))
    def __init__(self):
        self.devs, self.missing_scans, self.find_calls = [], 0, 0
    def connect(self):
        d = FakeDev(f"dev{len(self.devs) + 1}"); self.devs.append(d); return d
    def find_devices(self):
        self.find_calls += 1
        if self.missing_scans > 0:
            self.missing_scans -= 1
            return []                                   # board not back on USB yet
        return ["board"]

logs, events = [], []
bridge.log = lambda m: logs.append(m)
bridge.emit = lambda o: events.append(o)

def wait(cond, secs=3.0):
    t0 = time.time()
    while time.time() - t0 < secs:
        if cond(): return True
        time.sleep(0.01)
    return False

lib = FakeLib()
b = bridge.OneWiliBackend(lib=lib, backoff=(0.02, 0.06), silence_s=0.3)
b.open()
d1 = lib.devs[0]
assert d1.streams == [("stream_io", 20), ("motion", 10)]
b.text("APPROVE\ndetail"); b.led([0, 1, 2, 3, 4, 5, 6], 255, 140, 0, "pulse")
assert d1.shown == [("text", "APPROVE")] and len(d1.leds) == 7

# 1. the board re-enumerates: the next write fails, the backend marks it gone and recovers by itself
lib.missing_scans = 2                                    # first two USB scans find nothing
d1.die()
try: b.text("ACTIVE"); assert False, "expected an I/O error"
except bridge.Reconnecting: assert False, "first failure must surface the real error"
except RuntimeError as e: assert "Errno 5" in str(e)
assert b.broken
calls_before = d1.calls
for _ in range(50):                                      # a burst of warden writes while the board is gone
    try: b.led([0], 1, 2, 3, "solid"); assert False
    except bridge.Reconnecting: pass
assert d1.calls == calls_before, "no calls reach the dead handle (no error spam)"
assert wait(lambda: not b.broken), "backend must recover"
d2 = lib.devs[1]
assert d2 is not d1 and lib.find_calls == 3
assert d2.streams == [("stream_io", 20), ("motion", 10)], "streams restarted"
assert d2.shown == [("text", "APPROVE")], "current word redrawn"
assert [x[1:5] for x in d2.leds] == [(i, 255, 140, 0) for i in range(7)] and d2.leds[0][6] == 2, "LEDs redrawn (pulse)"
attempts = [m for m in logs if "reconnect attempt" in m]
assert len(attempts) == 3, attempts                      # 2 failures + 1 success, one line each
assert sum(1 for e in events if e.get("event") == "ready") == 1 and any("reconnecting" in e.get("message", "") for e in events)

# 2. normal operation resumes on the new handle
d2.gui.show_text("x"); d2.shown.clear()
b.text("DONE"); assert d2.shown == [("text", "DONE")]
d2._transport.events.put(types.SimpleNamespace(path="*button", response="0 0 1 0 0"))
assert b.poll_buttons() == ["green"]

# 3. silent stream (no write error, frames just stop) also triggers recovery
t0 = len(lib.devs)
time.sleep(0.4)
try: b.poll_buttons(); assert False, "silence must be an error"
except RuntimeError as e: assert "not responding" in str(e)
assert b.broken and wait(lambda: not b.broken) and len(lib.devs) == t0 + 1

# 4. clean shutdown stops the streams and does not start recovery
b.close()
assert ("stream_io", 0) in lib.devs[-1].streams
print("recovery ok")
