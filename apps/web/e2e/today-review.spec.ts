import { expect, test } from "@playwright/test";

const now = "2026-08-03T09:00:00.000Z";

function task(id: string, createdAt: string) {
  return {
    id,
    sourceCaptureId: `capture-${id}`,
    title: `確認タスク ${id}`,
    status: "active",
    dueMode: "scheduled",
    dueAt: "2026-08-02T23:59:00.000Z",
    nextReviewAt: "2026-08-02T23:59:00.000Z",
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt,
    updatedAt: now,
    revision: 1,
  };
}

test("processes three tasks one at a time, re-answers a previous task, and shows the session history", async ({
  page,
}) => {
  await page.addInitScript(
    (snapshot) =>
      window.localStorage.setItem("atoqueue:data:v1", JSON.stringify(snapshot)),
    {
      schemaVersion: 2,
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
      },
      captures: [],
      tasks: [
        task("one", "2026-07-01T00:00:00.000Z"),
        task("two", "2026-07-02T00:00:00.000Z"),
        task("three", "2026-07-03T00:00:00.000Z"),
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
  await expect(page.getByText("確認タスク one")).toBeVisible();
  await expect(page.getByRole("button", { name: "前のタスク" })).toHaveCount(0);
  const titleBox = await page
    .getByRole("heading", { name: "今日の確認" })
    .boundingBox();
  const headerBox = await page.getByTestId("review-header").boundingBox();
  expect(titleBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(Math.abs(titleBox!.x - headerBox!.x)).toBeLessThan(2);

  await page.getByRole("button", { name: "完了" }).click();
  await expect(page.getByText("確認タスク two")).toBeVisible();
  const previous = page.getByRole("button", { name: "前のタスク" });
  await expect(previous).toBeVisible();
  const previousBox = await previous.boundingBox();
  const next = page.getByRole("button", { name: "次のタスク" });
  await expect(next).toBeVisible();
  const nextBox = await next.boundingBox();
  expect(previousBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(
    Math.abs(
      nextBox!.x + nextBox!.width - (headerBox!.x + headerBox!.width),
    ),
  ).toBeLessThan(2);
  expect(previousBox!.x + previousBox!.width).toBeLessThanOrEqual(nextBox!.x);
  await page.getByRole("button", { name: "日付を変える" }).click();
  await page.getByLabel("新しい期限").fill("2026-08-10");
  await page.getByRole("button", { name: "この日付にする" }).click();
  await expect(page.getByText("確認タスク three")).toBeVisible();

  await page.getByRole("button", { name: "前のタスク" }).click();
  await page.getByRole("button", { name: "前のタスク" }).click();
  await expect(page.getByText("確認タスク one")).toBeVisible();
  await page.getByRole("button", { name: "期限なし" }).click();
  await expect(page.getByText("確認タスク three")).toBeVisible();
  await page.getByRole("button", { name: "期限なし" }).click();

  await expect(page).toHaveURL(/\/today\/result$/);
  await expect(page.getByText("完了: 1件")).toBeVisible();
  await expect(page.getByText("期限変更: 1件")).toBeVisible();
  await expect(page.getByText("期限なし: 2件")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "確認タスク oneを修正" }),
  ).toHaveAttribute("href", "/tasks/one");
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          window.localStorage.getItem("atoqueue:data:v1") ?? "{}",
        ).actionHistory.map((event: { action: string }) => event.action),
      ),
    )
    .toEqual([
      "task_completed",
      "task_rescheduled",
      "task_marked_no_due",
      "task_marked_no_due",
    ]);

  await page.getByRole("link", { name: "確認タスク oneを修正" }).click();
  await expect(
    page.getByRole("heading", { name: "タスクを修正" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(
    page.getByRole("heading", { name: "タスクを修正" }),
  ).toBeVisible();
});
