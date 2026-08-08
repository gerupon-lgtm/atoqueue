/* global URL, process */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { waitForHealth } from "./wait-for-health.mjs";

const healthWaiter = fileURLToPath(
  new URL("./wait-for-health.mjs", import.meta.url),
);

test("wait-for-health retries a starting API until healthz succeeds", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.statusCode = requests < 3 ? 503 : 200;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  await waitForHealth({
    url: `http://127.0.0.1:${address.port}/healthz`,
    maxAttempts: 3,
    intervalMilliseconds: 0,
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(requests, 3);
});

test("health waiter command retries a starting API until healthz succeeds", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.statusCode = requests < 3 ? 503 : 200;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      healthWaiter,
      `http://127.0.0.1:${address.port}/healthz`,
      "3",
      "0",
    ]);
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(result, 0);
  assert.equal(requests, 3);
});
