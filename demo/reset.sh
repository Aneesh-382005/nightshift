#!/bin/sh
# usage: demo/reset.sh [container ...]   (default web-1 web-2). Restores config, logs, service.
[ $# -eq 0 ] && set -- web-1 web-2
for c in "$@"; do
  docker exec "$c" sh -c 'cp /srv/app.conf.good /etc/app.conf; rm -f /var/log/app/flood.log; rm -rf /var/log/app.rotated.* /run/rotate.last; mkdir -p /var/log/app; svc restart web' \
    && echo "$c: reset, health=$(docker exec "$c" health && echo ok || echo FAIL)"
done
