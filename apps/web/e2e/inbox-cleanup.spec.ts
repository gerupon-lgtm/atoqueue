import { expect, test, type Page } from "@playwright/test";

const createdAt = "2026-08-09T09:00:00.000Z";

async function seedInbox(page: Page): Promise<void> {
  await page.addInitScript(
    (snapshot) =>
      window.localStorage.setItem("atoqueue:data:v1", JSON.stringify(snapshot)),
    {
      schemaVersion: 2,
      appVersion: "mvp-1.4.0",
      device: {
        localDeviceId: "00000000-0000-4000-8000-000000000001",
        pushSubscriptionStatus: "not_requested",
      },
      settings: {
        locale: "ja-JP",
        timeZone: "Asia/Tokyo",
        notificationEnabled: false,
        weeklyReviewDay: 0,
      },
      captures: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          body: "未整理の記録",
          classification: "unclassified",
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: "10000000-0000-4000-8000-000000000002",
          body: "メモの記録",
          classification: "note",
          createdAt,
          updatedAt: createdAt,
          classifiedAt: "2026-08-09T09:05:00.000Z",
        },
        {
          id: "10000000-0000-4000-8000-000000000003",
          body: "未整理から不要",
          classification: "unneeded",
          createdAt,
          updatedAt: createdAt,
          classifiedAt: "2026-08-09T09:10:00.000Z",
        },
        {
          id: "10000000-0000-4000-8000-000000000004",
          body: "メモから不要",
          classification: "unneeded",
          createdAt,
          updatedAt: createdAt,
          classifiedAt: "2026-08-09T09:15:00.000Z",
        },
        {
          id: "10000000-0000-4000-8000-000000000005",
          body: "タスク化済みの記録",
          classification: "task",
          linkedTaskId: "20000000-0000-4000-8000-000000000001",
          createdAt,
          updatedAt: createdAt,
          classifiedAt: "2026-08-09T09:20:00.000Z",
        },
      ],
      tasks: [
        {
          id: "20000000-0000-4000-8000-000000000001",
          sourceCaptureId: "10000000-0000-4000-8000-000000000005",
          title: "タスク化済みの記録",
          status: "active",
          dueMode: "none",
          nextReviewAt: "2026-08-10T09:00:00.000Z",
          undecidedCount: 0,
          dismissCount: 0,
          postponeCount: 0,
          createdAt,
          updatedAt: createdAt,
          revision: 1,
        },
      ],
      reviewSessions: [],
      actionHistory: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          entityType: "capture",
          entityId: "10000000-0000-4000-8000-000000000003",
          action: "capture_classified",
          after: { classification: "unneeded" },
          occurredAt: "2026-08-09T09:10:00.000Z",
        },
        {
          id: "30000000-0000-4000-8000-000000000002",
          entityType: "capture",
          entityId: "10000000-0000-4000-8000-000000000004",
          action: "capture_classified",
          after: { classification: "note" },
          occurredAt: "2026-08-09T09:12:00.000Z",
        },
        {
          id: "30000000-0000-4000-8000-000000000003",
          entityType: "capture",
          entityId: "10000000-0000-4000-8000-000000000004",
          action: "capture_classified",
          after: { classification: "unneeded" },
          occurredAt: "2026-08-09T09:15:00.000Z",
        },
      ],
      notificationOutbox: [],
      reminderMap: [],
      savedAt: createdAt,
    },
  );
}

test("shows three counted inbox tabs and restores selected unneeded captures", async ({
  page,
}) => {
  await seedInbox(page);
  await page.goto("/inbox");

  await expect(page.getByRole("tab", { name: /未整理.*1件/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /メモ.*1件/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /不要.*2件/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: "すべて" })).toHaveCount(0);
  await expect(page.getByText("タスク化済みの記録")).toHaveCount(0);

  await page.getByRole("tab", { name: /不要.*2件/ }).click();
  await expect(page.getByText("未整理から", { exact: true })).toBeVisible();
  await expect(page.getByText("メモから", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "選択" }).click();
  await page.getByRole("button", { name: "すべて選択" }).click();
  await expect(page.getByText("2件選択中")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "選択した記録を未整理に戻す" })
    .click();

  await expect(page.getByRole("status")).toContainText(
    "2件を未整理に戻しました。",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const snapshot = JSON.parse(
          window.localStorage.getItem("atoqueue:data:v1") ?? "{}",
        ) as { captures?: Array<{ classification: string }> };
        return snapshot.captures?.filter(
          ({ classification }) => classification === "unclassified",
        ).length;
      }),
    )
    .toBe(3);
});

test("keeps a batch deletion after cancellation and deletes it after confirmation", async ({
  page,
}) => {
  await seedInbox(page);
  await page.goto("/inbox");
  await page.getByRole("tab", { name: /不要.*2件/ }).click();
  await page.getByRole("button", { name: "選択" }).click();
  await page.getByRole("button", { name: "すべて選択" }).click();

  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "選択した記録を完全削除" })
    .click();
  await expect(page.getByText("2件選択中")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "選択した記録を完全削除" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "2件を完全に削除しました。",
  );
  await expect(page.getByText("未整理から不要")).toHaveCount(0);
  await expect(page.getByText("メモから不要")).toHaveCount(0);
});
