#!/bin/sh
# Restore ssh-box to known-good (runs as nsuser so file ownership stays correct).
docker exec -u nsuser ssh-box sh -c 'cp /srv/app.conf.good /etc/app.conf; rm -f /var/log/app/flood.log; rm -rf /var/log/app.rotated.* /run/rotate.last /srv/app.undone.*; mkdir -p /var/log/app; rm -rf /srv/app; cp -a /srv/app.snapshot /srv/app; svc restart web' \
  && echo "ssh-box: reset, health=$(docker exec ssh-box health && echo ok || echo FAIL)"
