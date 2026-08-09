import { expect, test } from "@playwright/test";

const now = "2026-08-03T09:00:00.000Z";

test("keeps the today review header, progress, and card inside the desktop content width", async ({
  page,
}) => {
  await page.addInitScript(
    (snapshot) =>
      window.localStorage.setItem("atoqueue:data:v1", JSON.stringify(snapshot)),
    {
      schemaVersion: 7,
      appVersion: "0.1.0",
      device: {
        localDeviceId: "device-1",
        pushSubscriptionStatus: "not_requested",
      },
      settings: {
        locale: "ja-JP",
        timeZone: "Asia/Tokyo",
        notificationEnabled: false,
        weeklyReviewDay: 0,
        inboxReminderFrequency: "gentle",
        memoReviewFrequency: "weekly",
        enterSavesCapture: true,
      },
      captures: [],
      tasks: [
        {
          id: "one",
          sourceCaptureId: "capture-one",
          title: "確認タスク one",
          status: "active",
          dueMode: "scheduled",
          dueAt: "2026-08-02T23:59:00.000Z",
          nextReviewAt: "2026-08-02T23:59:00.000Z",
          undecidedCount: 0,
          dismissCount: 0,
          postponeCount: 0,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: now,
          revision: 1,
        },
      ],
      reviewSessions: [],
      actionHistory: [],
      notificationOutbox: [],
      reminderMap: [],
      savedAt: now,
    },
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "今日の確認" })).toBeVisible();
  await expect(page.getByRole("button", { name: "前のタスク" })).toHaveCount(0);

  const [header, progress, card] = await Promise.all([
    page.getByTestId("review-header").boundingBox(),
    page.getByTestId("review-progress").boundingBox(),
    page.getByLabel("確認するタスク").boundingBox(),
  ]);
  expect(header).not.toBeNull();
  expect(progress).not.toBeNull();
  expect(card).not.toBeNull();
  for (const box of [header!, card!]) {
    expect(box.width).toBeLessThanOrEqual(736);
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThan(1280);
  }
  expect(Math.abs(header!.x - card!.x)).toBeLessThan(2);
  expect(
    Math.abs(header!.x + header!.width - (card!.x + card!.width)),
  ).toBeLessThan(2);
  expect(header!.y + header!.height).toBeLessThanOrEqual(card!.y);
  expect(progress!.x).toBeGreaterThanOrEqual(card!.x);
  expect(progress!.x + progress!.width).toBeLessThanOrEqual(
    card!.x + card!.width,
  );
  expect(progress!.y).toBeGreaterThanOrEqual(card!.y);
  expect(progress!.y + progress!.height).toBeLessThanOrEqual(
    card!.y + card!.height,
  );
});
