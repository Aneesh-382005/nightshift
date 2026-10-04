---
slug: phone-wifi-flapping
title: Phone Wi-Fi keeps dropping
category: network
tags: phone, android, wifi, flapping, unstable, bounce, reconnect
runbook: wifi-bounce
risk: safe
---
# Wi-Fi is on but unstable, so switch it off and on once to force a clean reconnect.

## Symptoms
- `wifi_on` is 1 but connectivity checks fail on and off.
- Repeated "phone lost wifi connectivity" alerts.

## Check
- `settings get global wifi_on`
- `dumpsys wifi`
- `dumpsys connectivity`
- `logcat -d -t 50`
- `ping -c 1 -W 2 8.8.8.8`

## Fix
Run the runbook `wifi-bounce`: disable, wait 2 s, enable, wait 5 s. Health is `wifi_on` equal to 1 and one successful ping. Only the Wi-Fi switch changes.
The phone is briefly offline, so use it only when adb runs over USB.

## Rollback
The inverse is `svc wifi enable`. If health fails the executor runs it by itself.

## Do not
- Do not bounce in a loop. Two failed fixes trip the circuit breaker and a human is called.
- Do not change airplane mode or other settings to "help".
- Do not run it if the only link to the phone is its own Wi-Fi.
