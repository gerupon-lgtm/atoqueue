import { expect, test } from "@playwright/test";

test.describe("NF-006 recovery paths", () => {
  test("preserves malformed local data and gives a recovery message", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("atoqueue:data:v1", "{not-json"));
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText("端末に保存できませんでした");
    await expect(page.evaluate(() => window.localStorage.getItem("atoqueue:data:v1"))).resolves.toBe("{not-json");
    await expect(page.evaluate(() => Object.keys(window.localStorage).some((key) => key.startsWith("atoqueue:corrupt:")))).resolves.toBe(true);
  });

  test("does not overwrite an unsupported future schema version", async ({ page }) => {
    const future = JSON.stringify({ schemaVersion: 999, privateValue: "keep" });
    await page.addInitScript((value) => window.localStorage.setItem("atoqueue:data:v1", value), future);
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText("端末に保存できませんでした");
    await expect(page.evaluate(() => window.localStorage.getItem("atoqueue:data:v1"))).resolves.toBe(future);
  });

  test("opens the normal Today review for a stale anonymous notification link", async ({ page }) => {
    await page.goto("/today?reminder=33333333-3333-4333-8333-333333333333");
    await expect(page.getByRole("heading", { name: "今日の確認" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("keeps the capture form when local storage rejects a quota-exhausted save", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string): void {
        if (key === "atoqueue:data:v1") throw new DOMException("quota exceeded", "QuotaExceededError");
        original.call(this, key, value);
      };
    });
    const capture = page.getByRole("textbox");
    await capture.fill("quota failure must not discard this capture");
    await page.locator("button[type=submit]").click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(capture).toHaveValue("quota failure must not discard this capture");
  });
});
