#!/usr/bin/env bash
set -euo pipefail

# Resolve the repository root from this script, so it works no matter which
# directory the developer used to invoke it.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Keep Tauri's intermediate build output separate from the exported packages.
TAURI_TARGET_DIR="$ROOT_DIR/src-tauri/target"
TAURI_BUNDLE_DIR="$TAURI_TARGET_DIR/release/bundle"
ARTIFACT_DIR="$ROOT_DIR/dist/tauri/linux"
# Build the standard Linux installers by default. Callers can override this
# list, for example A8E_TAURI_BUNDLES=deb,rpm, without editing the script.
BUNDLES="${A8E_TAURI_BUNDLES:-deb,rpm,appimage}"
cd "$ROOT_DIR"

# Delete only Tauri's generated target tree. This removes compiled binaries,
# temporary bundle staging directories, and stale packages, never Rust source
# files or Tauri configuration under src-tauri/.
clean_tauri_target() {
  if [[ -e "$TAURI_TARGET_DIR" ]]; then
    rm -rf -- "$TAURI_TARGET_DIR"
  fi
}

if [[ -f "$HOME/.cargo/env" ]]; then
  # Make rustup-managed Cargo available in non-login shells.
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

# Verify the command-line tools required to drive a native Tauri build.
for command_name in cargo pkg-config; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
done

# Verify that the Tauri Cargo subcommand is installed before starting a build.
if ! cargo tauri --version >/dev/null 2>&1; then
  printf 'Missing cargo-tauri. Install it with:\n' >&2
  printf '  cargo install tauri-cli --version "^2.0.0" --locked\n' >&2
  exit 1
fi

# Verify the Linux libraries that Tauri's WebKitGTK backend compiles against.
for package_name in glib-2.0 webkit2gtk-4.1; do
  if ! pkg-config --exists "$package_name"; then
    printf 'Missing Linux development package: %s\n' "$package_name" >&2
    printf 'Install Tauri prerequisites before building.\n' >&2
    exit 1
  fi
done

# Start from an empty target tree so a previous AppImage, deb, or rpm cannot
# be mistaken for a package produced by this invocation.
clean_tauri_target

# Build the requested native packages from the repository's Tauri config.
printf 'Building jsA8E Linux distribution...\n'
printf 'Bundle targets: %s\n' "$BUNDLES"
cargo tauri build \
  --config "$ROOT_DIR/src-tauri/tauri.conf.json" \
  --bundles "$BUNDLES"

# Collect only installable packages. Tauri also creates helper files inside
# bundle directories, which must not be exported as release artifacts.
mapfile -t package_paths < <(
  find "$TAURI_BUNDLE_DIR" -maxdepth 2 -type f \
    \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \) \
    -print | sort
)

# A successful Tauri command without a package would otherwise silently clean
# the old output directory, so fail before replacing the previous export.
if (( ${#package_paths[@]} == 0 )); then
  printf 'Tauri completed without generating an installable package.\n' >&2
  exit 1
fi

# Replace the prior exported release as one unit, then copy only this build's
# packages outside src-tauri. This prevents stale formats from surviving.
rm -rf -- "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"
for package_path in "${package_paths[@]}"; do
  cp -- "$package_path" "$ARTIFACT_DIR/"
done

# The packages are safely exported, so remove all generated Tauri remnants
# from src-tauri and leave the checkout ready for source work.
clean_tauri_target

printf '\nExported distribution artifacts:\n'
find "$ARTIFACT_DIR" -maxdepth 1 -type f -print | sort
