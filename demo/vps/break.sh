#!/bin/sh
# Run ON the machine (or: ssh host 'sh nightshift-vps/demo/vps/break.sh disk'). Faults: service | config | disk | folder | all
R=${NS_ROOT:-$HOME/ns-demo}; UNIT=${NS_UNIT:-ns-demo}
case "${1:-service}" in
  service) systemctl --user stop "$UNIT" ;;
  config)  echo 'corrupted ###' > "$R/etc/app.conf" ;;
  disk)    head -c 30000000 /dev/zero > "$R/tmp/flood.bin" ;;
  folder)  rm -rf "$R/srv/app" ;;
  all)     systemctl --user stop "$UNIT"; echo 'corrupted ###' > "$R/etc/app.conf"; head -c 30000000 /dev/zero > "$R/tmp/flood.bin"; rm -rf "$R/srv/app" ;;
  *) echo "usage: break.sh service|config|disk|folder|all" >&2; exit 2 ;;
esac
echo "broke ${1:-service}"
