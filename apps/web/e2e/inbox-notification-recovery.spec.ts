import { expect, test } from "@playwright/test";
import { createEmptySnapshot } from "../../../packages/domain/src";

test("v9 registered inbox reminders survive migration, unchanged settings saves, and repeated launch", async ({ page }) => {
  const now = "2026-08-31T10:00:00.000Z";
  const original = createEmptySnapshot({ appVersion: "mvp-1.21.0", localDeviceId: "test-local", timeZone: "Asia/Tokyo", now });
  original.settings.notificationEnabled = true;
  original.settings.onboardingCompletedAt = now;
  original.device = { ...original.device, pushDeviceId: "11111111-1111-4111-8111-111111111111", pushDeviceSecret: "test-only", pushSubscriptionStatus: "granted" };
  original.captures = ["one", "two"].map(id => ({ id, body: "確認用", classification: "unclassified", createdAt: "2026-08-01T10:00:00.000Z", updatedAt: now }));
  original.reminderMap = [{ reminderId: "22222222-2222-4222-8222-222222222222", scope: "inbox", kind: "capture_initial", taskRevision: 0, createdAt: now }];
  const stored = { ...original, schemaVersion: 9 };
  await page.addInitScript(snapshot => {
    if (!localStorage.getItem("atoqueue:data:v1")) localStorage.setItem("atoqueue:data:v1", JSON.stringify(snapshot));
  }, stored);
  const reservationRequests: string[] = [];
  await page.route("**/v1/reminders/**", async route => {
    reservationRequests.push(route.request().method());
    await route.fulfill({ status: 204 });
  });
  for (let launch = 0; launch < 3; launch += 1) {
    await page.goto("/settings");
    await page.getByRole("button", { name: "通知タイミングを保存", exact: true }).click();
    await expect(page.getByText("通知タイミングを保存しました。", { exact: true })).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("atoqueue:data:v1")!));
    expect(saved.schemaVersion).toBe(10);
    expect(saved.captures).toEqual(original.captures);
    expect(saved.settings.initialReminderDelayMinutes).toBe(60);
    expect(saved.notificationOutbox).toEqual([]);
    expect(saved.reminderMap.map((entry: { reminderId: string }) => entry.reminderId)).toEqual([original.reminderMap[0]!.reminderId]);
    expect(reservationRequests).toEqual([]);
  }
});
