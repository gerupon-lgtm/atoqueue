import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const now = "2026-08-04T09:00:00.000Z";
const captureId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";

function representativeSnapshot() {
  return {
    schemaVersion: 2,
    appVersion: "0.1.0",
    device: { localDeviceId: "device-1", pushSubscriptionStatus: "not_requested" },
    settings: { locale: "ja-JP", timeZone: "Asia/Tokyo", notificationEnabled: false, weeklyReviewDay: 0 },
    captures: [{ id: captureId, body: "牛乳を買う", classification: "unclassified", createdAt: now, updatedAt: now }],
    tasks: [{ id: taskId, sourceCaptureId: captureId, title: "牛乳を買う", status: "active", dueMode: "none", nextReviewAt: now, undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: now, updatedAt: now, revision: 1 }],
    reviewSessions: [],
    actionHistory: [],
    notificationOutbox: [],
    reminderMap: [],
    savedAt: now,
  };
}

async function open(page: Page, route: string): Promise<void> {
  await page.addInitScript((snapshot) => window.localStorage.setItem("atoqueue:data:v1", JSON.stringify(snapshot)), representativeSnapshot());
  await page.goto(route);
  await expect(page.locator("main")).toBeVisible();
}

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
}

test.describe("NF-001 keyboard and accessible primary routes", () => {
  test("has no serious or critical accessibility findings on all primary routes", async ({ page }) => {
    for (const route of ["/", "/inbox", `/inbox/${captureId}`, "/today", "/today/result", "/tasks", `/tasks/${taskId}`, "/settings"]) {
      await open(page, route);
      await expectNoSeriousViolations(page);
    }
  });

  test("supports keyboard-only capture, classification, review, task editing, and backup export", async ({ page }) => {
    await open(page, "/");
    await page.getByRole("textbox", { name: "思いついたこと" }).fill("キーボードで記録");
    await page.getByRole("textbox", { name: "思いついたこと" }).press("Enter");
    await expect(page.getByRole("status")).toHaveText("保存しました。いまの作業に戻って大丈夫です");

    await page.goto("/inbox");
    await page.getByRole("button", { name: "タスクかも" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/inbox/${captureId}$`));
    await page.getByRole("button", { name: "受信箱へ戻る" }).focus();
    await page.keyboard.press("Enter");

    await page.goto("/today");
    await expect(page.getByRole("heading", { name: "今日の確認" })).toBeVisible();
    await page.getByRole("button", { name: "期限なし" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/today\/result$/);

    await page.goto(`/tasks/${taskId}`);
    await page.getByRole("textbox", { name: "タイトル" }).focus();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("キーボードで編集");
    await page.getByRole("button", { name: "編集を保存" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("キーボードで編集")).toBeVisible();

    await page.goto("/settings");
    await page.getByRole("button", { name: "JSONバックアップを書き出す" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "バックアップをダウンロード" })).toBeVisible();
  });
});
