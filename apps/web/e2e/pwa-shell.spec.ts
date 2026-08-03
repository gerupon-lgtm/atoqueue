import { expect, test } from "@playwright/test";

const navigation = [
  ["/", "險倬鹸"],
  ["/inbox", "蜿嶺ｿ｡邂ｱ"],
  ["/today", "莉頑律"],
  ["/tasks", "繧ｿ繧ｹ繧ｯ"],
  ["/settings", "險ｭ螳啻"],
] as const;

test.describe("PWA shell", () => {
  test("serves every primary route with labeled current navigation", async ({ page }) => {
    for (const [path, label] of navigation) {
      await page.goto(path);

      const currentLink = page.getByRole("link", { name: label });
      await expect(currentLink).toHaveAttribute("aria-current", "page");
    }
  });

  test("keeps focus visible and keyboard order aligned to the primary navigation", async ({
    page,
  }) => {
    await page.goto("/");

    for (const [, label] of navigation) {
      await page.keyboard.press("Tab");
      const link = page.getByRole("link", { name: label });
      await expect(link).toBeFocused();
      await expect(link).toHaveCSS("outline-style", "solid");
    }
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

    await expect(page.getByRole("link", { name: "險倬鹸" })).toBeVisible();
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
      name: "縺ゅ→繧ｭ繝･繝ｼ",
      short_name: "縺ゅ→繧ｭ繝･繝ｼ",
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
