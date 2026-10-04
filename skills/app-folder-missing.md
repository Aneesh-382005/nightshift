---
slug: app-folder-missing
title: App folder was deleted
category: files
tags: folder, deleted, missing, srv/app, restore, snapshot, checksum, files
runbook: restore-app-dir
risk: safe
---
# The app folder is gone, so restore it from the known-good snapshot.

## Symptoms
- `/health` answers "500 app dir missing" and the status page says "500 app folder missing".
- The monitor alert names the missing folder.

## Check
- `ls /srv` (look for `app`, `app.snapshot` and `app.manifest`)
- `health`
- `tail -n 20 /var/log/app/app.log`

## Fix
Run the runbook `restore-app-dir` on the container devices (the same fix is called `restore-folder` on the host and laptop sandbox). It copies `/srv/app.snapshot` to `/srv/app`. Health is "folder exists and every checksum in `app.manifest` matches", then the normal `/health`.

## Rollback
Before the fix the executor records that the folder was absent. The undo moves the restored folder aside to `/srv/app.undone.<time>`. It never deletes.

## Do not
- Do not recreate an empty folder by hand.
- Do not copy over an existing folder, only restore when it is missing.
- Do not use `rm`. Destructive commands need press and hold.
