import { expect, test } from "@playwright/test";

const navigation = [
  ["/", "記録", "✎"],
  ["/inbox", "受信箱", "▣"],
  ["/today", "今日", "☀"],
  ["/tasks", "タスク", "✓"],
  ["/settings", "設定", "⚙"],
] as const;

test.describe("PWA shell", () => {
  test("serves every primary route with labeled current navigation", async ({ page }) => {
    for (const [path, label, icon] of navigation) {
      await page.goto(path);

      const currentLink = page.getByRole("link", { name: label });
      await expect(currentLink).toHaveAttribute("aria-current", "page");
      await expect(currentLink.locator('[aria-hidden="true"]')).toHaveText(icon);
    }
  });

  test("starts at quick capture and keeps forward keyboard order visible", async ({ page }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "思いついたこと" });
    const saveButton = page.getByRole("button", { name: "保存して戻る" });
    await expect(input).toBeFocused();
    await expect(saveButton).toBeDisabled();

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
    await expect(page.getByRole("link", { name: "記録" })).toHaveCSS(
      "min-height",
      "44px",
    );

    await page.setViewportSize({ width: 768, height: 800 });
    await expect(nav).toHaveCSS("flex-direction", "column");
  });

  test("keeps the mobile navigation as a compact bottom row", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "荳ｻ隕√リ繝薙ご繝ｼ繧ｷ繝ｧ繝ｳ" });
    const box = await nav.boundingBox();

    expect(box).not.toBeNull();
    expect(box?.height).toBeLessThanOrEqual(80);
    expect(844 - ((box?.y ?? 0) + (box?.height ?? 0))).toBeLessThanOrEqual(24);
    await expect(nav).toHaveCSS("position", "fixed");
  });

  test("reloads the visited shell while offline", async ({ context, page }) => {
    await page.goto("/");
    await expect
      .poll(() =>
        page.evaluate(() =>
          navigator.serviceWorker.getRegistration().then((registration) =>
            Boolean(registration),
          ),
        ),
      )
      .toBe(true);
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole("link", { name: "記録" })).toBeVisible();
  });

  test("publishes an installable standalone Japanese manifest", async ({ page }) => {
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
        expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192" }),
        expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512" }),
      ]),
    );
  });
});
