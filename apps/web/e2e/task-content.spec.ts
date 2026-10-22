import { expect, test, type Page } from "@playwright/test";
import { createEmptySnapshot, type Task } from "../../../packages/domain/src";

const now = "2026-10-23T03:00:00.000Z";
const destination =
  "https://example.invalid/routes/" + "LongRoute".repeat(14) + "?g_st=ac";
const title = "28日の予定を確認\n" + destination + "\n" + "NoSpaces".repeat(24);
const key = "atoqueue:data:v1";
test.use({ timezoneId: "Asia/Tokyo", serviceWorkers: "block" });

async function seed(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const externalRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "https://api.atoqueue.sikumilab.com") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    }
    if (url.origin === "https://example.invalid") {
      externalRequests.push(url.href);
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<title>Synthetic destination</title>Verified synthetic destination",
      });
    }
    if (
      url.origin === origin &&
      ["GET", "HEAD"].includes(route.request().method())
    )
      return route.continue();
    throw new Error("Unexpected external request: " + url.origin);
  });
  const snapshot = createEmptySnapshot({
    appVersion: "mvp-1.34.0",
    localDeviceId: "synthetic-content-device",
    timeZone: "Asia/Tokyo",
    now,
  });
  snapshot.settings.onboardingCompletedAt = now;
  snapshot.settings.notificationEnabled = false;
  const task: Task = {
    id: "content-task",
    sourceCaptureId: "content-capture",
    title,
    status: "active",
    dueMode: "scheduled",
    dueAt: "2026-10-23T14:59:00.000Z",
    nextReviewAt: now,
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  snapshot.tasks = [task];
  snapshot.captures = [
    {
      id: task.sourceCaptureId,
      body: title,
      classification: "task",
      linkedTaskId: task.id,
      createdAt: now,
      updatedAt: now,
    },
  ];
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(
    ({ origin, key, snapshot }) => {
      if (location.origin !== origin) return;
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(snapshot));
      localStorage.setItem("atoqueue:install-prompt-seen:v1", "seen");
    },
    { origin, key, snapshot },
  );
  await page.goto("/today");
  await expect(
    page.getByLabel("確認するタスク", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { externalRequests, errors, task };
}

test("F-009/NF-008 long URL and unbroken text fit phone widths at 100-200% text size", async ({
  page,
  baseURL,
}, testInfo) => {
  const { externalRequests, errors } = await seed(page, baseURL!);
  const metrics = [];
  for (const width of [320, 360, 390, 412]) {
    await page.setViewportSize({ width, height: 900 });
    for (const percent of [100, 150, 200]) {
      await page.evaluate((percent) => {
        document.documentElement.style.fontSize = `${(16 * percent) / 100}px`;
      }, percent);
      const result = await page.evaluate(() => {
        const card = document.querySelector(".reviewTaskCard")!;
        const nodes = [
          card,
          card.querySelector("h2")!,
          card.querySelector(".reviewActionSheet")!,
          ...card.querySelectorAll("button"),
        ];
        return {
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          boxes: nodes.map((node) => {
            const box = node.getBoundingClientRect();
            return {
              name: node.tagName,
              left: box.left,
              right: box.right,
              width: box.width,
              scrollWidth: node.scrollWidth,
              clientWidth: node.clientWidth,
            };
          }),
        };
      });
      metrics.push({ width, percent, ...result });
      expect(
        result.documentWidth,
        `${width}px/${percent}% page`,
      ).toBeLessThanOrEqual(width + 1);
      for (const box of result.boxes) {
        expect(
          box.left,
          `${width}/${percent} ${box.name} left`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          box.right,
          `${width}/${percent} ${box.name} right`,
        ).toBeLessThanOrEqual(width + 1);
        expect(
          box.scrollWidth,
          `${width}/${percent} ${box.name} contents`,
        ).toBeLessThanOrEqual(box.clientWidth + 1);
      }
    }
  }
  await testInfo.attach("phone-layout-metrics", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "16px";
  });
  await page.screenshot({
    path: testInfo.outputPath("long-task-390.png"),
    fullPage: true,
  });
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("F-021 cancel keeps the task and page; approving a tap opens only the confirmed destination", async ({
  page,
  context,
  baseURL,
}) => {
  const { externalRequests, errors, task } = await seed(page, baseURL!);
  const link = page.getByRole("link", { name: destination, exact: true });
  await expect(link).toHaveAttribute("href", destination);
  const before = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).tasks[0],
    key,
  );
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toBe(
      `次のURLをブラウザで開きますか？\n${destination}`,
    );
    await dialog.dismiss();
  });
  await link.click();
  expect(context.pages()).toHaveLength(1);
  expect(externalRequests).toEqual([]);
  await expect(page).toHaveURL(/\/today$/);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).tasks[0],
      key,
    ),
  ).toEqual(before);
  page.once("dialog", (dialog) => dialog.accept());
  const popupPromise = context.waitForEvent("page");
  await link.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  expect(popup.url()).toBe(destination);
  expect(externalRequests).toEqual([destination]);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await expect(page).toHaveURL(/\/today$/);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).tasks[0],
      key,
    ),
  ).toEqual(before);
  expect(before.id).toBe(task.id);
  expect(errors).toEqual([]);
  await popup.close();
});

test("F-021 keyboard and middle click ask before navigation", async ({
  page,
  context,
  baseURL,
}) => {
  const { externalRequests } = await seed(page, baseURL!);
  const link = page.getByRole("link", { name: destination, exact: true });
  for (const action of ["keyboard", "middle"] as const) {
    let confirmations = 0;
    page.once("dialog", async (dialog) => {
      confirmations++;
      await dialog.dismiss();
    });
    if (action === "keyboard") {
      await link.focus();
      await page.keyboard.press("Enter");
    } else await link.click({ button: "middle" });
    expect(confirmations).toBe(1);
    expect(context.pages()).toHaveLength(1);
    expect(externalRequests).toEqual([]);
  }
});

test("F-016/F-021 list and result keep external URLs separate from correction links", async ({
  page,
  baseURL,
}) => {
  const { externalRequests } = await seed(page, baseURL!);
  await page.goto("/tasks");
  await expect(
    page.getByRole("link", { name: destination, exact: true }),
  ).toBeVisible();
  await expect(page.locator("a a")).toHaveCount(0);
  await page.getByRole("link", { name: title + "を修正", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "タスクを修正", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("タイトル", { exact: true })).toHaveValue(
    title.replaceAll("\n", ""),
  );
  await page.goto("/today");
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今日の確認結果", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: destination, exact: true }),
  ).toBeVisible();
  await expect(page.locator("a a")).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});
