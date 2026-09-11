import { expect, test, type Page } from "@playwright/test";
import { makeTempalistFixture } from "../../../packages/domain/src/tempalist-test-fixture";
import {
  markTempalistOpened,
  prepareTempalistRequest,
  type AppSnapshot,
} from "../../../packages/domain/src";

const storageKey = "atoqueue:data:v1";
const receiver = "https://tempalist.sikumilab.com/**";

test("F-020 compact selection keeps aligned badges and reachable bottom actions at mobile widths", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  const fixture = makeTempalistFixture();
  const handoff = markTempalistOpened({
    state: fixture.snapshot.tempalist,
    request: prepareTempalistRequest(fixture),
    existingTaskIds: fixture.snapshot.tasks.map((task) => task.id),
    now: fixture.now,
  });
  await page.evaluate(
    ({ key, handoff }) => {
      const snapshot = JSON.parse(localStorage.getItem(key)!);
      snapshot.tempalist = handoff;
      for (let index = 2; index < 8; index++) {
        const task = {
          ...snapshot.tasks[0],
          id: `task-${index}`,
          sourceCaptureId: `capture-${index}`,
          title: `買い物の確認 ${index}`,
        };
        snapshot.tasks.push(task);
        snapshot.captures.push({
          ...snapshot.captures[0],
          id: task.sourceCaptureId,
          linkedTaskId: task.id,
        });
      }
      localStorage.setItem(key, JSON.stringify(snapshot));
    },
    { key: storageKey, handoff },
  );
  await page.reload();
  await page
    .getByRole("button", { name: "チェックリストにする", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "牛乳を買うを選択" }).check();
  await page.getByRole("checkbox", { name: "電池を買うを選択" }).check();
  for (const width of [320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    const checkbox = page.getByRole("checkbox", { name: "牛乳を買うを選択" });
    const checkBox = (await checkbox.boundingBox())!;
    expect(checkBox.width).toBeLessThanOrEqual(24);
    expect(checkBox.height).toBeLessThanOrEqual(24);
    const label = checkbox.locator("..");
    expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const text = (await label
      .getByText("選択", { exact: true })
      .boundingBox())!;
    expect(
      Math.abs(text.y + text.height / 2 - checkBox.y - checkBox.height / 2),
    ).toBeLessThan(2);
    const badges = await page
      .getByLabel("テンパリストへ開く操作済み", { exact: true })
      .all();
    const boxes = await Promise.all(badges.map((badge) => badge.boundingBox()));
    expect(
      Math.abs(boxes[0]!.x + boxes[0]!.width - boxes[1]!.x - boxes[1]!.width),
    ).toBeLessThan(2);
    expect(
      Math.abs(
        boxes[0]!.y + boxes[0]!.height / 2 - checkBox.y - checkBox.height / 2,
      ),
    ).toBeLessThan(2);
    const card = page
      .getByRole("link", { name: "牛乳を買う", exact: true })
      .locator("xpath=ancestor::li[1]");
    expect((await card.boundingBox())!.height).toBeLessThanOrEqual(190);
    const bar = page.getByRole("region", { name: "チェックリスト選択の操作" });
    const before = (await bar.boundingBox())!;
    await expectBottomControlsVisible(page, ["選択をやめる", "内容を確認"]);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(100);
    expect((await bar.boundingBox())!.y).toBeCloseTo(before.y, 0);
    const lastCard = (await page
      .getByRole("link", { name: "買い物の確認 7", exact: true })
      .locator("xpath=ancestor::li[1]")
      .boundingBox())!;
    expect(lastCard.y + lastCard.height).toBeLessThanOrEqual(before.y);
    const cancel = (await page
      .getByRole("button", { name: "選択をやめる" })
      .boundingBox())!;
    const confirm = (await page
      .getByRole("button", { name: "内容を確認", exact: true })
      .boundingBox())!;
    expect(cancel.y).toBeCloseTo(confirm.y, 0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`selection-${width}.png`),
      fullPage: false,
    });
  }
  await page.setViewportSize({ width: 320, height: 450 });
  await expectBottomControlsVisible(page, ["選択をやめる", "内容を確認"]);
  await page.getByRole("checkbox", { name: "牛乳を買うを選択" }).check();
  await page.getByRole("button", { name: "内容を確認", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "チェックリストの確認" }),
  ).toBeFocused();
});

for (const scenario of [
  {
    name: "iPhone home screen",
    agent: "iPhone",
    platform: "iPhone",
    standalone: true,
    fullscreen: false,
    blocked: true,
  },
  {
    name: "iPad desktop identity",
    agent: "Macintosh",
    platform: "MacIntel",
    standalone: true,
    fullscreen: false,
    blocked: true,
  },
  {
    name: "iPhone fullscreen",
    agent: "iPhone",
    platform: "iPhone",
    standalone: false,
    fullscreen: true,
    blocked: true,
  },
  {
    name: "iPhone browser",
    agent: "iPhone",
    platform: "iPhone",
    standalone: false,
    fullscreen: false,
    blocked: false,
  },
  {
    name: "Android home screen",
    agent: "Android",
    platform: "Linux arm",
    standalone: true,
    fullscreen: false,
    blocked: false,
  },
]) {
  test(`F-020 sender availability: ${scenario.name}`, async ({ page }) => {
    await page.addInitScript((scenario) => {
      Object.defineProperty(navigator, "userAgent", { value: scenario.agent });
      Object.defineProperty(navigator, "platform", {
        value: scenario.platform,
      });
      Object.defineProperty(navigator, "maxTouchPoints", { value: 5 });
      Object.defineProperty(navigator, "standalone", {
        value: scenario.standalone,
      });
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        query === "(display-mode: fullscreen)"
          ? { ...original(query), matches: scenario.fullscreen }
          : original(query);
    }, scenario);
    const state = await seed(page);
    const start = page.getByRole("button", {
      name: "チェックリストにする",
      exact: true,
    });
    if (scenario.blocked) {
      await expect(start).toBeDisabled();
      await expect(
        page.getByText(/ホーム画面版では連携を利用できません/),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "直前の連携を確認" }),
      ).toHaveCount(0);
      expectUnchanged(await readSnapshot(page), state.snapshot);
    } else {
      await review(page);
      await page
        .getByRole("button", { name: "内容を確定", exact: true })
        .click();
      await open(page);
      expect(state.externalOpens()).toBe(1);
    }
    expect(state.notificationRequests()).toBe(0);
  });
}

async function seed(page: Page) {
  const { snapshot, now } = makeTempalistFixture();
  snapshot.settings.onboardingCompletedAt = now;
  snapshot.device.pushSubscriptionStatus = "denied";
  snapshot.tasks.forEach((task, index) => {
    task.nextReviewAt = "2099-09-14T00:00:00.000Z";
    const reminderId = `22222222-2222-4222-8222-22222222222${index}`;
    snapshot.reminderMap.push({
      reminderId,
      taskId: task.id,
      kind: "review",
      taskRevision: 1,
      createdAt: now,
    });
    snapshot.notificationOutbox.push({
      id: `33333333-3333-4333-8333-33333333333${index}`,
      operation: "upsert",
      reminderId,
      notificationType: "unset_due_review",
      scheduledAt: task.nextReviewAt,
      nextAttemptAt: task.nextReviewAt,
      taskRevision: 1,
      attemptCount: 0,
      createdAt: now,
    });
  });
  let externalOpens = 0;
  let notificationRequests = 0;
  await page.route(receiver, async (route) => {
    externalOpens++;
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<p>受信先の試験用画面</p>",
    });
  });
  await page.route("https://api.atoqueue.sikumilab.com/**", async (route) => {
    notificationRequests++;
    await route.fulfill({
      status: 503,
      body: "synthetic test must not send notifications",
    });
  });
  await page.addInitScript(
    ({ snapshot, storageKey }) => {
      if (location.hostname !== "127.0.0.1") return;
      if (!localStorage.getItem(storageKey))
        localStorage.setItem(storageKey, JSON.stringify(snapshot));
      localStorage.setItem("atoqueue:install-prompt-seen:v1", "seen");
    },
    { snapshot, storageKey },
  );
  await page.goto("/tasks");
  await expect(
    page.getByRole("link", { name: "牛乳を買う", exact: true }),
  ).toBeVisible();
  return {
    snapshot,
    externalOpens: () => externalOpens,
    notificationRequests: () => notificationRequests,
  };
}

async function readSnapshot(page: Page): Promise<AppSnapshot> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
}

async function review(page: Page) {
  await page
    .getByRole("button", { name: "チェックリストにする", exact: true })
    .click();
  for (const title of ["牛乳を買う", "電池を買う"]) {
    await page.getByRole("checkbox", { name: `${title}を選択` }).check();
  }
  await page.getByRole("button", { name: "内容を確認", exact: true }).click();
  await page
    .getByRole("textbox", { name: "リスト名", exact: true })
    .fill("買い物");
}

async function open(page: Page, name = "テンパリストで開く") {
  await Promise.all([
    page.waitForURL(receiver),
    page.getByRole("button", { name, exact: true }).click(),
  ]);
  // A URL fragment is absent from HTTP requests. Inspect the complete navigation URL.
  return page.url();
}

async function expectBottomControlsVisible(page: Page, names: string[]) {
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const navigation = (await page
    .getByRole("navigation", { name: "主要ナビゲーション" })
    .boundingBox())!;
  for (const name of names) {
    const box = (await page
      .getByRole("button", { name, exact: true })
      .boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(navigation.y);
  }
}

function decode(url: string) {
  return JSON.parse(
    Buffer.from(
      new URL(url).hash.slice("#create=".length),
      "base64url",
    ).toString("utf8"),
  );
}

function expectUnchanged(actual: AppSnapshot, original: AppSnapshot) {
  expect(actual.tasks).toEqual(original.tasks);
  expect(actual.captures).toEqual(original.captures);
  expect(actual.notificationOutbox).toEqual(original.notificationOutbox);
  expect(actual.reminderMap).toEqual(original.reminderMap);
  expect(actual.device).toEqual(original.device);
}

test("F-020 persists only handoff state, reopens the stored URL after return/reload, and gives edited content a new ID", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const state = await seed(page);
  await review(page);
  await page.screenshot({
    path: testInfo.outputPath("tempalist-review-320.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "内容を確定", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "テンパリストで開く", exact: true }),
  ).toBeVisible();
  const prepared = await readSnapshot(page);
  expectUnchanged(prepared, state.snapshot);
  expect(prepared.tempalist.markers).toEqual([]);
  const firstUrl = await open(page);
  expect(decode(firstUrl)).toEqual({
    schemaVersion: 1,
    kind: "checklist-create",
    source: "atoqueue",
    requestId: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ),
    title: "買い物",
    items: [
      { sourceTaskId: "task-0", label: "牛乳を買う" },
      { sourceTaskId: "task-1", label: "電池を買う" },
    ],
  });
  expect(firstUrl).toBe(prepared.tempalist.lastRequest!.url);
  expect(firstUrl.length).toBeLessThanOrEqual(8000);
  expect(new URL(firstUrl).search).toBe("");
  await page.goBack();
  await page.reload();
  await expect(
    page.getByLabel("テンパリストへ開く操作済み", { exact: true }),
  ).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath("tempalist-linked-320.png"),
    fullPage: true,
  });
  expectUnchanged(await readSnapshot(page), state.snapshot);
  expect(state.externalOpens()).toBe(1);
  await page
    .getByRole("button", { name: "直前の連携を確認", exact: true })
    .click();
  await expectBottomControlsVisible(page, [
    "直前の連携をもう一度開く",
    "タスクに戻る",
  ]);
  await page.screenshot({
    path: testInfo.outputPath("tempalist-retry-bottom-320.png"),
  });
  expect(await open(page, "直前の連携をもう一度開く")).toBe(firstUrl);
  await page.goBack();
  await page.reload();
  await review(page);
  await page.getByRole("button", { name: "内容を確定", exact: true }).click();
  await expect(page.getByRole("button", { name: "編集に戻る" })).toBeVisible();
  const beforeEdit = (await readSnapshot(page)).tempalist.lastRequest!;
  await page.getByRole("button", { name: "編集に戻る" }).click();
  await page.getByRole("textbox", { name: "リスト名" }).fill("週末の買い物");
  await page.getByRole("button", { name: "電池を買うを上へ" }).click();
  await page.getByRole("button", { name: "内容を確定", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "テンパリストで開く", exact: true }),
  ).toBeVisible();
  const edited = (await readSnapshot(page)).tempalist.lastRequest!;
  expect(edited.payload.requestId).not.toBe(beforeEdit.payload.requestId);
  expect(edited.payload.requestId).not.toBe(decode(firstUrl).requestId);
  expect(edited.payload.title).toBe("週末の買い物");
  expect(edited.payload.items[0]!.sourceTaskId).toBe("task-1");
  expect(await open(page)).toBe(edited.url);
  await page.goBack();
  expectUnchanged(await readSnapshot(page), state.snapshot);
  expect(state.notificationRequests()).toBe(0);
});

test("F-020 blocks the complete URL above 8000 characters without saving or opening", async ({
  page,
}) => {
  const state = await seed(page);
  await review(page);
  await page.getByRole("textbox", { name: "リスト名" }).fill("あ".repeat(2200));
  await expect(page.getByRole("alert")).toContainText(
    "項目を分けて送ってください",
  );
  await expect(
    page.getByRole("button", { name: "内容を確定", exact: true }),
  ).toBeDisabled();
  const count = await page.getByText(/URL文字数:/).textContent();
  expect(Number(count!.match(/URL文字数: (\d+)/)![1])).toBeGreaterThan(8000);
  expect((await readSnapshot(page)).tempalist.lastRequest).toBeNull();
  expectUnchanged(await readSnapshot(page), state.snapshot);
  expect(state.externalOpens()).toBe(0);
});

test("F-020 never opens on storage exhaustion before prepare or before marker save and retries the same saved URL", async ({
  page,
}) => {
  const state = await seed(page);
  await review(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        key === "atoqueue:data:v1" &&
        sessionStorage.getItem("test:quota") === "full"
      ) {
        throw new DOMException(
          "Synthetic storage capacity",
          "QuotaExceededError",
        );
      }
      original.call(this, key, value);
    };
    sessionStorage.setItem("test:quota", "full");
  });
  await page.getByRole("button", { name: "内容を確定", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "確定内容を保存できませんでした",
  );
  expect((await readSnapshot(page)).tempalist.lastRequest).toBeNull();
  expect(state.externalOpens()).toBe(0);
  await page.evaluate(() => sessionStorage.removeItem("test:quota"));
  await page.getByRole("button", { name: "内容を確定", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "テンパリストで開く", exact: true }),
  ).toBeVisible();
  const saved = await readSnapshot(page);
  await page.evaluate(() => sessionStorage.setItem("test:quota", "full"));
  await page
    .getByRole("button", { name: "テンパリストで開く", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "同じ内容でもう一度開いてください",
  );
  expect(await readSnapshot(page)).toEqual(saved);
  expect(state.externalOpens()).toBe(0);
  await page.evaluate(() => sessionStorage.removeItem("test:quota"));
  expect(await open(page)).toBe(saved.tempalist.lastRequest!.url);
  await page.goBack();
  expectUnchanged(await readSnapshot(page), state.snapshot);
});

test("NF-006 operates selection, reordering and confirmation by keyboard at 320px", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 450 });
  await seed(page);
  await page.getByRole("button", { name: "チェックリストにする" }).focus();
  await page.keyboard.press("Enter");
  for (const title of ["牛乳を買う", "電池を買う"]) {
    const checkbox = page.getByRole("checkbox", { name: `${title}を選択` });
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).toBeChecked();
  }
  await page.getByRole("button", { name: "内容を確認", exact: true }).focus();
  await page.keyboard.press("Enter");
  const name = page.getByRole("textbox", { name: "リスト名" });
  await name.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Keyboard list");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "牛乳を買うを下へ" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("transfer-item").first()).toContainText(
    "電池を買う",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "内容を確定", exact: true }).focus();
  await page.keyboard.press("Enter");
  const launch = page.getByRole("button", {
    name: "テンパリストで開く",
    exact: true,
  });
  await expect(launch).toBeVisible();
  await launch.focus();
  await expect(launch).toBeFocused();
  await expectBottomControlsVisible(page, [
    "テンパリストで開く",
    "編集に戻る",
    "選択に戻る",
  ]);
  await page.screenshot({
    path: testInfo.outputPath("tempalist-keyboard-320x450.png"),
  });
  await Promise.all([page.waitForURL(receiver), page.keyboard.press("Enter")]);
  expect(decode(page.url()).title).toBe("Keyboard list");
});
