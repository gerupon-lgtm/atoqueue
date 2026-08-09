import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("adds a local category, suggests it by exact text, and preserves it as history after removal", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByText("データ", { exact: true }).click();
  await page.getByLabel("カテゴリ名").fill("冷蔵庫");
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByRole("button", { name: "カテゴリを保存" }).click();
  await expect(page.getByRole("status")).toHaveText("カテゴリを保存しました。");

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "思いついたこと" })
    .fill("冷蔵庫の豆腐");
  await page.getByRole("button", { name: "保存して戻る" }).click();
  await page.goto("/inbox");
  await page.getByRole("button", { name: "タスクかも" }).click();
  await expect(page.getByText("カテゴリ候補: 冷蔵庫")).toBeVisible();
  await expect(page.getByLabel("カテゴリ")).toHaveValue("冷蔵庫");
  await page.getByRole("button", { name: "タスクにする" }).click();

  await page.goto("/settings");
  await page.getByText("データ", { exact: true }).click();
  await page.getByRole("button", { name: "冷蔵庫を削除予定にする" }).click();
  await expect(page.getByText("削除予定")).toBeVisible();
  await page.getByRole("button", { name: "カテゴリを保存" }).click();

  await page.goto("/tasks");
  await expect(
    page.getByLabel("カテゴリ").locator('option[value="冷蔵庫"]'),
  ).toHaveText("冷蔵庫（過去）");
  await page.getByLabel("カテゴリ").selectOption("冷蔵庫");
  await expect(page.getByRole("link", { name: "冷蔵庫の豆腐" })).toBeVisible();
});
