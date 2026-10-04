#!/bin/sh
# SANDBOX setup. Creates ~/nightshift-playground with sample files and takes the known-good snapshot
# (~/.nightshift/playground-snapshot) ONLY if no snapshot exists yet. Idempotent. Touches nothing else.
set -e
PG="$HOME/nightshift-playground"; SN="$HOME/.nightshift/playground-snapshot"
if [ ! -d "$PG" ]; then
  mkdir -p "$PG/projects/notes" "$PG/projects/site" "$PG/docs"
  printf 'buy milk\nfix the demo\n' > "$PG/projects/notes/todo.txt"
  printf '# ideas\n- sleep\n' > "$PG/projects/notes/ideas.md"
  printf '<h1>sandbox site</h1>\n' > "$PG/projects/site/index.html"
  printf 'body{margin:0}\n' > "$PG/projects/site/style.css"
  printf 'This folder is the SANDBOX. Nightshift may only touch files here.\n' > "$PG/docs/readme.txt"
fi
if [ ! -d "$SN/files" ]; then
  mkdir -p "$SN"; cp -a "$PG" "$SN/files"
  (cd "$SN/files" && find . -mindepth 1 -type d | sed 's#^\./##' | sort > ../DIRS \
    && find . -type f | sort | xargs sha256sum > ../MANIFEST)
  echo "snapshot taken in $SN"
fi
