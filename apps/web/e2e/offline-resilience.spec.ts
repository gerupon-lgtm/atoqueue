import { expect, test } from "@playwright/test";

test.describe("NF-004/NF-006 local-first resilience", () => {
  test("keeps a saved capture available after an offline reload", async ({ context, page }) => {
    await page.goto("/");
    await page.getByRole("textbox", { name: "思いついたこと" }).fill("オフラインでも残る記録");
    await page.getByRole("button", { name: "保存して戻る" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("atoqueue:data:v1") ?? "")).toContain("オフラインでも残る記録");
    await context.setOffline(false);
  });

  test("retries a pending anonymous outbox entry after connectivity recovers", async ({ context, page }) => {
    const snapshot = {
      schemaVersion: 2, appVersion: "0.1.0",
      device: { localDeviceId: "local", pushDeviceId: "11111111-1111-4111-8111-111111111111", pushDeviceSecret: "secret", pushSubscriptionStatus: "granted", registeredAt: "2026-08-04T09:00:00.000Z" },
      settings: { locale: "ja-JP", timeZone: "Asia/Tokyo", notificationEnabled: true, weeklyReviewDay: 0 },
      captures: [], tasks: [{ id: "task", sourceCaptureId: "capture", title: "端末だけのタスク", status: "active", dueMode: "none", nextReviewAt: "2026-08-04T09:00:00.000Z", undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: "2026-08-04T09:00:00.000Z", updatedAt: "2026-08-04T09:00:00.000Z", revision: 1 }], reviewSessions: [], actionHistory: [],
      notificationOutbox: [{ id: "operation", operation: "upsert", reminderId: "33333333-3333-4333-8333-333333333333", scheduledAt: "2026-08-04T09:00:00.000Z", notificationType: "task_review", taskRevision: 1, attemptCount: 0, nextAttemptAt: "2026-08-04T00:00:00.000Z", createdAt: "2026-08-04T00:00:00.000Z" }],
      reminderMap: [{ reminderId: "33333333-3333-4333-8333-333333333333", taskId: "task", taskRevision: 1, createdAt: "2026-08-04T00:00:00.000Z" }], savedAt: "2026-08-04T09:00:00.000Z",
    };
    let calls = 0;
    let serverAvailable = false;
    await page.route("https://api.atoqueue.sikumilab.com/**", async (route) => {
      calls += 1;
      if (!serverAvailable) {
        await route.abort("internetdisconnected");
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reminderId: "33333333-3333-4333-8333-333333333333",
          status: "pending",
          scheduledAt: "2026-08-04T09:00:00.000Z",
          repeatCadence: null,
          updatedAt: "2026-08-04T09:00:00.000Z",
        }),
      });
    });
    await page.addInitScript((value) => window.localStorage.setItem("atoqueue:data:v1", JSON.stringify(value)), snapshot);
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    await page.evaluate((value) => {
      window.localStorage.setItem("atoqueue:data:v1", JSON.stringify(value));
    }, snapshot);
    await context.setOffline(true);
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(window.localStorage.getItem("atoqueue:data:v1") ?? "{}")
              .notificationOutbox.length,
        ),
      )
      .toBe(1);
    await context.setOffline(false);
    serverAvailable = true;
    await page.evaluate(() => {
      const value = JSON.parse(window.localStorage.getItem("atoqueue:data:v1") ?? "{}");
      value.notificationOutbox[0].nextAttemptAt = "1970-01-01T00:00:00.000Z";
      window.localStorage.setItem("atoqueue:data:v1", JSON.stringify(value));
    });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("atoqueue:data:v1") ?? "{}").notificationOutbox)).toEqual([]);
    expect(calls).toBeGreaterThan(0);
  });
});
