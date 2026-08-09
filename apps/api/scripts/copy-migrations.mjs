import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = ["001_initial.sql", "002_recurring_reminders.sql"];
const destinationDirectory = resolve(packageRoot, "dist/db/migrations");

await mkdir(destinationDirectory, { recursive: true });
await Promise.all(migrations.map((migration) => copyFile(
  resolve(packageRoot, "src/db/migrations", migration),
  resolve(destinationDirectory, migration),
)));
