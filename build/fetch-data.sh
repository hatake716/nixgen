#!/usr/bin/env bash
# Download option and package metadata for one NixOS release channel.
#
#   ./fetch-data.sh              # nixos-26.05 (current stable)
#   ./fetch-data.sh nixos-25.11  # any other release
#
# Writes to ../data by default. Set NIXGEN_DATA to put it somewhere else --
# needed when this script is run from the nix store, which is read-only.
#
# Needs curl and brotli. Inside `nix develop` both are already there.

set -euo pipefail

CHANNEL="${1:-nixos-26.05}"
DEST="${NIXGEN_DATA:-$(dirname "$0")/../data}"
BASE="https://channels.nixos.org/${CHANNEL}"

if [[ "$CHANNEL" == *unstable* ]]; then
  echo "This build targets release channels only. Pass a nixos-YY.MM channel." >&2
  exit 1
fi

command -v curl >/dev/null || { echo "missing: curl" >&2; exit 1; }

# The channel data is brotli-compressed. `nix develop` and the flake wrapper
# both provide the CLI; outside them, Python's brotli module will do.
if command -v brotli >/dev/null; then
  decompress() { brotli -df "$1" -o "$2"; }
elif python3 -c "import brotli" 2>/dev/null; then
  decompress() {
    python3 -c "import brotli,sys
open(sys.argv[2],'wb').write(brotli.decompress(open(sys.argv[1],'rb').read()))" "$1" "$2"
  }
else
  echo "need either the brotli command or Python's brotli module" >&2
  echo "  nix-shell -p brotli   (or: nix develop)" >&2
  exit 1
fi

mkdir -p "$DEST"

fetch() {
  local name="$1"
  echo "  ${name}.json.br"
  curl -fL --progress-bar "${BASE}/${name}.json.br" -o "${DEST}/${name}.json.br"
  decompress "${DEST}/${name}.json.br" "${DEST}/${name}.json"
  rm -f "${DEST}/${name}.json.br"
}

echo "fetching ${CHANNEL}"
fetch options
fetch packages
echo "$CHANNEL" > "${DEST}/CHANNEL"

if [ -z "${NIXGEN_DATA:-}" ]; then
  echo
  echo "done. now run:"
  echo "  python3 build/build_index.py --channel ${CHANNEL}"
fi
