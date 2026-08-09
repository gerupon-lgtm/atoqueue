import { expect, test } from "@playwright/test";

const navigation = [
  ["/", "記録", "capture"],
  ["/inbox", "受信箱", "inbox"],
  ["/today", "今日", "today"],
  ["/tasks", "タスク", "tasks"],
  ["/settings", "設定", "settings"],
] as const;

test.describe("PWA shell", () => {
  test("serves every primary route with labeled current navigation", async ({
    page,
  }) => {
    for (const [path, label, icon] of navigation) {
      await page.goto(path);

      const currentLink = page.getByRole("link", { name: label });
      await expect(currentLink).toHaveAttribute("aria-current", "page");
      await expect(
        currentLink.locator(`svg[data-icon="${icon}"]`),
      ).toBeVisible();
    }
  });

  test("starts at quick capture and keeps forward keyboard order visible", async ({
    page,
  }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "思いついたこと" });
    const saveButton = page.getByRole("button", { name: "保存して戻る" });
    await expect(input).not.toBeFocused();
    await expect(saveButton).toBeDisabled();

    await input.focus();
    await input.fill("フォーカス順を確認する");
    await expect(saveButton).toBeEnabled();

    await page.keyboard.press("Tab");
    await expect(saveButton).toBeFocused();

    const [first, ...remainingNavigation] = navigation;
    const firstLink = page.getByRole("link", { name: first[1] });
    await firstLink.focus();
    await expect(firstLink).toBeFocused();
    await expect(firstLink).toHaveCSS("outline-style", "solid");

    for (const [, label] of remainingNavigation) {
      await page.keyboard.press("Tab");
      const link = page.getByRole("link", { name: label });
      await expect(link).toBeFocused();
      await expect(link).toHaveCSS("outline-style", "solid");
    }
  });

  test("uses bottom navigation below 768px and a left rail at 768px or wider", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 767, height: 800 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "主要ナビゲーション" });
    await expect(nav).toHaveCSS("flex-direction", "row");
    const mobileLinkBox = await page
      .getByRole("link", { name: "記録" })
      .boundingBox();
    expect(mobileLinkBox?.height).toBeGreaterThanOrEqual(44);

    await page.setViewportSize({ width: 768, height: 800 });
    await expect(nav).toHaveCSS("flex-direction", "column");
  });

  test("keeps the mobile navigation as a compact bottom row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "主要ナビゲーション" });
    const box = await nav.boundingBox();

    expect(box).not.toBeNull();
    expect(box?.height).toBeLessThanOrEqual(80);
    expect(844 - ((box?.y ?? 0) + (box?.height ?? 0))).toBeLessThanOrEqual(24);
    await expect(nav).toHaveCSS("position", "fixed");
  });

  test("keeps the Enter registration checkbox compact on a phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const checkbox = page.getByRole("checkbox", { name: "改行で登録" });
    const box = await checkbox.boundingBox();

    expect(box).not.toBeNull();
    expect(box?.width).toBeLessThanOrEqual(24);
    expect(box?.height).toBeLessThanOrEqual(24);
    await expect(page.getByText("改行で登録", { exact: true })).toHaveCSS(
      "white-space",
      "nowrap",
    );
  });

  test("reloads the visited shell while offline", async ({ context, page }) => {
    await page.goto("/");
    await page.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
    await page.reload();
    await expect
      .poll(
        () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
        { timeout: 10_000 },
      )
      .toBe(true);

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole("link", { name: "記録" })).toBeVisible();
  });

  test("shows iOS installation guidance once in a browser profile", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();

    await page.goto("/");
    await expect(
      page.getByRole("dialog", { name: "あとキューをホーム画面に追加" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "わかりました" }).click();
    await page.reload();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await context.close();
  });

  test("publishes an installable standalone Japanese manifest", async ({
    page,
  }) => {
    await page.goto("/");
    const manifestHref = await page
      .locator('link[rel="manifest"]')
      .getAttribute("href");
    expect(manifestHref).not.toBeNull();

    const manifestUrl = new URL(manifestHref ?? "", page.url()).toString();
    const manifest = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return response.json();
    }, manifestUrl);

    expect(manifest).toMatchObject({
      name: "あとキュー",
      short_name: "あとキュー",
      lang: "ja",
      start_url: "/",
      display: "standalone",
      theme_color: "#173B33",
      background_color: "#F7F5EE",
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icons/icon-192.png",
          sizes: "192x192",
        }),
        expect.objectContaining({
          src: "/icons/icon-512.png",
          sizes: "512x512",
        }),
      ]),
    );
  });
});
