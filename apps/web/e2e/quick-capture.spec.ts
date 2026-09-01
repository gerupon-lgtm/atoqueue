import { expect, test } from "@playwright/test";

test("saves a capture that remains in the local snapshot after reload", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("バージョン mvp-1.24.0")).toBeVisible();

  await page.getByRole("textbox", { name: "思いついたこと" }).fill("牛乳を買う");
  await page.getByRole("button", { name: "保存して戻る" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "保存しました。いまの作業に戻って大丈夫です",
  );
  await expect(page.getByText("受信箱の未整理: 1件")).toBeVisible();

  await page.reload();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = window.localStorage.getItem("atoqueue:data:v1");
        if (stored === null) return [];
        return (JSON.parse(stored) as { captures: Array<{ body: string }> }).captures;
      }),
    )
    .toContainEqual(expect.objectContaining({ body: "牛乳を買う" }));
});
