#!/usr/bin/env bash
# Runs on the OCI VPS as atoqueue-deploy. It never writes secrets to disk or output.
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 RELEASE_ARCHIVE RELEASE_ID" >&2
  exit 64
fi

archive=$1
release_id=$2
releases_dir=/opt/atoqueue/releases
current_link="$releases_dir/current"
service=atoqueue-notification-api.service
deploy_user=$(id -un)

if [[ ! -f "$archive" || ! "$release_id" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Release archive or release ID is invalid." >&2
  exit 64
fi

release_dir="$releases_dir/$release_id"
previous_release=""
if [[ -L "$current_link" ]]; then
  previous_release=$(readlink -f "$current_link")
fi

rollback() {
  if [[ -z "$previous_release" || ! -d "$previous_release" ]]; then
    echo "No previous release is available; stopping the failed initial release." >&2
    sudo rm -f "$current_link"
    sudo systemctl stop "$service" || true
    return 0
  fi
  echo "Rolling back to $(basename "$previous_release")." >&2
  sudo ln -sfn "$previous_release" "$current_link"
  sudo systemctl restart "$service"
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3030/healthz >/dev/null
}

if [[ -e "$release_dir" ]]; then
  echo "Release already exists: $release_id" >&2
  exit 65
fi

sudo install -d -o "$deploy_user" -g "$deploy_user" -m 0755 "$releases_dir"
install -d -m 0755 "$release_dir"
tar --extract --gzip --file "$archive" --directory "$release_dir" --no-same-owner

corepack pnpm --dir "$release_dir" install --prod --frozen-lockfile

# systemd reads the root-only environment file, then drops privileges to atoqueue.
# The deploy user never reads VAPID or PostgreSQL credentials.
if ! (
  sudo systemd-run --wait --collect --quiet \
    --property=User=atoqueue \
    --property=Group=atoqueue \
    --property=EnvironmentFile=/etc/atoqueue/notification-api.env \
    --property=WorkingDirectory="$release_dir/apps/api" \
    /usr/bin/node --input-type=module --eval '
    import { loadConfig } from "./dist/config.js";
    import { createDatabasePool } from "./dist/db/connection.js";
    import { applyInitialMigration } from "./dist/db/migrate.js";
    const pool = createDatabasePool(loadConfig(process.env));
    try { await applyInitialMigration(pool); } finally { await pool.end(); }
  '
); then
  rollback
  exit 1
fi

sudo chown -R atoqueue:atoqueue "$release_dir"
if ! sudo ln -sfn "$release_dir" "$current_link" || ! sudo systemctl restart "$service" || ! curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3030/healthz >/dev/null; then
  rollback
  exit 1
fi

echo "Release $release_id is healthy."
