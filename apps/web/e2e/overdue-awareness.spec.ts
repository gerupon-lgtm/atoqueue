import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createEmptySnapshot, type Task } from "../../../packages/domain/src";

const now = "2026-08-31T09:00:00.000Z";
async function seed(page: Page, count = 2) {
  await page.clock.install({ time: new Date(now) });
  const snapshot = createEmptySnapshot({
    appVersion: "test",
    localDeviceId: "device-test",
    timeZone: "Asia/Tokyo",
    now,
  });
  snapshot.settings.onboardingCompletedAt = now;
  snapshot.device.pushSubscriptionStatus = "denied";
  const base: Task = {
    id: "overdue",
    sourceCaptureId: "capture-overdue",
    title: "期限超過テスト",
    status: "active",
    dueMode: "scheduled",
    dueAt: "2026-08-30T09:00:00.000Z",
    nextReviewAt: "2026-08-30T09:00:00.000Z",
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  snapshot.tasks = Array.from({ length: count }, (_, index) => ({
    ...base,
    id: `overdue-${index}`,
    sourceCaptureId: `capture-${index}`,
    title: `期限超過テスト${index}`,
  }));
  snapshot.tasks.push({
    ...base,
    id: "future",
    sourceCaptureId: "capture-future",
    title: "明日のタスク",
    dueAt: "2026-09-01T09:00:00.000Z",
  });
  snapshot.captures = snapshot.tasks.map((task) => ({
    id: task.sourceCaptureId,
    body: task.title,
    classification: "task",
    linkedTaskId: task.id,
    createdAt: now,
    updatedAt: now,
  }));
  await page.addInitScript((value) => {
    if (!window.localStorage.getItem("atoqueue:data:v1"))
      window.localStorage.setItem("atoqueue:data:v1", JSON.stringify(value));
    window.localStorage.setItem("atoqueue:install-prompt-seen:v1", "seen");
  }, snapshot);
}

for (const viewport of [
  { width: 320, height: 640 },
  { width: 360, height: 450 },
  { width: 412, height: 760 },
]) {
  test(`does not add capture scrolling at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await seed(page);
    await page.goto("/");
    const summary = page.getByRole("link", {
      name: "期限超過のタスク2件を確認する",
    });
    await expect(summary).toBeVisible();
    await page
      .getByRole("textbox", { name: "思いついたこと" })
      .fill("期限超過があっても入力できる");
    const metrics = await page.evaluate(() => {
      const save = document
        .querySelector<HTMLButtonElement>(".quick-capture__actions button")!
        .getBoundingClientRect();
      const nav = document
        .querySelector(".app-shell__navigation")!
        .getBoundingClientRect();
      const summary = document
        .querySelector(".app-shell__overdue-summary")!
        .getBoundingClientRect();
      const height = document.documentElement.scrollHeight;
      // Recreate the previous wordmark/count spacing to compare the added reminder's footprint.
      const link = document.querySelector<HTMLElement>(
        ".app-shell__overdue-summary",
      )!;
      const wordmark = document.querySelector<HTMLElement>(
        ".app-shell__wordmark",
      )!;
      const wordmarkBox = wordmark.getBoundingClientRect();
      const count = document.querySelector<HTMLElement>(
        ".quick-capture__summary",
      )!;
      link.style.display = "none";
      count.style.margin = "1em 0";
      const priorHeight = document.documentElement.scrollHeight;
      link.style.removeProperty("display");
      count.style.removeProperty("margin");
      const actions = document
        .querySelector(".quick-capture__option-stack")!
        .getBoundingClientRect();
      const form = document
        .querySelector(".quick-capture__form")!
        .getBoundingClientRect();
      return {
        scroll: window.scrollY,
        horizontal: document.documentElement.scrollWidth > window.innerWidth,
        height,
        priorHeight,
        saveBottom: save.bottom,
        navTop: nav.top,
        summaryHeight: summary.height,
        summaryRight: summary.right,
        summaryLeft: summary.left,
        wordmarkRight: wordmarkBox.right,
        wordmarkFontSize: getComputedStyle(wordmark).fontSize,
        summaryFontSize: getComputedStyle(link).fontSize,
        actionsRight: actions.right,
        formRight: form.right,
      };
    });
    expect(metrics).toMatchObject({ scroll: 0, horizontal: false });
    expect(metrics.wordmarkFontSize).toBe(metrics.summaryFontSize);
    expect(metrics.wordmarkRight).toBeLessThan(metrics.summaryLeft);
    expect(metrics.height).toBeLessThanOrEqual(metrics.priorHeight);
    if (viewport.height >= 600) {
      expect(metrics.height).toBe(viewport.height);
      expect(metrics.saveBottom).toBeLessThan(metrics.navTop);
    }
    expect(metrics.actionsRight).toBeLessThan(metrics.formRight);
    expect(metrics.summaryHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.summaryRight).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: testInfo.outputPath("capture-overdue.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "保存して戻る" }).click();
    await expect(page.getByText("受信箱の未整理: 1件")).toBeVisible();
    await expect(summary).toBeVisible();
  });
}

test("opens the overdue list from all primary screens and updates counts immediately after review actions", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  const summary = page.getByRole("link", {
    name: "期限超過のタスク2件を確認する",
  });
  for (const label of ["受信箱", "設定", "タスク", "記録"]) {
    await page
      .getByRole("navigation")
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect(summary).toBeVisible();
  }
  await summary.click();
  await expect(
    page.getByRole("combobox", { name: "期限", exact: true }),
  ).toHaveValue("overdue");
  await expect(
    page.getByRole("link", { name: "明日のタスク", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "状態", exact: true })
    .selectOption("completed");
  await page.getByLabel("検索", { exact: true }).fill("検索条件");
  await summary.click();
  await expect(page.getByLabel("検索", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("link", { name: "期限超過テスト0", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "今日", exact: true })
    .click();
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "期限超過のタスク1件を確認する" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "前のタスク" }).click();
  await expect(
    page.getByText("このタスクは完了マーク済みです。"),
  ).toBeVisible();
  await expect(
    page.getByRole("article").locator(".overdue-indicator"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "次のタスク" }).click();
  await page.getByRole("button", { name: "アーカイブ", exact: true }).click();
  await expect(page.locator(".app-shell__overdue-summary")).toHaveCount(0);
  await expect(page.locator(".app-shell__nav-badge")).toHaveCount(0);
});

test("keeps large counts compact and overdue controls accessible", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await seed(page, 100);
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "期限超過のタスク100件を確認する" }),
  ).toBeVisible();
  await expect(page.getByLabel("期限超過のタスク: 100件")).toHaveText("99+");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (const path of ["/", "/tasks", "/tasks/overdue-0", "/today"]) {
    await page.goto(path);
    await expect(page.locator(".app-shell__overdue-summary")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(
        `overdue-${path.replaceAll("/", "_") || "capture"}.png`,
      ),
    });
  }
});
