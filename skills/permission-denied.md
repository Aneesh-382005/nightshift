---
slug: permission-denied
title: A file or command says permission denied
category: security
tags: permission, denied, chmod, chown, access, eacces, owner
runbook:
risk: ask
---
# The service cannot read or write a file, so find who owns it and ask. No automatic fix yet.

## Symptoms
- Logs show "Permission denied" for a path.
- `/health` fails right after a deploy or a restore.

## Check
Read-only, on the linux-server read list:
- `ls -l /etc/app.conf`
- `stat /etc/app.conf`
- `id`
- `tail -n 20 /var/log/app/app.log`
- `health`

## Fix
No automatic fix yet. The only related write on the policy list is `chmod` with a numeric mode on `/etc/app.conf`, `/var/log/app/` files or `/tmp/` files, and it needs a physical press with the exact command shown. Recursive `chown` or `chmod -R` needs press and hold.

## Rollback
Before a press-approved `chmod` the old mode must be written down in the report, so it can be set back with the same kind of command.

## Do not
- Do not `chmod 777` anything, it is forbidden.
- Do not use `sudo`, `su` or change who owns system files.
- Do not guess: read the owner and mode first, then ask.
