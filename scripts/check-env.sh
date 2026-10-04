#!/usr/bin/env bash
# Report which tools and devices are ready.
ok=0
check() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "ok       $1"
  else
    echo "MISSING  $1  ($2)"
    ok=1
  fi
}
check node "needed for ui and spacetime TS module"
check npm "needed for ui"
check python3 "needed for agents"
check uv "python env manager"
check spacetime "curl -sSf https://install.spacetimedb.com | sh"
check adb "sudo apt install adb, needed for Android screen capture"
check ollama "offline planner fallback"

echo
if ls /dev/ttyACM* /dev/ttyUSB* >/dev/null 2>&1; then
  echo "ok       serial device(s): $(ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null | tr '\n' ' ')"
else
  echo "MISSING  no serial device (plug in FREE-WILi)"
  ok=1
fi
if command -v adb >/dev/null 2>&1; then
  adb devices | sed -n '2,$p' | grep -q device && echo "ok       android device via adb" || { echo "MISSING  no android device (enable USB debugging)"; ok=1; }
fi
exit $ok
