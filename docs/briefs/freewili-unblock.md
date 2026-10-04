# FREE-WILi unblock (owner: Aneesh). Goal: host control of the original FREE-WILi from this laptop.
Problem: the board runs the WiLiDoro OG app (USB name `FWOG main wilidoro 001`), which has no host command protocol, so OneWili `connect()` hangs (see docs/STATE.md).
Plan A: ask in Discord #free-wili (message in the chat). Plan B: install the legacy FW1 firmware, then use the `freewili` pip package (agents/freewili/smoke_legacy.py). Plan C: phone browser as the Lantern.
Links:
- OG App Explorer + fwogcli (the official flasher): https://github.com/freewili/fwOGAppExplorer (read: "First: the board needs the OG display bootloader", "Linux", "Command line", "Danger zone", Recovery tab)
- OG app catalog: https://docs.freewili.com/og-apps/apps.json
- OG board support package (rules: never UF2-flash a display app, one CPU in BOOTSEL at a time): https://github.com/freewili/wiliOGbsp
- Legacy firmware files: https://github.com/freewili/freewili-firmware
- Legacy Python lib + examples (branch master): https://github.com/freewili/freewili-python  docs: https://freewili.github.io/freewili-python/
- OneWili (targets FreeWili 2): https://github.com/freewili/onewili  https://freewili.com/onewili/
- Official docs (FreeWili 2 focus): https://docs.freewili.com/
Linux build of the flasher: `sudo apt install -y ninja-build libudev-dev cmake g++ pkg-config`, then in a clone of fwOGAppExplorer outside the nightshift repo: `cmake --preset linux-gcc-release && cmake --build --preset linux-gcc-release --target fwogcli`. Then `./build/linux-gcc-release/fwogcli list` and `info` (read-only) before anything else. Serial permissions are already open via udev rule 60-fwog.rules.
Safety: record board serials (E462289047324931 main, E4622890470F4B31 display), keep USB connected during a flash, flash one CPU at a time, never UF2-flash a display app directly. WiLiDoro can be restored from the catalog after reinstalling the OG bootloader.
Success test: `cd agents/freewili && .venv/bin/python smoke_legacy.py` shows text, amber LEDs, a beep, and prints button presses.
