import { expect, test } from "@playwright/test";

test("Settings exposes portable JSON export and an explicit restore control", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("button", { name: "JSONバックアップを書き出す" })).toBeVisible();
  await expect(page.getByLabel("JSONバックアップを復元")).toBeVisible();

  await page.getByRole("button", { name: "JSONバックアップを書き出す" }).click();
  await expect(page.getByRole("link", { name: "バックアップをダウンロード" })).toHaveAttribute("download", /atoqueue-backup-\d{4}-\d{2}-\d{2}\.json/);
});
