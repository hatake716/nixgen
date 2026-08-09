#!/usr/bin/env bash
# Download option and package metadata for one NixOS channel.
#
#   ./fetch-data.sh                  # nixos-26.05 (current stable)
#   ./fetch-data.sh nixos-25.11      # any other release
#   ./fetch-data.sh nixos-unstable   # the daily channel
#
# Writes to ../data by default. Set NIXGEN_DATA to put it somewhere else --
# needed when this script is run from the nix store, which is read-only.
#
# Needs curl and brotli. Inside `nix develop` both are already there.

set -euo pipefail

CHANNEL="${1:-nixos-26.05}"
DEST="${NIXGEN_DATA:-$(dirname "$0")/../data}"
BASE="https://channels.nixos.org/${CHANNEL}"

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

# The response headers are kept for `options`: their Last-Modified is when the
# channel published this snapshot, which is the honest answer to "how old is
# this index" — far better than when the download happened. `-D` writes them
# during the transfer that was happening anyway, so it costs no extra request.
fetch() {
  local name="$1"
  echo "  ${name}.json.br"
  curl -fL --progress-bar -D "${DEST}/.headers" \
       "${BASE}/${name}.json.br" -o "${DEST}/${name}.json.br"
  decompress "${DEST}/${name}.json.br" "${DEST}/${name}.json"
  rm -f "${DEST}/${name}.json.br"
}

echo "fetching ${CHANNEL}"
fetch options
# `-L` follows redirects, so there can be several Last-Modified lines; the one
# that counts is the last, from the response that carried the body.
grep -i '^last-modified:' "${DEST}/.headers" | tail -1 | cut -d' ' -f2- \
  | tr -d '\r' > "${DEST}/snapshot" || true
fetch packages
rm -f "${DEST}/.headers"
echo "$CHANNEL" > "${DEST}/CHANNEL"

# The nixpkgs commit this snapshot was built from. The generated flake.nix
# pins it, so what gets built is the release the options came from rather than
# whatever the branch has moved to since. Served as a redirect, hence -L.
# Not fatal if it is missing: the flake falls back to naming the branch.
echo "  git-revision"
if curl -fsSL --max-time 60 "${BASE}/git-revision" -o "${DEST}/git-revision.part"; then
  mv "${DEST}/git-revision.part" "${DEST}/git-revision"
else
  rm -f "${DEST}/git-revision.part" "${DEST}/git-revision"
  echo "  warning: no git-revision for ${CHANNEL}; flake.nix will name the branch" >&2
fi

if [ -z "${NIXGEN_DATA:-}" ]; then
  echo
  echo "done. now run:"
  echo "  python3 build/build_index.py --channel ${CHANNEL}"
fi
