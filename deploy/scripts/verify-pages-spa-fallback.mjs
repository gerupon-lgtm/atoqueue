/* global URL, console, process */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const distDirectory = resolve(
  process.argv[2] ?? resolve(repositoryRoot, "apps/web/dist"),
);

try {
  const [indexHtml, fallbackHtml] = await Promise.all([
    readFile(resolve(distDirectory, "index.html")),
    readFile(resolve(distDirectory, "404.html")),
  ]);
  if (!indexHtml.equals(fallbackHtml)) {
    throw new Error("GitHub Pages fallback must match index.html exactly.");
  }
  console.log("GitHub Pages SPA fallback: OK");
} catch (error) {
  console.error(
    `GitHub Pages SPA fallback: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
