#!/bin/sh
# usage: demo/break.sh <web-1|web-2|laptop> <fault>
#   web-1/web-2 faults: service | disk | config | folder | all     (folder = /srv/app deleted)
#   laptop (SANDBOX ~/nightshift-playground) faults: folder        (projects/notes deleted)
c=${1:?container}; what=${2:-service}
if [ "$c" = laptop ]; then
  [ "$what" = folder ] || { echo "laptop fault: folder" >&2; exit 2; }
  docker exec laptop-sandbox rm -rf /playground/projects/notes
  echo "laptop sandbox: deleted projects/notes"; exit 0
fi
brk_service() { docker exec "$c" sh -c 'touch /run/web.down; kill $(cat /run/app.pid) 2>/dev/null; true'; }
brk_disk()    { docker exec "$c" sh -c 'head -c 30000000 /dev/zero > /var/log/app/flood.log'; }
brk_config()  { docker exec "$c" sh -c 'echo "corrupted ###" > /etc/app.conf'; }
brk_folder()  { docker exec "$c" rm -rf /srv/app; }
case "$what" in
  service) brk_service ;; disk) brk_disk ;; config) brk_config ;; folder) brk_folder ;;
  all) brk_service; brk_disk; brk_config; brk_folder ;;
  *) echo "usage: break.sh <container> service|disk|config|folder|all" >&2; exit 2 ;;
esac
echo "$c: broke $what"
