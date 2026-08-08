/* global URL, process */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repositoryRoot = new URL("../..", import.meta.url);

const requiredFragments = {
  ".github/workflows/ci.yml": [
    "pnpm exec prettier --check .github deploy/scripts/*.mjs docs/operations/deployment-health-startup.md",
    "pnpm --filter @atoqueue/contracts build",
  ],
  ".github/workflows/deploy.yml": [
    "push:",
    "workflow_dispatch:",
    "node-version: 24",
    "environment: production",
    "atoqueue-deploy@",
    "DEPLOY_SSH_PRIVATE_KEY",
    "DEPLOY_SSH_KNOWN_HOSTS",
    "DEPLOY_ARTIFACT_SIGNING_PRIVATE_KEY",
    "ssh-keygen -Y sign",
    ".manifest.sig",
    "/var/lib/atoqueue-deploy/incoming/atoqueue-api-release-",
    "sudo /usr/local/libexec/atoqueue-deploy-release",
    "pnpm --filter @atoqueue/web build",
    "pnpm --filter @atoqueue/api build",
  ],
  "deploy/systemd/atoqueue-notification-api.service": [
    "User=atoqueue",
    "Group=atoqueue",
    "EnvironmentFile=/etc/atoqueue/notification-api.env",
    "WorkingDirectory=/opt/atoqueue/releases/current/apps/api",
    "ExecStart=/opt/atoqueue/runtime/node/bin/node ./dist/start.js",
    "Restart=on-failure",
  ],
  "deploy/caddy/atoqueue-api.caddyfile": [
    "https://api.atoqueue.sikumilab.com",
    "reverse_proxy 127.0.0.1:3030",
  ],
  "deploy/scripts/deploy-release.sh": [
    "systemd-run --wait --collect --quiet",
    'systemctl restart "$service"',
    "http://127.0.0.1:3030/healthz",
    "rollback",
    "runuser -u atoqueue-deploy --",
    "chown -R root:root",
    "chmod -R go-w",
    'rm -f -- "$source_archive"',
    "runuser -u atoqueue-deploy -- tar --extract --gzip --file -",
    "chmod -R a-s",
    "/etc/atoqueue/deployment-allowed-signers",
    "ssh-keygen -Y verify",
    "sha256sum",
    "/var/lib/atoqueue-deploy/quarantine",
    "install -m 0600 /dev/null",
    "/opt/atoqueue/runtime/node/bin/node",
    "/opt/atoqueue/runtime/node/bin/corepack",
    "/usr/local/libexec/atoqueue-wait-for-health.mjs",
    'PATH="$2:/usr/bin:/bin"',
  ],
  "deploy/scripts/wait-for-health.mjs": [
    "waitForHealth",
    "AbortSignal.timeout",
    "MAX_ATTEMPTS",
  ],
  "deploy/scripts/install-atoqueue-node-runtime.sh": [
    "node_version=24.18.0",
    "node-v24.18.0-linux-x64.tar.xz",
    "55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742",
    "/opt/atoqueue/runtime/node",
    "sha256sum --check --status",
  ],
  "apps/api/src/start.ts": ['host: "127.0.0.1"'],
  "docs/operations/deployment.md": [
    "atoqueue_notify",
    "atoqueue_notify_app",
    "DEPLOY_SSH_KNOWN_HOSTS",
    "/usr/sbin/nologin",
    "sudo systemctl reload caddy",
    "80/tcp",
    "443/tcp",
    "visudo",
    "/usr/local/libexec/atoqueue-deploy-release",
    "DEPLOY_ARTIFACT_SIGNING_PRIVATE_KEY",
    "/etc/atoqueue/deployment-allowed-signers",
    "/opt/atoqueue/runtime/node/bin/node",
    "Node.js 20",
    "import /etc/caddy/conf.d/*.caddyfile",
  ],
};

const failures = [];
for (const [relativePath, fragments] of Object.entries(requiredFragments)) {
  let content;
  try {
    content = await readFile(new URL(relativePath, repositoryRoot), "utf8");
  } catch {
    failures.push(`${relativePath}: missing`);
    continue;
  }
  for (const fragment of fragments) {
    if (!content.includes(fragment))
      failures.push(`${relativePath}: missing ${JSON.stringify(fragment)}`);
  }
}

const caddy = await readFile(
  new URL("deploy/caddy/atoqueue-api.caddyfile", repositoryRoot),
  "utf8",
);
const proxyLines = caddy
  .split("\n")
  .filter((line) => line.trim().startsWith("reverse_proxy"));
if (
  proxyLines.length !== 1 ||
  proxyLines[0].trim() !== "reverse_proxy 127.0.0.1:3030"
) {
  failures.push(
    "deploy/caddy/atoqueue-api.caddyfile: must contain exactly one loopback reverse proxy",
  );
}

for (const relativePath of [
  ".github/workflows/deploy.yml",
  "deploy/systemd/atoqueue-notification-api.service",
  "deploy/caddy/atoqueue-api.caddyfile",
  "deploy/scripts/deploy-release.sh",
]) {
  const content = await readFile(new URL(relativePath, repositoryRoot), "utf8");
  if (content.includes("VAPID_PRIVATE_KEY=")) {
    failures.push(
      `${relativePath}: must not contain a VAPID private key value`,
    );
  }
}

const workflow = await readFile(
  new URL(".github/workflows/deploy.yml", repositoryRoot),
  "utf8",
);
if (workflow.includes("/tmp/atoqueue-")) {
  failures.push(
    ".github/workflows/deploy.yml: must not upload deploy artifacts through /tmp",
  );
}

const service = await readFile(
  new URL("deploy/systemd/atoqueue-notification-api.service", repositoryRoot),
  "utf8",
);
if (service.includes("ReadWritePaths=")) {
  failures.push(
    "deploy/systemd/atoqueue-notification-api.service: runtime service must not have a writable release tree",
  );
}

const releaseScript = await readFile(
  new URL("deploy/scripts/deploy-release.sh", repositoryRoot),
  "utf8",
);
for (const [relativePath, content] of [
  ["deploy/systemd/atoqueue-notification-api.service", service],
  ["deploy/scripts/deploy-release.sh", releaseScript],
]) {
  if (content.includes("/usr/bin/node")) {
    failures.push(`${relativePath}: must not use the host Node.js runtime`);
  }
}
if (releaseScript.includes("runuser -u atoqueue-deploy -- corepack")) {
  failures.push(
    "deploy/scripts/deploy-release.sh: must not use the host Corepack runtime",
  );
}
if (!releaseScript.includes('PATH="$2:/usr/bin:/bin"')) {
  failures.push(
    "deploy/scripts/deploy-release.sh: must run Corepack with the dedicated Node.js runtime first in PATH",
  );
}

if (failures.length > 0) {
  throw new Error(
    `Deployment artifact contract failed:\n${failures.join("\n")}`,
  );
}

process.stdout.write(
  `Deployment artifact contract passed in ${fileURLToPath(repositoryRoot)}\n`,
);
