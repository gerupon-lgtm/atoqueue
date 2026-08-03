import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

test("Settings exposes portable JSON export and an explicit restore control", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("button", { name: "JSONバックアップを書き出す" })).toBeVisible();
  await expect(page.getByLabel("JSONバックアップを復元")).toBeVisible();

  await page.getByRole("button", { name: "JSONバックアップを書き出す" }).click();
  await expect(page.getByRole("link", { name: "バックアップをダウンロード" })).toHaveAttribute("download", /atoqueue-backup-\d{4}-\d{2}-\d{2}\.json/);
});

test("F-017/F-018 restores an exported backup into a clean browser context after confirmation", async ({ browser }) => {
  const source = await browser.newContext();
  const sourceSnapshot = {
    schemaVersion: 2,
    appVersion: "0.1.0",
    device: { localDeviceId: "77777777-7777-4777-8777-777777777777", pushSubscriptionStatus: "not_requested" },
    settings: { locale: "ja-JP", timeZone: "Asia/Tokyo", notificationEnabled: false, weeklyReviewDay: 0 },
    captures: [{ id: "11111111-1111-4111-8111-111111111111", body: "clean context task", classification: "task", createdAt: "2026-08-04T09:00:00.000Z", updatedAt: "2026-08-04T09:00:00.000Z", classifiedAt: "2026-08-04T09:00:00.000Z", linkedTaskId: "22222222-2222-4222-8222-222222222222" }],
    tasks: [{ id: "22222222-2222-4222-8222-222222222222", sourceCaptureId: "11111111-1111-4111-8111-111111111111", title: "clean context task", status: "active", dueMode: "none", nextReviewAt: "2026-08-04T09:00:00.000Z", undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: "2026-08-04T09:00:00.000Z", updatedAt: "2026-08-04T09:00:00.000Z", revision: 1 }],
    reviewSessions: [],
    actionHistory: [],
    notificationOutbox: [],
    reminderMap: [],
    savedAt: "2026-08-04T09:00:00.000Z",
  };
  await source.addInitScript((snapshot) => window.localStorage.setItem("atoqueue:data:v1", JSON.stringify(snapshot)), sourceSnapshot);
  const sourcePage = await source.newPage();
  await sourcePage.goto("/settings");
  await sourcePage.getByRole("button", { name: "JSONバックアップを書き出す" }).click();
  const backup = await sourcePage.getByRole("link", { name: "バックアップをダウンロード" }).evaluate(async (link) => {
    return fetch((link as HTMLAnchorElement).href).then((response) => response.text());
  });
  await source.close();

  const destination = await browser.newContext();
  const page = await destination.newPage();
  await page.goto("/settings");
  await page.getByLabel("JSONバックアップを復元").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup),
  });
  await expect(page.getByText(/取り込みデータ: タスク 1件/)).toBeVisible();
  await expect(page.getByText(/現在のデータ: タスク 0件/)).toBeVisible();
  await page.getByRole("button", { name: "この内容で置き換える" }).click();

  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("atoqueue:data:v1") ?? "{}"))).toMatchObject({
    captures: [expect.objectContaining({ body: "clean context task" })],
    tasks: [expect.objectContaining({ title: "clean context task" })],
  });
  const restoredDevice = await page.evaluate(() => JSON.parse(window.localStorage.getItem("atoqueue:data:v1") ?? "{}").device);
  expect(restoredDevice.localDeviceId).not.toBe("77777777-7777-4777-8777-777777777777");
  expect(restoredDevice).not.toHaveProperty("pushDeviceId");
  expect(restoredDevice).not.toHaveProperty("pushDeviceSecret");
  await destination.close();
});
