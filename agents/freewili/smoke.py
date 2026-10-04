"""FREE-WILi (original, OG firmware) smoke test via OneWili: display, LEDs, tone, buttons."""
import time
import onewili
from onewili import enums

print("LED modes:", [m for m in dir(enums.owLEDManagerLEDMode) if not m.startswith("_")][:12])

dev = onewili.connect()
try:
    print("show_text      ->", dev.gui.show_text("NIGHTSHIFT\nLantern online"))
    mode = list(enums.owLEDManagerLEDMode)[0]
    for i in range(7):
        r = dev.gui.set_led_color(i, 255, 140, 0, 3000, mode)
    print("set_led_color  ->", r, "(mode", mode, ")")
    print("tone           ->", dev.io.audio.tone(880.0, 200.0, 0.3))
    time.sleep(0.5)
    print("read_buttons   ->", dev.gui.panels.read_buttons(), "(press a button in the next 5s)")
    t0 = time.time()
    while time.time() - t0 < 5:
        r = dev.gui.panels.read_buttons()
        if isinstance(r, onewili.Ok) and r.value:
            print("button bitmask ->", r)
            break
        time.sleep(0.1)
    time.sleep(2)
    print("clear_display  ->", dev.gui.clear_display())
finally:
    dev.close()
