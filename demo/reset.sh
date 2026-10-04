#!/bin/sh
# usage: demo/reset.sh [web-1 web-2 laptop pixel ...]   (default web-1 web-2 pixel; pixel turns phone Wi-Fi on and verifies). Restores config, logs, /srv/app, service; laptop restores the sandbox from its snapshot.
[ $# -eq 0 ] && set -- web-1 web-2 pixel
for c in "$@"; do
  if [ "$c" = pixel ]; then
    S=${PIXEL_SERIAL:-54241FDAP002UZ}
    adb -s "$S" shell svc wifi enable >/dev/null 2>&1
    i=0; v=
    while [ $i -lt 10 ]; do v=$(adb -s "$S" shell settings get global wifi_on 2>/dev/null | tr -d '\r'); [ "$v" = 1 ] && break; sleep 1; i=$((i+1)); done
    if [ "$v" = 1 ]; then echo "pixel: wifi on (wifi_on=1)"; else echo "pixel: wifi NOT on (wifi_on=$v)" >&2; fi
    continue
  fi
  if [ "$c" = laptop ]; then
    docker exec laptop-sandbox sh -c 'find /playground -name "*.undone.*" -prune -exec rm -rf {} + ; cp -a /snapshot/files/. /playground/' && echo "laptop sandbox: restored from snapshot"
    continue
  fi
  docker exec "$c" sh -c 'cp /srv/app.conf.good /etc/app.conf; rm -f /var/log/app/flood.log; rm -rf /var/log/app.rotated.* /run/rotate.last /srv/app.undone.*; mkdir -p /var/log/app; rm -rf /srv/app; cp -a /srv/app.snapshot /srv/app; svc restart web' \
    && echo "$c: reset, health=$(docker exec "$c" health && echo ok || echo FAIL)"
done
