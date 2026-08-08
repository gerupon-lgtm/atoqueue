#!/usr/bin/env bash
# Installed once as root:root 0750 at /usr/local/libexec/atoqueue-deploy-release.
# GitHub Actions only uploads an archive to the deploy user's private incoming directory.
set -Eeuo pipefail
umask 022

if [[ ${EUID} -ne 0 || $# -ne 4 ]]; then
  echo "Usage: sudo $0 RELEASE_ARCHIVE MANIFEST SIGNATURE RELEASE_ID" >&2
  exit 64
fi

archive=$1
manifest=$2
signature=$3
release_id=$4
incoming_dir=/var/lib/atoqueue-deploy/incoming
quarantine_dir=/var/lib/atoqueue-deploy/quarantine
releases_dir=/opt/atoqueue/releases
current_link="$releases_dir/current"
service=atoqueue-notification-api.service
allowed_signers=/etc/atoqueue/deployment-allowed-signers
node_runtime=/opt/atoqueue/runtime/node/bin/node
corepack_runtime=/opt/atoqueue/runtime/node/bin/corepack

if [[ ! -x "$node_runtime" || ! -x "$corepack_runtime" ]]; then
  echo "The dedicated Atoqueue Node.js runtime is unavailable." >&2
  exit 69
fi

if [[ ! "$release_id" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Release ID is invalid." >&2
  exit 64
fi

expected_archive="$incoming_dir/atoqueue-api-release-$release_id.tar.gz"
expected_manifest="$incoming_dir/atoqueue-api-release-$release_id.manifest"
expected_signature="$expected_manifest.sig"
if [[ "$archive" != "$expected_archive" || "$manifest" != "$expected_manifest" || "$signature" != "$expected_signature" || ! -f "$archive" || ! -f "$manifest" || ! -f "$signature" || -L "$archive" || -L "$manifest" || -L "$signature" ]]; then
  echo "Release files are not expected regular incoming files." >&2
  exit 64
fi

source_archive=$archive
source_manifest=$manifest
source_signature=$signature
staging_dir=""
install -d -o root -g root -m 0700 "$quarantine_dir"
quarantine_run=$(mktemp -d "$quarantine_dir/$release_id.XXXXXX")
cleanup() {
  if [[ -n "${staging_dir:-}" && -d "$staging_dir" ]]; then
    rm -rf -- "$staging_dir"
  fi
  rm -rf -- "$quarantine_run"
  rm -f -- "$source_archive" "$source_manifest" "$source_signature"
}
trap cleanup EXIT

# Copy untrusted uploads exactly once before verification. The copied files have
# root-only names, ownership, and mode, so an incoming-directory writer cannot
# replace content after signature verification.
archive="$quarantine_run/archive.tar.gz"
manifest="$quarantine_run/release.manifest"
signature="$quarantine_run/release.manifest.sig"
install -m 0600 /dev/null "$archive"
install -m 0600 /dev/null "$manifest"
install -m 0600 /dev/null "$signature"
cat -- "$source_archive" > "$archive"
cat -- "$source_manifest" > "$manifest"
cat -- "$source_signature" > "$signature"

if ! ssh-keygen -Y verify -f "$allowed_signers" -I github-actions -n atoqueue-deploy -s "$signature" < "$manifest"; then
  echo "Release manifest signature is invalid." >&2
  exit 65
fi
archive_sha256=$(sha256sum "$archive" | cut -d ' ' -f 1)
if ! printf 'release_id=%s\narchive_sha256=%s\n' "$release_id" "$archive_sha256" | cmp -s - "$manifest"; then
  echo "Release manifest does not match the archive and release ID." >&2
  exit 65
fi

install -d -o root -g root -m 0755 "$releases_dir"
release_dir="$releases_dir/$release_id"
if [[ -e "$release_dir" ]]; then
  echo "Release already exists: $release_id" >&2
  exit 65
fi

previous_release=""
if [[ -L "$current_link" ]]; then
  previous_release=$(readlink -f "$current_link")
fi

staging_dir=$(mktemp -d "$releases_dir/.staging-$release_id.XXXXXX")

rollback() {
  if [[ -z "$previous_release" || ! -d "$previous_release" ]]; then
    echo "No previous release is available; stopping the failed initial release." >&2
    systemctl stop "$service" || true
    return 0
  fi
  echo "Rolling back to $(basename "$previous_release")." >&2
  ln -sfn "$previous_release" "$current_link"
  systemctl restart "$service"
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3030/healthz >/dev/null
}

# Archive extraction and dependency lifecycle scripts execute without root
# authority. The final release is then made root-owned and read-only to the
# runtime user before it is activated.
chown -R atoqueue-deploy:atoqueue-deploy "$staging_dir"
cat -- "$archive" | runuser -u atoqueue-deploy -- tar --extract --gzip --file - --directory "$staging_dir" --no-same-owner
runuser -u atoqueue-deploy -- "$corepack_runtime" pnpm --dir "$staging_dir" install --prod --frozen-lockfile
chown -R root:root "$staging_dir"
chmod -R go-w "$staging_dir"
chmod -R a-s "$staging_dir"
find "$staging_dir" -type d -exec chmod 0755 {} +
find "$staging_dir" -type f -exec chmod a+r {} +
mv "$staging_dir" "$release_dir"
staging_dir=""

# systemd reads the root-only environment file and drops privileges before Node
# evaluates the migration. The deploy account never receives secret values.
if ! systemd-run --wait --collect --quiet \
  --property=User=atoqueue \
  --property=Group=atoqueue \
  --property=EnvironmentFile=/etc/atoqueue/notification-api.env \
  --property=WorkingDirectory="$release_dir/apps/api" \
  "$node_runtime" --input-type=module --eval '
  import { loadConfig } from "./dist/config.js";
  import { createDatabasePool } from "./dist/db/connection.js";
  import { applyInitialMigration } from "./dist/db/migrate.js";
  const pool = createDatabasePool(loadConfig(process.env));
  try { await applyInitialMigration(pool); } finally { await pool.end(); }
'; then
  rollback
  exit 1
fi

if ! ln -sfn "$release_dir" "$current_link" || ! systemctl restart "$service" || ! curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3030/healthz >/dev/null; then
  rollback
  exit 1
fi

echo "Release $release_id is healthy."
