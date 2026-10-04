#!/bin/sh
# usage: demo/break.sh <web-1|web-2> <service|disk|config|all>
c=${1:?container}; what=${2:-service}
brk_service() { docker exec "$c" sh -c 'touch /run/web.down; kill $(cat /run/app.pid) 2>/dev/null; true'; }
brk_disk()    { docker exec "$c" sh -c 'head -c 30000000 /dev/zero > /var/log/app/flood.log'; }
brk_config()  { docker exec "$c" sh -c 'echo "corrupted ###" > /etc/app.conf'; }
case "$what" in
  service) brk_service ;; disk) brk_disk ;; config) brk_config ;;
  all) brk_service; brk_disk; brk_config ;;
  *) echo "usage: break.sh <container> service|disk|config|all" >&2; exit 2 ;;
esac
echo "$c: broke $what"
