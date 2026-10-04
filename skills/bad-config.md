---
slug: bad-config
title: Config file is corrupted
category: config
tags: config, corrupted, 500, bad config, app.conf, restore, known-good
runbook: restore-config
risk: safe
---
# The app config no longer parses, so put the known-good copy back and restart.

## Symptoms
- `/health` answers "500 bad config".
- The status page shows a red "500 bad config".

## Check
- `cat /etc/app.conf` (a healthy file has port, mode and workers lines)
- `health`
- `tail -n 20 /var/log/app/app.log`

## Fix
Run the runbook `restore-config`. It copies the known-good `/srv/app.conf.good` over `/etc/app.conf` and restarts the service with `svc restart web`. It is reversible because the executor stores the exact bytes of the old file before touching it.

## Rollback
If `health` fails after the fix, the executor writes the old bytes back and verifies them. The undo button does the same later.

## Do not
- Do not edit the file by hand or with `sed -i`: that needs a press and has no known-good source.
- Do not delete the config file.
- Do not change permissions on it (`chmod` is a write that needs a press).
