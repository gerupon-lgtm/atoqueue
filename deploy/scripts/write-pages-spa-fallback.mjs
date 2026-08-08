/* global URL, process */

import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const distDirectory = resolve(
  process.argv[2] ?? resolve(repositoryRoot, "apps/web/dist"),
);
await copyFile(
  resolve(distDirectory, "index.html"),
  resolve(distDirectory, "404.html"),
);
