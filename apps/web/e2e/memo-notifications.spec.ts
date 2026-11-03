import { expect, test } from "@playwright/test";
import { createCapture, createEmptySnapshot } from "../../../packages/domain/src";

test("F-014/F-015 old capture classification schedules a future review and notification opens memos even in an open inbox", async ({ page, context }) => {
  const now = "2026-09-13T09:56:52.488Z";
  const createdAt = "2026-08-26T00:00:00.000Z";
  const initial = createEmptySnapshot({ appVersion: "test", localDeviceId: "11111111-1111-4111-8111-111111111111", timeZone: "Asia/Tokyo", now: createdAt });
  initial.settings.notificationEnabled = true;
  initial.settings.onboardingCompletedAt = createdAt;
  initial.device = { ...initial.device, pushDeviceId: "22222222-2222-4222-8222-222222222222", pushDeviceSecret: "test-only", pushSubscriptionStatus: "granted" };
  const snapshot = createCapture(initial, "8月26日の未整理", createdAt, "33333333-3333-4333-8333-333333333333");
  snapshot.notificationOutbox = [];
  await page.clock.setFixedTime(new Date(now));
  const reservations: Array<{ scheduledAt: string }> = [];
  await context.route("https://api.atoqueue.sikumilab.com/**", async route => {
    if (route.request().method() !== "PUT") { await route.fulfill({ status: 204 }); return; }
    const body = route.request().postDataJSON();
    reservations.push(body);
    await route.fulfill({ status: 200, json: {
      reminderId: new URL(route.request().url()).pathname.split("/").at(-1),
      status: "pending", scheduledAt: body.scheduledAt,
      repeatCadence: body.repeatCadence ?? null, updatedAt: now,
    } });
  });
  await page.addInitScript(value => {
    if (!localStorage.getItem("atoqueue:data:v1")) localStorage.setItem("atoqueue:data:v1", JSON.stringify(value));
    localStorage.setItem("atoqueue:install-prompt:v1", "dismissed");
  }, snapshot);
  await page.goto("/inbox");
  await page.getByRole("button", { name: "メモ", exact: true }).click();
  await expect(page.getByText("未整理の記録はありません。", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("atoqueue:data:v1")!).notificationOutbox.length)).toBe(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("atoqueue:data:v1")!));
  expect(saved.captures[0]).toMatchObject({ createdAt, classifiedAt: now, classification: "note" });
  const memoId = saved.reminderMap.find((entry: { scope?: string }) => entry.scope === "memo").reminderId;
  expect(reservations.slice(-2).map(item => item.scheduledAt)).toEqual(["2026-09-20T09:56:52.488Z", "2026-09-27T09:56:52.488Z"]);
  expect(JSON.stringify(reservations)).not.toContain("8月26日の未整理");

  // Cold URL entry resolves the local ID without adding fields to the Push contract.
  const url = `/inbox?reminder=${memoId}`;
  await page.goto(url);
  await expect(page.getByRole("tab", { name: /メモ/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "本文を編集" })).toHaveValue("8月26日の未整理");
  await page.getByRole("textbox", { name: "本文を編集" }).fill("保存前の本文編集");
  await page.getByRole("tab", { name: /未整理/ }).click();
  await expect(page.getByText("未整理の記録はありません。", { exact: true })).toBeVisible();

  // Drive the built SW's real click listener with a synthetic event, without
  // displaying or sending any OS notification. SW-to-page delivery and routing are real.
  await page.evaluate(() => navigator.serviceWorker.ready);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(async data => {
    const clients = (self as unknown as { clients: { matchAll(options: { type: string; includeUncontrolled: boolean }): Promise<object[]> } }).clients;
    const [client] = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const prototype = Object.getPrototypeOf(client!);
    const focus = Object.getOwnPropertyDescriptor(prototype, "focus")!;
    // Synthetic clicks have no OS user activation: stub only focus, keeping
    // the application's URL handling real.
    Object.defineProperty(prototype, "focus", { ...focus, value: async function (this: unknown) { return this; } });
    const pending: Promise<unknown>[] = [];
    const event = new Event("notificationclick");
    Object.defineProperties(event, {
      notification: { value: { data, close() {} } },
      waitUntil: { value: (promise: Promise<unknown>) => pending.push(promise) },
    });
    try {
      self.dispatchEvent(event);
      await Promise.all(pending);
    } finally {
      Object.defineProperty(prototype, "focus", focus);
    }
  }, { url, reminderId: memoId });
  await expect(page.getByRole("tab", { name: /メモ/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "本文を編集" })).toHaveValue("保存前の本文編集");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("atoqueue:data:v1")!).captures[0].body)).toBe("8月26日の未整理");
  await page.goto("/inbox?reminder=44444444-4444-4444-8444-444444444444");
  await expect(page.getByRole("tab", { name: /未整理/ })).toHaveAttribute("aria-selected", "true");
});
