#!/bin/sh
# Container entrypoint: sshd as root (key-only), the demo service supervisor as the unprivileged user nsuser.
mkdir -p /run/sshd && chmod 1777 /run
/usr/sbin/sshd
exec runuser -u nsuser -- /srv/run.sh
