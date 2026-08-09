import { execFileSync, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function buildApi(): void {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `${packageManager} --filter @atoqueue/api build`], { cwd: repositoryRoot, stdio: "inherit" });
    return;
  }
  execFileSync(packageManager, ["--filter", "@atoqueue/api", "build"], { cwd: repositoryRoot, stdio: "inherit" });
}

describe("production API build", () => {
  it("ships initial and recurring migrations alongside compiled migration code", async () => {
    buildApi();
    const sqlAsset = new URL("../dist/db/migrations/001_initial.sql", import.meta.url);
    await expect(access(sqlAsset)).resolves.toBeUndefined();
    const recurringAsset = new URL("../dist/db/migrations/002_recurring_reminders.sql", import.meta.url);
    await expect(access(recurringAsset)).resolves.toBeUndefined();

    const compiledMigrationModule = new URL("../dist/db/migrate.js", import.meta.url).href;
    const { applyInitialMigration } = await import(compiledMigrationModule);
    const executed: string[] = [];
    await applyInitialMigration({ query: async (sql: string) => { executed.push(sql); } } as never);
    expect(executed).toHaveLength(2);
    expect(executed[0]).toContain("CREATE TABLE IF NOT EXISTS device_subscriptions");
    expect(executed[1]).toContain("repeat_cadence");
  }, 45_000);

  it("can import the compiled production startup without resolving workspace TypeScript source", () => {
    buildApi();
    const entry = new URL("../dist/start.js", import.meta.url).href;
    execFileSync(process.execPath, ["--input-type=module", "--eval", `import(${JSON.stringify(entry)})`], { cwd: repositoryRoot, stdio: "pipe" });
  }, 45_000);

  it("executes the compiled entrypoint when Node receives its relative start-script path", () => {
    buildApi();
    const apiRoot = fileURLToPath(new URL("../", import.meta.url));
    const result = spawnSync(process.execPath, ["./dist/start.js"], { cwd: apiRoot, encoding: "utf8", env: {} });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Notification API failed to start.");
  }, 45_000);
});
