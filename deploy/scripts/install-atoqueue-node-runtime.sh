#!/usr/bin/env bash
# Installed once as root:root 0750 at /usr/local/libexec/atoqueue-install-node-runtime.
# This keeps the API's Node.js runtime independent from the host-wide /usr/bin/node.
set -Eeuo pipefail
umask 022

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 64
fi

readonly runtime_root=/opt/atoqueue/runtime
readonly node_version=24.18.0
readonly archive_name=node-v24.18.0-linux-x64.tar.xz
readonly archive_url="https://nodejs.org/dist/v${node_version}/${archive_name}"
readonly archive_sha256=55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742
readonly version_dir=/opt/atoqueue/runtime/node-v24.18.0
readonly current_link=/opt/atoqueue/runtime/node

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  echo "This installer supports Linux x86_64 only." >&2
  exit 65
fi

if [[ -x "${current_link}/bin/node" ]] && [[ $("${current_link}/bin/node" --version) == "v${node_version}" ]]; then
  exit 0
fi

temporary_dir=$(mktemp -d)
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

archive_path="${temporary_dir}/${archive_name}"
curl --fail --location --proto '=https' --tlsv1.2 --output "$archive_path" "$archive_url"
printf '%s  %s\n' "$archive_sha256" "$archive_path" | sha256sum --check --status

install -d -o root -g root -m 0755 "$runtime_root"
if [[ ! -d "$version_dir" ]]; then
  tar --extract --xz --file "$archive_path" --directory "$temporary_dir"
  extracted_dir="${temporary_dir}/node-v${node_version}-linux-x64"
  test -x "${extracted_dir}/bin/node"
  mv "$extracted_dir" "$version_dir"
  chown -R root:root "$version_dir"
  chmod -R go-w "$version_dir"
fi

ln -sfn "$version_dir" "$current_link"
"${current_link}/bin/node" --version
