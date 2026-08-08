/* global AbortSignal, fetch, process, setTimeout */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const requestTimeoutMilliseconds = 5_000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForHealth({
  url,
  maxAttempts,
  intervalMilliseconds,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
      if (response.ok) return;
    } catch {
      // The service can legitimately refuse its loopback port while it starts.
    }

    if (attempt < maxAttempts) await sleepImpl(intervalMilliseconds);
  }

  throw new Error(
    `The notification API did not become healthy after ${maxAttempts} attempts.`,
  );
}

function parsePositiveInteger(value, name, minimum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}.`);
  }
  return parsed;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [, , url, attempts, intervalSeconds] = process.argv;
  if (!url || attempts === undefined || intervalSeconds === undefined) {
    throw new Error(
      "Usage: atoqueue-wait-for-health URL MAX_ATTEMPTS INTERVAL_SECONDS",
    );
  }
  await waitForHealth({
    url,
    maxAttempts: parsePositiveInteger(attempts, "MAX_ATTEMPTS", 1),
    intervalMilliseconds:
      parsePositiveInteger(intervalSeconds, "INTERVAL_SECONDS", 0) * 1_000,
  });
}
