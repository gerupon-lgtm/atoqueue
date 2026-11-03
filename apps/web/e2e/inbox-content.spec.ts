import { expect, test } from "@playwright/test";
import { createEmptySnapshot } from "../../../packages/domain/src";

const now = "2026-11-03T05:09:00.000Z";
const url = "https://example.invalid/article/" + "LongUnbrokenAddress".repeat(12) + "?source=test";
test.use({ serviceWorkers: "block", timezoneId: "Asia/Tokyo" });
test.beforeEach(async ({ page, baseURL, context }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", route => {
    const target = new URL(route.request().url());
    if (target.origin === "https://example.invalid") return route.fulfill({ contentType: "text/html", body: "<title>Synthetic destination</title>Test destination" });
    if (target.origin === "https://api.atoqueue.sikumilab.com") return route.fulfill({ contentType: "application/json", body: "{}" });
    if (target.origin === origin && route.request().method() === "GET") return route.continue();
    return route.abort();
  });
  const snapshot = createEmptySnapshot({ appVersion: "mvp-1.35.0", localDeviceId: "synthetic-inbox", timeZone: "Asia/Tokyo", now });
  snapshot.settings.onboardingCompletedAt = now;
  snapshot.captures = (["unclassified", "note", "unneeded"] as const).map(classification => ({ id: classification, body: url, classification, createdAt: now, updatedAt: now }));
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(({ origin, snapshot }) => {
    if (location.origin !== origin) return;
    if (!localStorage.getItem("atoqueue:data:v1")) localStorage.setItem("atoqueue:data:v1", JSON.stringify(snapshot));
    localStorage.setItem("atoqueue:install-prompt-seen:v1", "seen");
  }, { origin, snapshot });
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "受信箱" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
});

test("F-004/NF-008 inbox cards, tabs, editors and actions fit narrow screens and enlarged text", async ({ page }, testInfo) => {
  const measurements = [];
  for (const width of [320, 360, 393, 412, 448]) {
    await page.setViewportSize({ width, height: 900 });
    for (const percent of [100, 150, 200]) {
      await page.evaluate(percent => { document.documentElement.style.fontSize = `${16 * percent / 100}px`; }, percent);
      for (const tab of ["未整理", "メモ", "不要"]) {
        await page.getByRole("tab", { name: new RegExp(tab) }).click();
        const result = await page.evaluate(() => {
          const link = document.querySelector('.inbox-page .linked-task-text a')!;
          const range = document.createRange();
          range.selectNodeContents(link);
          const tops = [...new Set([...range.getClientRects()].map(rect => rect.top))].sort((a, b) => a - b);
          return {
          linePitch: tops[1] - tops[0],
          fontSize: parseFloat(getComputedStyle(link).fontSize),
          document: document.documentElement.scrollWidth,
          boxes: [...document.querySelectorAll('[aria-labelledby="inbox-title"] .inbox-tabs, [aria-labelledby="inbox-title"] ul, [aria-labelledby="inbox-title"] li, [aria-labelledby="inbox-title"] textarea, [aria-labelledby="inbox-title"] button')].map(node => {
            const box = node.getBoundingClientRect();
            return { name: node.tagName + " " + node.textContent?.slice(0, 30), left: box.left, right: box.right, client: node.clientWidth, scroll: node.scrollWidth };
          }),
        }; });
        measurements.push({ width, percent, tab, ...result });
        expect(result.document, `${width}px ${percent}% ${tab}`).toBeLessThanOrEqual(width + 1);
        expect(result.linePitch, `${width}px ${percent}% ${tab} line spacing`).toBeGreaterThanOrEqual(result.fontSize * 1.45);
        for (const box of result.boxes) {
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width + 1);
          expect(box.scroll, `${width}px ${percent}% ${tab} ${box.name}`).toBeLessThanOrEqual(box.client + 1);
        }
      }
    }
  }
  await testInfo.attach("inbox-widths", { body: JSON.stringify(measurements), contentType: "application/json" });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
  await page.getByRole("tab", { name: /未整理/ }).click();
  await page.screenshot({ path: testInfo.outputPath("inbox-412.png"), fullPage: true });
});

test("F-004/F-021 inbox and notes open links only after confirmation without saving edits", async ({ page, context }) => {
  for (const tab of ["未整理", "メモ"]) {
    await page.getByRole("tab", { name: new RegExp(tab) }).click();
    const link = page.getByRole("link", { name: url, exact: true });
    await expect(link).toHaveAttribute("href", url);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("atoqueue:data:v1")!).captures);
    await page.getByLabel("本文を編集").fill("保存前の下書き");
    page.once("dialog", async dialog => { expect(dialog.message()).toContain(url); await dialog.dismiss(); });
    await link.click();
    expect(context.pages()).toHaveLength(1);
    page.once("dialog", dialog => dialog.accept());
    const opened = context.waitForEvent("page");
    await link.click();
    const popup = await opened;
    await popup.waitForLoadState("domcontentloaded");
    expect(popup.url()).toBe(url);
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("atoqueue:data:v1")!).captures)).toEqual(before);
    await expect(page.getByLabel("本文を編集")).toHaveValue("保存前の下書き");
  }
});
