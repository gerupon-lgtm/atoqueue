import { expect, test } from "@playwright/test";

test("keeps a suggested capture unclassified until the user confirms タスクにする", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "思いついたこと" }).fill("牛乳を買う");
  await page.getByRole("button", { name: "保存して戻る" }).click();

  await page.goto("/inbox");
  await expect(page.getByText("牛乳を買う")).toBeVisible();
  await page.getByRole("button", { name: "タスクかも" }).click();
  await expect(page.getByRole("heading", { name: "タスク候補を確認" })).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem("atoqueue:data:v1");
        return raw ? (JSON.parse(raw) as { tasks: unknown[] }).tasks.length : -1;
      }),
    )
    .toBe(0);

  await page.getByRole("button", { name: "タスクにする" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem("atoqueue:data:v1");
        return raw ? (JSON.parse(raw) as { tasks: unknown[] }).tasks.length : -1;
      }),
    )
    .toBe(1);
});
