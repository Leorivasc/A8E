#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLES="${A8E_TAURI_BUNDLES:-deb,rpm}"
cd "$ROOT_DIR"

if [[ -f "$HOME/.cargo/env" ]]; then
  # Make rustup-managed Cargo available in non-login shells.
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

for command_name in cargo pkg-config; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
done

if ! cargo tauri --version >/dev/null 2>&1; then
  printf 'Missing cargo-tauri. Install it with:\n' >&2
  printf '  cargo install tauri-cli --version "^2.0.0" --locked\n' >&2
  exit 1
fi

for package_name in glib-2.0 webkit2gtk-4.1; do
  if ! pkg-config --exists "$package_name"; then
    printf 'Missing Linux development package: %s\n' "$package_name" >&2
    printf 'Install Tauri prerequisites before building.\n' >&2
    exit 1
  fi
done

printf 'Building jsA8E Linux distribution...\n'
printf 'Bundle targets: %s\n' "$BUNDLES"
cargo tauri build \
  --config "$ROOT_DIR/src-tauri/tauri.conf.json" \
  --bundles "$BUNDLES"

printf '\nGenerated distribution artifacts:\n'
find "$ROOT_DIR/src-tauri/target/release/bundle" -maxdepth 2 -type f \
  \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \) \
  -print | sort
