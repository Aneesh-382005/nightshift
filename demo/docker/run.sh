#!/bin/sh
# PID 1: restart loop. /run/web.down is the "stopped on purpose" flag used by svc and the break script.
while true; do
  if [ -e /run/web.down ]; then sleep 1; continue; fi
  python /srv/app.py
  echo "app exited $?, restarting" >&2
  sleep 1
done
