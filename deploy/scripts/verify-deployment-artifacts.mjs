/* global URL, process */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repositoryRoot = new URL("../..", import.meta.url);

const requiredFragments = {
  ".github/workflows/deploy.yml": [
    "push:",
    "workflow_dispatch:",
    "node-version: 24",
    "environment: production",
    "atoqueue-deploy@",
    "DEPLOY_SSH_PRIVATE_KEY",
    "DEPLOY_SSH_KNOWN_HOSTS",
    "pnpm --filter @atoqueue/web build",
    "pnpm --filter @atoqueue/api build",
  ],
  "deploy/systemd/atoqueue-notification-api.service": [
    "User=atoqueue",
    "Group=atoqueue",
    "EnvironmentFile=/etc/atoqueue/notification-api.env",
    "WorkingDirectory=/opt/atoqueue/releases/current/apps/api",
    "ExecStart=/usr/bin/node ./dist/start.js",
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
  ],
  "apps/api/src/start.ts": ['host: "127.0.0.1"'],
  "docs/operations/deployment.md": [
    "atoqueue_notify",
    "atoqueue_notify_app",
    "DEPLOY_SSH_KNOWN_HOSTS",
    "/usr/sbin/nologin",
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

if (failures.length > 0) {
  throw new Error(
    `Deployment artifact contract failed:\n${failures.join("\n")}`,
  );
}

process.stdout.write(
  `Deployment artifact contract passed in ${fileURLToPath(repositoryRoot)}\n`,
);
