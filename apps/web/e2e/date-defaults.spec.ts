import { expect, test, type Page } from "@playwright/test";
import {
  createEmptySnapshot,
  type AppSnapshot,
  type Task,
} from "../../../packages/domain/src";

const storageKey = "atoqueue:data:v1";
const now = "2026-10-15T15:30:00.000Z";
const today = "2026-10-16";
const todayEnd = "2026-10-16T14:59:00.000Z";
const captureId = "date-default-capture";
const existingDue = "2026-10-20T01:15:00.000Z";

// UTC is still October 15; the saved application time zone is already October 16.
test.use({ timezoneId: "UTC" });

function task(id: string, dueAt?: string): Task {
  return {
    id,
    sourceCaptureId: `capture-${id}`,
    title: `日付の確認 ${id}`,
    status: "active",
    dueMode: dueAt ? "scheduled" : "none",
    ...(dueAt ? { dueAt } : {}),
    nextReviewAt: now,
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
}

async function seed(page: Page, tasks: Task[] = []): Promise<void> {
  await page.clock.setFixedTime(new Date(now));
  const snapshot = createEmptySnapshot({
    appVersion: "mvp-1.33.0",
    localDeviceId: "date-default-device",
    timeZone: "Asia/Tokyo",
    now,
  });
  snapshot.settings.onboardingCompletedAt = now;
  snapshot.tasks = tasks;
  snapshot.captures = [
    {
      id: captureId,
      body: "書類を確認する",
      classification: "unclassified",
      createdAt: now,
      updatedAt: now,
    },
    ...tasks.map((item) => ({
      id: item.sourceCaptureId,
      body: item.title,
      classification: "task" as const,
      linkedTaskId: item.id,
      createdAt: now,
      updatedAt: now,
    })),
  ];
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem("atoqueue:install-prompt-seen:v1", "seen");
  }, { key: storageKey, value: snapshot });
  await page.route("https://api.atoqueue.sikumilab.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

async function saved(page: Page): Promise<AppSnapshot> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
}

test("F-007/NF-010 candidate date defaults to local today only after choosing a date", async ({ page }) => {
  await seed(page);
  await page.goto(`/inbox/${captureId}`);
  const choice = page.getByLabel("期限", { exact: true });
  await expect(choice).toHaveValue("unset");
  await expect(page.getByLabel("期限日（8桁）")).toHaveCount(0);

  await choice.selectOption("custom");
  const date = page.getByLabel("期限日（8桁）");
  await expect(date).toHaveValue("2026/10/16");
  await expect(date).toHaveAttribute("placeholder", "例: 2026/10/16");
  await expect(page.locator('input[type="date"]')).toHaveValue(today);
  await date.fill("20261021");
  await choice.selectOption("today");
  await choice.selectOption("custom");
  await expect(date).toHaveValue("2026/10/21");
  await expect(page.locator('input[type="date"]')).toHaveValue("2026-10-21");

  await date.fill("");
  await page.getByRole("button", { name: "カレンダーで期限日を選ぶ" }).click();
  await page.keyboard.press("Escape");
  await expect(date).toHaveValue("2026/10/16");
  const beforeSave = await saved(page);
  expect(beforeSave.tasks).toEqual([]);
  expect(beforeSave.captures[0].classification).toBe("unclassified");
  await page.getByRole("button", { name: "タスクにする" }).click();
  await expect.poll(async () => (await saved(page)).tasks[0]).toMatchObject({
    dueMode: "scheduled", dueAt: todayEnd,
  });
});

test("F-009/NF-010 Today opens today's date without changing the saved deadline until confirmation", async ({ page }) => {
  const oldDue = "2026-10-14T14:59:00.000Z";
  await seed(page, [task("review", oldDue)]);
  await page.goto("/today");
  await page.getByRole("button", { name: "日付を変える", exact: true }).click();
  await expect(page.getByLabel("新しい期限")).toHaveValue(today);
  expect((await saved(page)).tasks[0].dueAt).toBe(oldDue);
  await page.getByRole("button", { name: "戻る", exact: true }).click();
  await page.getByRole("button", { name: "日付を変える", exact: true }).click();
  await expect(page.getByLabel("新しい期限")).toHaveValue(today);
  await page.getByRole("button", { name: "この日付にする" }).click();
  await expect.poll(async () => (await saved(page)).tasks[0].dueAt).toBe(todayEnd);
});

test("F-010/NF-010 detail keeps an existing deadline and offers local today for a task without one", async ({ page }) => {
  await seed(page, [task("scheduled", existingDue), task("no-due")]);
  await page.goto("/tasks/scheduled");
  await expect(page.getByLabel("期限日（8桁）")).toHaveValue("2026/10/20");
  await expect(page.getByLabel("期限時刻（4桁）")).toHaveValue("10:15");
  await expect(page.locator('input[type="date"]')).toHaveValue("2026-10-20");
  expect((await saved(page)).tasks[0].dueAt).toBe(existingDue);

  await page.goto("/tasks/no-due");
  const date = page.getByLabel("期限日（8桁）");
  await expect(date).toHaveValue("2026/10/16");
  await expect(date).toHaveAttribute("placeholder", "例: 2026/10/16");
  await expect(page.locator('input[type="date"]')).toHaveValue(today);
  expect((await saved(page)).tasks[1]).toMatchObject({ dueMode: "none" });
  expect((await saved(page)).tasks[1].dueAt).toBeUndefined();
  await page.getByRole("button", { name: "期限を保存", exact: true }).click();
  await expect.poll(async () => (await saved(page)).tasks[1]).toMatchObject({
    dueMode: "scheduled", dueAt: todayEnd,
  });
  expect((await saved(page)).tasks[0].dueAt).toBe(existingDue);
});
