---
slug: phone-wifi-off
title: Phone Wi-Fi is off
category: mobile
tags: phone, android, wifi, off, connectivity, adb, pixel
runbook: wifi-enable
risk: safe
---
# The phone lost Wi-Fi, so switch it back on and check connectivity.

## Symptoms
- Monitor alert: "wifi is off" or "phone lost wifi connectivity".
- `settings get global wifi_on` prints 0.

## Check
Device-side commands on the android read list:
- `settings get global wifi_on`
- `dumpsys wifi`
- `ping -c 1 -W 2 8.8.8.8`
- `dumpsys battery`

## Fix
Run the runbook `wifi-enable` (`svc wifi enable`, then a short wait). Health is `wifi_on` equal to 1. It changes one setting and nothing else.

## Rollback
The executor snapshots `wifi_on` first. The inverse is `svc wifi disable`, which puts the phone back as it was. Gray on the Lantern undoes it.

## Do not
- Do not reboot or factory reset (forbidden).
- Do not use `settings put` for other keys or touch adb or developer settings.
- Do not treat a failed ping alone as proof, the phone may be on cellular.
