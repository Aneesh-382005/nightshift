#!/bin/sh
# usage: demo/ssh/break.sh <service|disk|config|folder|all>   (fault injection into ssh-box, as the unprivileged user)
what=${1:-service}; X="docker exec -u nsuser ssh-box"
case "$what" in
  service) $X sh -c 'touch /run/web.down; kill $(cat /run/app.pid) 2>/dev/null; true' ;;
  disk)    $X sh -c 'head -c 30000000 /dev/zero > /var/log/app/flood.log' ;;
  config)  $X sh -c 'echo "corrupted ###" > /etc/app.conf' ;;
  folder)  $X rm -rf /srv/app ;;
  all)     "$0" service; "$0" disk; "$0" config; "$0" folder ;;
  *) echo "usage: break.sh service|disk|config|folder|all" >&2; exit 2 ;;
esac
echo "ssh-box: broke $what"
