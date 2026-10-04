"""FREE-WILi smoke test for the LEGACY FW1 firmware via the `freewili` pip package.
Run only after the board runs the legacy firmware: `uv pip install -p .venv/bin/python freewili`
then `.venv/bin/python smoke_legacy.py`. Shows text, lights all 7 LEDs amber, beeps, reads buttons for 8 s."""
import time
from freewili import FreeWili

fw = FreeWili.find_first().expect("no FreeWili found")
fw.open().expect("open failed")
try:
    print("show_text_display ->", fw.show_text_display("NIGHTSHIFT\nLantern online"))
    for i in range(7):
        fw.set_board_leds(i, 255, 140, 0).expect("led failed")      # idx, r, g, b (amber)
    print("leds amber")
    print("tone ->", fw.play_audio_tone(880, 0.2, 0.3))             # hz, seconds, amplitude
    time.sleep(0.5)
    print("press buttons for 8 seconds...")
    last = fw.read_all_buttons().expect("buttons")
    t0 = time.time()
    while time.time() - t0 < 8:
        cur = fw.read_all_buttons().expect("buttons")
        for color, state in cur.items():
            if last[color] != state:
                print(color.name, "pressed" if state else "released")
        last = cur
        time.sleep(0.05)
    for i in reversed(range(7)):
        fw.set_board_leds(i, 0, 0, 0)
finally:
    fw.close()
print("done")
