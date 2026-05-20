#!/bin/sh
# scripts/rebrand.sh — rename MATERIA to a new identity.
#
# Usage: ./scripts/rebrand.sh [--yes] <NEW_NAME>
#   NEW_NAME  all-caps marque (e.g. MAGICITE)
#   --yes     skip confirmation prompt
#
# Bash 3.2 compatible: no associative arrays, no ${var,,}, no mapfile, no &>>
# The script must be run from the repo root.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ---- Argument parsing ----
YES=0
NEW_NAME=""
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    -*) printf '[rebrand] ERROR: unknown flag: %s\n' "$arg" >&2; exit 1 ;;
    *) NEW_NAME="$arg" ;;
  esac
done

if [ -z "$NEW_NAME" ]; then
  printf 'Usage: ./scripts/rebrand.sh [--yes] <NEW_NAME>\n' >&2
  printf 'Example: ./scripts/rebrand.sh MAGICITE\n' >&2
  exit 1
fi

# ---- Validate clean working tree ----
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  printf '[rebrand] ERROR: working tree has uncommitted changes.\n' >&2
  printf '[rebrand] Commit or stash your changes before rebranding.\n' >&2
  exit 1
fi

# ---- Derive slug (bash 3.2 compatible: use tr, not ${var,,}) ----
new_slug="$(printf '%s' "$NEW_NAME" | tr 'A-Z' 'a-z')"

# ---- Read current name from brand.toml ----
OLD_NAME="$(grep '^name ' brand.toml | head -1 | sed 's/.*= *"\([^"]*\)".*/\1/')"
old_slug="$(printf '%s' "$OLD_NAME" | tr 'A-Z' 'a-z')"

if [ -z "$OLD_NAME" ]; then
  printf '[rebrand] ERROR: could not read current [identity].name from brand.toml\n' >&2
  exit 1
fi

if [ "$OLD_NAME" = "$NEW_NAME" ]; then
  printf '[rebrand] Already named %s — nothing to do.\n' "$NEW_NAME"
  exit 0
fi

# ---- Confirmation ----
if [ "$YES" -ne 1 ]; then
  printf 'Rebrand %s → %s? [y/N] ' "$OLD_NAME" "$NEW_NAME"
  read -r ans
  case "$ans" in
    [Yy]*) ;;
    *) printf '[rebrand] Aborted.\n'; exit 0 ;;
  esac
fi

printf '[rebrand] %s → %s\n' "$OLD_NAME" "$NEW_NAME"

# ---- Derive new bundle_id and other publishing fields ----
new_bundle_id="dev.eidolons.${new_slug}"
new_homebrew_tap="rynaro/${new_slug}"
new_domain="${new_slug}.eidolons.dev"
new_github_repo="${NEW_NAME}"

# ---- Read current runner_up (for comment preservation) ----
current_runner_up="$(grep '^runner_up ' brand.toml | head -1 | sed 's/.*= *"\([^"]*\)".*/\1/')"

# ---- Rewrite brand.toml ----
# Use awk to rewrite fields in-place (no tomlq required; fields are single-line)
awk -v old_name="$OLD_NAME" \
    -v new_name="$NEW_NAME" \
    -v old_slug="$old_slug" \
    -v new_slug="$new_slug" \
    -v new_bundle_id="$new_bundle_id" \
    -v new_homebrew_tap="$new_homebrew_tap" \
    -v new_domain="$new_domain" \
    -v new_github_repo="$new_github_repo" \
    -v current_runner_up="$current_runner_up" \
    '
/^name[[:space:]]*=/ { print "name = \"" new_name "\"                    # marque, all-caps, used in display"; next }
/^slug[[:space:]]*=/ { print "slug = \"" new_slug "\"                    # lowercase, used in paths and binary names"; next }
/^display[[:space:]]*=/ { print "display = \"" new_name "\"                 # user-facing label (may differ from name later)"; next }
/^github_repo[[:space:]]*=/ { print "github_repo = \"" new_github_repo "\""; next }
/^bundle_id[[:space:]]*=/ { print "bundle_id = \"" new_bundle_id "\""; next }
/^homebrew_tap[[:space:]]*=/ { print "homebrew_tap = \"" new_homebrew_tap "\""; next }
/^domain[[:space:]]*=/ { print "domain = \"" new_domain "\""; next }
/^controlcenter_layer[[:space:]]*=/ { print "controlcenter_layer = \"" new_name "\""; next }
/^runner_up[[:space:]]*=/ { print "runner_up = \"" old_name "\"  # previous: " current_runner_up; next }
{ print }
' brand.toml > brand.toml.tmp
mv brand.toml.tmp brand.toml
printf '[rebrand] updated: brand.toml\n'

# ---- Regenerate src/lib/brand.ts ----
cat > src/lib/brand.ts << TSEOF
// AUTO-GENERATED from brand.toml — do not edit by hand.
// Run \`./scripts/rebrand.sh <NEW_NAME>\` to regenerate.

export const BRAND = {
  name: "${NEW_NAME}",
  slug: "${new_slug}",
  display: "${NEW_NAME}",
  tagline: "$(grep '^tagline' brand.toml | sed 's/.*= *"\([^"]*\)".*/\1/')",
  ffOrigin: "$(grep '^ff_origin' brand.toml | sed 's/.*= *"\([^"]*\)".*/\1/')",
  github: {
    org: "$(grep '^github_org' brand.toml | sed 's/.*= *"\([^"]*\)".*/\1/')",
    repo: "${new_github_repo}",
    url: "https://github.com/$(grep '^github_org' brand.toml | sed 's/.*= *"\([^"]*\)".*/\1/')/${new_github_repo}",
  },
  bundleId: "${new_bundle_id}",
  homebrewTap: "${new_homebrew_tap}",
  domain: "${new_domain}",
  lineage: {
    agents: "$(grep '^agents_layer' brand.toml | sed 's/.*= *"\([^"]*\)".*/\1/')",
    harness: "$(grep '^harness_layer' brand.toml | sed 's/.*= *"\([^"]*\)".*/\1/')",
    controlCenter: "${NEW_NAME}",
  },
} as const;

export type Brand = typeof BRAND;
TSEOF

# ---- Regenerate src-tauri/src/brand.rs ----
cat > src-tauri/src/brand.rs << RSEOF
// AUTO-GENERATED from brand.toml — do not edit by hand.
// Run \`./scripts/rebrand.sh <NEW_NAME>\` to regenerate.

pub const NAME: &str = "${NEW_NAME}";
pub const SLUG: &str = "${new_slug}";
pub const DISPLAY: &str = "${NEW_NAME}";
pub const TAGLINE: &str = "$(grep '^tagline' brand.toml | sed 's/.*= *"\([^"]*\)".*/\1/')";
pub const BUNDLE_ID: &str = "${new_bundle_id}";
pub const GITHUB_URL: &str = "https://github.com/$(grep '^github_org' brand.toml | sed 's/.*= *"\([^"]*\)".*/\1/')/${new_github_repo}";
RSEOF

printf '[rebrand] regenerated: src/lib/brand.ts, src-tauri/src/brand.rs\n'

# ---- Patch package.json ----
if command -v jq > /dev/null 2>&1; then
  jq --arg name "$new_slug" --arg product "$NEW_NAME" \
    '.name = $name | .productName = $product' \
    package.json > package.json.tmp
  mv package.json.tmp package.json
else
  # sed fallback — fields must be on a single line (which they are)
  sed -i.bak \
    -e "s/\"name\": *\"${old_slug}\"/\"name\": \"${new_slug}\"/" \
    -e "s/\"productName\": *\"${OLD_NAME}\"/\"productName\": \"${NEW_NAME}\"/" \
    package.json
  rm -f package.json.bak
fi

# ---- Patch src-tauri/tauri.conf.json ----
if command -v jq > /dev/null 2>&1; then
  jq --arg product "$NEW_NAME" \
     --arg identifier "$new_bundle_id" \
     --arg binary "$new_slug" \
    '.productName = $product | .identifier = $identifier | .mainBinaryName = $binary' \
    src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp
  mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
else
  sed -i.bak \
    -e "s/\"productName\": *\"${OLD_NAME}\"/\"productName\": \"${NEW_NAME}\"/" \
    -e "s/\"identifier\": *\"dev\.eidolons\.${old_slug}\"/\"identifier\": \"${new_bundle_id}\"/" \
    -e "s/\"mainBinaryName\": *\"${old_slug}\"/\"mainBinaryName\": \"${new_slug}\"/" \
    src-tauri/tauri.conf.json
  rm -f src-tauri/tauri.conf.json.bak
fi

# ---- Patch src-tauri/Cargo.toml ----
# [package].name is on a single line — sed is sufficient
sed -i.bak \
  -e "s/^name = \"${old_slug}\"/name = \"${new_slug}\"/" \
  src-tauri/Cargo.toml
rm -f src-tauri/Cargo.toml.bak

printf '[rebrand] patched: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml\n'

# ---- Text-replace name in README.md and CHANGELOG.md ----
# Replace the top-level project name heading and unreleased section heading only.
# Uses sed; does NOT touch historical CHANGELOG entries beyond the heading lines.
for doc_file in README.md CHANGELOG.md; do
  if [ -f "$doc_file" ]; then
    sed -i.bak \
      -e "s/${OLD_NAME}/${NEW_NAME}/g" \
      "$doc_file"
    rm -f "${doc_file}.bak"
  fi
done
printf '[rebrand] text-replaced: README.md, CHANGELOG.md\n'

# ---- Stage changes ----
git add \
  brand.toml \
  src/lib/brand.ts \
  src-tauri/src/brand.rs \
  package.json \
  src-tauri/tauri.conf.json \
  src-tauri/Cargo.toml \
  README.md \
  CHANGELOG.md

printf '[rebrand] done. Review with `git diff --staged` and commit when satisfied.\n'
git diff --stat --staged
