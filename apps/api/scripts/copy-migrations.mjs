import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "src/db/migrations/001_initial.sql");
const destination = resolve(packageRoot, "dist/db/migrations/001_initial.sql");

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
