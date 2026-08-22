import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

import { chromium } from "@playwright/test";

const outputDirectory = fileURLToPath(
  new URL("../public/ios-splash/", import.meta.url),
);
const icon = await readFile(
  fileURLToPath(new URL("../public/apple-touch-icon.png", import.meta.url)),
);
const iconDataUrl = `data:image/png;base64,${icon.toString("base64")}`;

const portraitTargets = [
  [320, 568, 2],
  [375, 667, 2],
  [414, 736, 3],
  [375, 812, 3],
  [414, 896, 2],
  [414, 896, 3],
  [390, 844, 3],
  [428, 926, 3],
  [393, 852, 3],
  [430, 932, 3],
  [402, 874, 3],
  [440, 956, 3],
  [768, 1024, 2],
  [810, 1080, 2],
  [820, 1180, 2],
  [834, 1112, 2],
  [834, 1194, 2],
  [834, 1210, 2],
  [1024, 1366, 2],
  [1032, 1376, 2],
];

const landscapeTargets = portraitTargets
  .filter(([width]) => width >= 768)
  .map(([width, height, deviceScaleFactor]) => [
    height,
    width,
    deviceScaleFactor,
  ]);

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });

try {
  for (const [width, height, deviceScaleFactor] of [
    ...portraitTargets,
    ...landscapeTargets,
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor,
    });
    const iconSize = Math.min(192, Math.round(Math.min(width, height) * 0.34));

    await page.setContent(`<!doctype html>
      <html>
        <head>
          <style>
            * { box-sizing: border-box; }
            html, body { width: 100%; height: 100%; margin: 0; }
            body {
              display: grid;
              place-items: center;
              background: #f7f5ee;
            }
            img {
              width: ${iconSize}px;
              height: ${iconSize}px;
              border-radius: 27%;
            }
          </style>
        </head>
        <body><img src="${iconDataUrl}" alt="" /></body>
      </html>`);

    const pixelWidth = width * deviceScaleFactor;
    const pixelHeight = height * deviceScaleFactor;
    await page.screenshot({
      path: `${outputDirectory}/launch-${pixelWidth}x${pixelHeight}.png`,
      type: "png",
    });
    await page.close();
  }
} finally {
  await browser.close();
}
