# FREE-WILi original (FW1 / "OG") from Ubuntu 24.04 with Python

Researched 2026-10-03. Labels: VERIFIED = copied from an official repo/doc.
UNVERIFIED = my inference or adapted; nothing here was run on hardware.

## 0. Bottom line

- `freewili` (freewili-python) targets the LEGACY FW1 firmware line. Its README says:
  "THE FW 1 firmware supported by this API is deprecated. The new OG fimware for
  freeWili 1 uses the OneWili API." (VERIFIED)
- Your device is "FreeWili 1 OG" hardware. Whether freewili-python works depends on
  which firmware is flashed. Legacy firmware (release_v73 and older line): library
  works. OG firmware (v023/v024+): library is NOT the supported path; use `onewili`.
- Caveat: OneWili docs are generated from the FreeWili 2 firmware menu sources
  (docs index says so). Which of its 628 commands exist on OG firmware is UNCLEAR.
  OG firmware v023 notes say "Update OG integration with the current shared menu
  implementation", so a shared serial menu exists, but no OG-specific command list
  was found. Plan to probe the device and expect gaps.
- Practical hackathon path: first confirm firmware (section 1), then try the
  matching library. If one fails, the other firmware may be flashed (section 1.3),
  but that erases the MAIN CPU and files. Back up first.

## 1. Firmware: legacy FW1 vs OG

### 1.1 Facts (VERIFIED unless noted)
- freewili-firmware repo readme: "Firmware releases for the original FreeWili
  1-OG (RP2040)". Current release v024 (MAIN 024 / DISPLAY 020, 2026-09-28).
  "release_v73 is deprecated legacy firmware. Its version numbering belongs to the
  old firmware line; it is not newer than OG 024."
- wiliOGbsp: "FreeWili 1 OG is the new name for the FreeWili 1 firmware." It is a C
  board-support package (Pico SDK) for writing on-device apps, not a PC API.
  Display CPU: ST7789 LCD, 5 buttons, 7 WS2812, IR, PDM mic, I2S speaker, LIS3DH
  accelerometer, MCP7940 RTC. Main CPU: 2 CC1101, iCE40 FPGA, breakout IO.
- fwOGAppExplorer: "Installing the original (deprecated) FreeWili 1 firmware
  removes the display bootloader again." OG apps need the OG display bootloader.
- OG USB IDs: VID:PID 093C:2054 (MAIN), 093C:2055 (DISPLAY); product string
  "FWOG <cpu> <name> <version>". A board under OG firmware never enumerates its
  FTDI, so its serial shows "Unknown".

### 1.2 How to check which firmware you run
No official "check firmware" command found. Do these (UNVERIFIED, inferred from the
facts above):
1. `lsusb | grep -i -E "093c|2e8a|0403"`. If you see 093c:2054 and 093c:2055 with
   "FWOG ..." product strings: OG firmware. If you instead see an FTDI (0403:6014)
   plus RP2040 CDC ports and no 093c:2054: likely legacy.
   Also `lsusb -v -d 093c: 2>/dev/null | grep -E "iProduct|iSerial"`.
2. Install the OG tool (below) and run `fwogcli list` then `fwogcli info`. Or `pip
   install freewili` and run `fwi-serial --help`/the find example; legacy firmware
   is the one it can talk to.
3. Power-on screen likely shows version (UNVERIFIED).

### 1.3 How to update (VERIFIED from freewili-firmware readme)
1. Download `ogfw_main-024.uf2` from
   https://github.com/freewili/freewili-firmware/releases/latest (the ZIP itself is
   not flashable; the UF2 is inside `firmware/`).
2. Get FreeWili OG App Explorer: https://github.com/freewili/fwOGAppExplorer
   Windows has a prebuilt zip. Linux: build from source only (CMake 3.28+, Ninja,
   C++23 compiler, libudev, X11/Wayland dev packages). It "has flashed a real board"
   on Linux. Ubuntu 24.04 gcc is 13, C++23 support may be marginal (UNVERIFIED).
3. If the board never ran OG apps: tab "OG Bootloader Installer" then "Install
   FreeWili OG Bootloader" once. It erases MAIN first; back up files.
4. Put the UF2 in App Explorer's `catalog/` folder, select it, check MAIN 024 /
   DISPLAY 020, press Flash. Keep USB power until MAIN restarts and updates DISPLAY.
5. CLI alternative (same engine):
   `fwogcli info ogfw_main-024.uf2`, `fwogcli list`,
   `fwogcli flash ogfw_main-024.uf2 --cpu main --device <chip-id>`.
- Only put ONE CPU in BOOTSEL at a time (both show as RPI-RP2). Never flash a display
  application directly: the display CPU has no BOOTSEL button (wiliOGbsp).
- Legacy firmware downloads live in the same repo (`Legacy/`, `release_v73`) for
  "historical recovery only". Exact UF2 procedure for legacy not verified.
- Windows-only prebuilt tools is a real hurdle on Ubuntu; a Windows machine may be
  easier for flashing.

## 2. Python packages, install, udev

### 2.1 Legacy library (VERIFIED)
- PyPI name `freewili`, latest 0.0.51 (2026-03-24), Python >= 3.10.
  Deps: pyserial, pillow, result, pyfwfinder (device discovery).
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install freewili
```
- CLIs bundled: `fwi-serial` (talk to device over serial), `fwi-convert` (image to
  .fwi for display). Run `--help` for usage. Docs:
  https://freewili.github.io/freewili-python/ (docs say Linux needs
  `/etc/udev/rules.d/99-freewili.rules`, but the rule text was not on the page).

### 2.2 OneWili library (VERIFIED install, from the repo README)
- Not on PyPI as far as I saw (UNCLEAR; not checked). Install from source:
```bash
git clone https://github.com/freewili/onewili && cd onewili/python
pip install -e .
```
- Python 3.10+, auto-discovery via `pyfwfinder`.

### 2.3 udev / serial permissions on Ubuntu
- Ubuntu gives tty ports to group `dialout`. Simplest (VERIFIED advice from
  fwOGAppExplorer README): `sudo usermod -aG dialout $USER`, then log out and in.
- Narrow rule shipped for OG (VERIFIED, packaging/60-fwog-app-explorer.rules),
  save as `/etc/udev/rules.d/60-fwog.rules`:
```
ACTION!="add|change", GOTO="fwog_end"
SUBSYSTEM!="tty", GOTO="fwog_end"
ATTRS{idVendor}=="093c", ATTRS{idProduct}=="2054", TAG+="uaccess"
ATTRS{idVendor}=="093c", ATTRS{idProduct}=="2055", TAG+="uaccess"
ATTRS{idVendor}=="2e8a", ATTRS{idProduct}=="000a", TAG+="uaccess"
LABEL="fwog_end"
```
  then `sudo udevadm control --reload && sudo udevadm trigger`.
- Legacy firmware (FTDI 0403:6014 present) may need a rule for that VID/PID; the
  official 99-freewili.rules (reportedly `MODE="0666"` on vendor 093c) was not seen.
  UNVERIFIED generic rule for legacy:
```
SUBSYSTEM=="tty", ATTRS{idVendor}=="093c", MODE="0666"
SUBSYSTEM=="usb", ATTRS{idVendor}=="093c", MODE="0666"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6014", MODE="0666"
```
- BOOTSEL volume `RPI-RP2` auto-mounts under /run/media/$USER/ with udisks2.

## 3. Examples (legacy `freewili` library; works only on legacy firmware)

Source: https://github.com/freewili/freewili-python/tree/master/examples
(default branch is `master`, not `main`). API returns `result` library objects:
use `.expect("msg")`, `.is_ok()`, `.unwrap()`.

### 3.1 Find and connect (VERIFIED, find_freewilis.py + others)
```python
from freewili import FreeWili
devices = FreeWili.find_all()
for i, fw in enumerate(devices, start=1):
    print(i, fw, fw.main, fw.display, fw.fpga)
device = FreeWili.find_first().expect("Failed to find a FreeWili")
device.open().expect("Failed to open")
# ... use device ...
device.close()
# or: with FreeWili.find_first().expect("...") as fw: ...
```

### 3.2 LEDs (VERIFIED, set_board_leds.py)
```python
for led_num in range(7):
    device.set_board_leds(led_num, 10, 10, led_num * 2).expect("Failed to set LED")  # idx, r, g, b
for led_num in reversed(range(7)):
    device.set_board_leds(led_num, 0, 0, 0).expect("Failed to set LED")
```

### 3.3 Draw text on display (UNVERIFIED usage; signature VERIFIED in fw.py)
Signature: `show_text_display(self, text: str, processor=FreeWiliProcessorType.Display)`.
No example file uses it.
```python
device.show_text_display("Hello MHacks").expect("text failed")
```

### 3.4 Buttons
Polling (VERIFIED, read_buttons.py):
```python
last = device.read_all_buttons().expect("Failed to read buttons")
while True:
    buttons = device.read_all_buttons().expect("Failed to read buttons")
    for color, state in buttons.items():
        if last[color] != state:
            print(color.name, "Pressed" if state else "Released")
    last = buttons
```
Callbacks (VERIFIED, events.py, trimmed to buttons and accel):
```python
from freewili import FreeWili
from freewili.types import EventType
def handler(event_type, frame, data):
    print(event_type, data)
fw = FreeWili.find_first().expect("Failed to find FreeWili")
with fw:
    fw.set_event_callback(handler)
    fw.enable_button_events(True, 33).expect("button events")
    fw.enable_accel_events(True, 33).expect("accel events")   # 33 = interval ms (assumed)
    while True:
        try:
            fw.process_events()
        except KeyboardInterrupt:
            break
    fw.enable_button_events(False).expect("off")
    fw.enable_accel_events(False).expect("off")
```
(Original also enables gpio/ir/battery events; the second arg meaning is not documented.)

### 3.5 Tone (VERIFIED, play_audio_tone.py; async, comment says v54 firmware always
returns failure so the example does not call .expect)
```python
import time
device.play_audio_tone(1000, 0.5, 0.5)   # frequency_hz:int, duration_sec, amplitude
time.sleep(0.5)
```
Also in API: `play_audio_file`, `play_audio_asset`, `record_audio` (examples exist).

### 3.6 Accelerometer
Only via events (3.4): `EventType.Accel` delivers `AccelData` (VERIFIED events.py).
There is no polling getter that I found. Field names of AccelData not checked.

### 3.7 RTC (signature VERIFIED in fw.py, usage UNVERIFIED)
```python
dt, extra = device.get_rtc().expect("rtc")   # Result[tuple[datetime, int], str]
print(dt)
```

### 3.8 Files on device flash
Signatures VERIFIED from fw.py/examples: `send_file(source_file, target_name=None,
processor=None, event_cb=None, chunk_size=0)`, `get_file(source_file,
destination_path, processor, event_cb)`, `list_current_directory(processor)`,
`change_directory(path, processor)`. Processors: `FreeWiliProcessorType.Main` or
`.Display` (two separate filesystems). get_file usage is VERIFIED (get_file.py);
the round trip below is UNVERIFIED.
```python
import pathlib
from freewili.fw import FreeWiliProcessorType as P
pathlib.Path("hello.txt").write_text("hi from laptop")
device.send_file("hello.txt", "/hello.txt", P.Main).expect("send")
device.get_file("/hello.txt", pathlib.Path("back.txt"), P.Main).expect("get")
print(pathlib.Path("back.txt").read_text())
```
Filesystem explorer: examples/filesystem.py. Known files: /settings.txt, /sounds,
/images, /scripts, /radio, /fpga (from get_file.py).

## 4. Examples (OneWili, OG firmware path; ALL UNVERIFIED on OG)
Verified from docs/README: connect and result matching only. Command names are from
the FW2-generated reference https://github.com/freewili/onewili/tree/HEAD/docs and
may be absent on OG. Wire path style is `menu\sub\cmd`.
```python
import onewili
dev = onewili.connect()                       # VERIFIED API
res = dev.hardware.get_time()                 # RTC read, returns tuple of 7 ints (Rust sig)
match res:
    case onewili.Ok(v): print(v)
    case onewili.Err(m): print("failed:", m)
dev.io.audio.tone(1000, 500, 0.5)             # frequency, duration_ms, amplitude
dev.io.audio.speak("hello")
dev.io.sensors.enable_motion_stream(100)      # accelerometer stream, rate ms
dev.gui.dialogs.message_box(6, True, False, False, 0, "Hello")  # shows text on LCD
dev.hardware.file_system.list_directory("/")
dev.hardware.file_system.get_file_from_pc(path, size, crc32)    # upload needs size+crc32
dev.hardware.file_system.send_file_to_pc(path)                  # download
dev.close()
```
Gaps: no documented OneWili call for the 7 onboard WS2812 (the `io.serial_leds`
menu drives external strips on GPIO 8-17,25-27); button events and text drawing
(beyond dialogs) not located; file transfer via the host protocol needs the
file-transfer doc (docs/file-transfer-hardware-smoke.md, not read). Event reading
for OneWili is via background readers; see python/README.md.
Fallback: write your own OG app in C with wiliOGbsp (LCD, buttons, WS2812 all
"verified on hardware" there), flash with fwogcli. Heavy for a hackathon.

## 5. Verify the device works
- `fwi-serial --help` (legacy lib CLI; subcommands not captured here).
- `python examples/find_freewilis.py` (legacy) or onewili `examples/list_devices.py`
  (VERIFIED file: prints `pyfwfinder.find_all()` names and serials).
- `fwogcli list` / `fwogcli info <uf2>` (OG).
- GUI: FreeWili OG App Explorer (SDL3/ImGui desktop app) lists boards and CPUs.
- Sanity: `dmesg -w` while plugging in; `ls /dev/ttyACM*`.
- Other repo: github.com/freewili/freewili-gui exists (undescribed, not checked).
  Intrepid's other tools were not evaluated.

## 6. Limits, battery, cable
- Battery: yes, 1000 mAh lithium-ion with integrated charger (freewili-og.html).
  Keep USB power connected during firmware updates. OG app contract: red button held
  6 s shuts down (display default power policy).
- USB: board has an integrated hub (3 interfaces: 2 full-speed, 1 high-speed) so it
  shows several devices. Use a DATA-capable USB cable (charge-only cables will not
  enumerate; general knowledge, UNVERIFIED for this product).
- freewili-python is "deprecated" for OG; v0.0.51 is the last release (Mar 2026).
  Audio tone call returns failure on v54 firmware by design of the example comment.
- No polling accelerometer or onboard-LED docs for OneWili on OG.
- Specs: freewili-og.html lists RP2040 main, 16 MB x 2 storage (22 MB usable),
  CC1101 radios 300-348/387-464/779-928 MHz. Page does not state the display size
  (you gave 320x240; the BSP says ST7789).
- docs.freewili.com is FreeWili 2 documentation; it does not cover OG.
- FreeWili_WebDocs repo returned 404 (renamed or private); not used.
- wiliOGbsp: breakout IO direction control and LVGL "never run on a board"; iCE40
  gateware functions not exercised.

## 7. Sources
- https://github.com/freewili/freewili-python (README, examples/, freewili/fw.py; branch master)
- https://freewili.github.io/freewili-python/
- https://pypi.org/project/freewili/
- https://github.com/freewili/onewili (README, python/README.md, docs/*.md)
- https://freewili.com/onewili/
- https://github.com/freewili/freewili-firmware (readme.md, releases/v024/README.md)
- https://github.com/freewili/fwOGAppExplorer (README, Linux, udev sections)
- https://github.com/freewili/wiliOGbsp (README.md)
- https://freewili.com/freewili-og.html
- https://docs.freewili.com (FreeWili 2; not applicable to OG)
