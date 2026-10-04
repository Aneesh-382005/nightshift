"""Logic tests for the button edge detector and the double-shake detector. No hardware needed.
Run: .venv/bin/python tests/test_logic.py
rest_sample.json is a REAL recording from the board at rest (tests/record_rest.py); the shake frames are synthetic,
shaped after the lead's real measurements (900 to 2450 mg peaks at about 18 Hz)."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from bridge import ButtonEdges, ShakeDetector

# ---- buttons ----
e = ButtonEdges()
assert e.feed("0 0 0 0 0", 0.0) == []
assert e.feed("0 0 1 0 0", 1.0) == ["green"]            # rising edge
assert e.feed("0 0 1 0 0", 1.05) == []                  # still held, change frames repeat
assert e.feed("0 0 1 0 0", 2.0) == []                   # 1 Hz heartbeat while held: never act twice
assert e.feed("0 0 0 0 0", 3.0) == []                   # release
assert e.feed("0 0 0 0 0", 4.0) == []                   # heartbeat at rest
assert e.feed("0 0 1 0 0", 5.0) == ["green"]            # second press works
assert e.feed("0 0 0 0 0", 5.02) == []
assert e.feed("0 0 1 0 0", 5.03) == []                  # bounce within 50 ms of the last rise is ignored
assert e.feed("0 0 0 0 0", 5.5) == []
assert e.feed("0 0 1 0 0", 5.6) == ["green"]
assert e.feed("1 0 0 0 1", 7.0) == ["gray", "red"]      # two buttons at once
assert e.feed("garbage", 8.0) == [] and e.feed("1 0", 8.0) == []
print("buttons ok")

# ---- shake ----
rest = json.load(open(os.path.join(os.path.dirname(__file__), "rest_sample.json")))["motion"]
d = ShakeDetector()
assert not any(d.feed(ax, ay, az, t) for t, ax, ay, az in rest), "real rest sample must not trigger"

def burst(d, t0, n=4, g=2000.0, dt=0.055):
    """n frames at |a| = g (a hard jolt), then 3 calm frames. Returns (triggered, end time)."""
    hit = False
    t = t0
    for _ in range(n):
        hit |= d.feed(0.0, 0.0, g, t); t += dt
    for _ in range(3):
        hit |= d.feed(0.0, 0.0, 1000.0, t); t += dt
    return hit, t

d = ShakeDetector()
hit, t = burst(d, 0.0)
assert not hit, "one shake never triggers"
hit, t = burst(d, t + 0.3)
assert hit, "second shake within 1.5 s triggers"
hit, t2 = burst(d, t + 0.2); hit2, _ = burst(d, t2 + 0.2)
assert not hit and not hit2, "cooldown of 3 s after a trigger"

d = ShakeDetector()
_, t = burst(d, 0.0)
hit, _ = burst(d, t + 2.0)
assert not hit, "two shakes 2 s apart do not trigger"

d = ShakeDetector()
hit, _ = burst(d, 0.0, n=40)                             # one very long shake
assert not hit, "a long single shake counts once"

d = ShakeDetector()
d.feed(0, 0, 1000.0, 0.0)
assert not d.feed(0, 0, 1900.0, 0.05) and not d.feed(0, 0, 1000.0, 0.1), "one hot frame is not a shake (needs 2 in a row)"
assert not any(d.feed(0, 0, 1000 + 300 * (-1) ** i, 0.2 + i * 0.05) for i in range(40)), "310 mg resting jitter is ignored"
print("shake ok")
