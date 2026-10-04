#!/bin/sh
# Create the THROWAWAY ed25519 keypair for the ssh-box demo (demo/ssh/keys, gitignored). Idempotent.
cd "$(dirname "$0")" || exit 1
mkdir -p keys && chmod 700 keys
[ -f keys/id_ed25519 ] || ssh-keygen -q -t ed25519 -N '' -C nightshift-ssh-box-demo -f keys/id_ed25519
echo "keys ready in $(pwd)/keys"
