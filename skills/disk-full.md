---
slug: disk-full
title: Log folder is full
category: disk
tags: disk, full, logs, 503, rotate, space, log dir full
runbook: rotate-logs
risk: safe
---
# The log folder grew past its limit, so rotate it aside and delete nothing.

## Symptoms
- `/health` answers "503 log dir full".
- The status page is amber and the logs figure is above 20 MB.

## Check
- `df -P /var/log`
- `du -sk /var/log/app`
- `ls -l /var/log/app`
- `health`

## Fix
Run the runbook `rotate-logs`. It moves `/var/log/app` aside to `/var/log/app.rotated.<time>` and creates a fresh empty folder. Nothing is deleted, so the fix is fully reversible.

## Rollback
The inverse is `rotate-logs undo`, which moves the rotated files back. If `health` fails after the fix, the executor runs it automatically.

## Do not
- Do not run `rm` on logs. `rm -rf` anywhere under `/var/log` is forbidden by policy and is blocked without a press.
- Do not truncate or shred log files.
- Do not ignore the cause: after rotating, look at what wrote so much.
