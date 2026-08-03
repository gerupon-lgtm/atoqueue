import { execFileSync } from "node:child_process";
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
  it("ships the initial migration alongside compiled migration code", async () => {
    buildApi();
    const sqlAsset = new URL("../dist/db/migrations/001_initial.sql", import.meta.url);
    await expect(access(sqlAsset)).resolves.toBeUndefined();

    const compiledMigrationModule = new URL("../dist/db/migrate.js", import.meta.url).href;
    const { applyInitialMigration } = await import(compiledMigrationModule);
    const executed: string[] = [];
    await applyInitialMigration({ query: async (sql: string) => { executed.push(sql); } } as never);
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain("CREATE TABLE IF NOT EXISTS device_subscriptions");
  }, 20_000);
});
