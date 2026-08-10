import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const indexPath = resolve(process.cwd(), "apps/web/index.html");
const publicPath = resolve(process.cwd(), "apps/web/public");

function attribute(tag: string, name: string): string {
  return new RegExp(`${name}="([^"]+)"`).exec(tag)?.[1] ?? "";
}

describe("iOS launch screens", () => {
  it("publishes PNG launch images for common iPhone and iPad sizes", () => {
    const html = readFileSync(indexPath, "utf8");
    const tags = html.match(
      /<link\s+[^>]*rel="apple-touch-startup-image"[^>]*>/g,
    );

    expect(tags?.length).toBeGreaterThanOrEqual(17);

    const launchScreens = (tags ?? []).map((tag) => ({
      href: attribute(tag, "href"),
      media: attribute(tag, "media"),
    }));

    expect(launchScreens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          media: expect.stringContaining("(device-width: 390px)"),
        }),
        expect.objectContaining({
          media: expect.stringContaining("(device-width: 430px)"),
        }),
        expect.objectContaining({
          media: expect.stringContaining("(device-width: 1024px)"),
        }),
      ]),
    );

    for (const launchScreen of launchScreens) {
      expect(launchScreen.media).toContain("orientation:");
      expect(launchScreen.href).toMatch(/^\/ios-splash\/[^/]+\.png$/);

      const file = readFileSync(
        resolve(publicPath, launchScreen.href.replace(/^\//, "")),
      );
      expect(file.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );

      const dimensions = /launch-(\d+)x(\d+)\.png$/.exec(launchScreen.href);
      expect(file.readUInt32BE(16)).toBe(Number(dimensions?.[1]));
      expect(file.readUInt32BE(20)).toBe(Number(dimensions?.[2]));
    }
  });
});
