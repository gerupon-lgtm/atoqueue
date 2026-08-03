import { expect, test } from "@playwright/test";

test("keeps a suggested capture unclassified until the user confirms タスクにする", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "思いついたこと" }).fill("牛乳を買う");
  await page.getByRole("button", { name: "保存して戻る" }).click();

  await page.goto("/inbox");
  await expect(page.getByRole("listitem").filter({ hasText: "牛乳を買う" })).toBeVisible();
  await page.getByRole("button", { name: "タスクかも" }).click();
  await expect(page.getByRole("heading", { name: "タスク候補を確認" })).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem("atoqueue:data:v1");
        if (!raw) return null;
        const snapshot = JSON.parse(raw) as {
          captures: Array<{ id: string; body: string; classification: string; linkedTaskId?: string }>;
          tasks: unknown[];
        };
        const capture = snapshot.captures.find((item) => item.body === "牛乳を買う");
        return {
          classification: capture?.classification,
          linkedTaskId: capture?.linkedTaskId ?? null,
          taskCount: snapshot.tasks.length,
        };
      }),
    )
    .toEqual({ classification: "unclassified", linkedTaskId: null, taskCount: 0 });

  await page.getByRole("button", { name: "タスクにする" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem("atoqueue:data:v1");
        if (!raw) return null;
        const snapshot = JSON.parse(raw) as {
          captures: Array<{ id: string; body: string; classification: string; linkedTaskId?: string }>;
          tasks: Array<{ id: string; sourceCaptureId: string }>;
        };
        const capture = snapshot.captures.find((item) => item.body === "牛乳を買う");
        return {
          classification: capture?.classification,
          hasLinkedTask: typeof capture?.linkedTaskId === "string",
          linkedTaskMatchesCapture: snapshot.tasks.some(
            (task) => task.id === capture?.linkedTaskId && task.sourceCaptureId === capture.id,
          ),
        };
      }),
    )
    .toEqual({ classification: "task", hasLinkedTask: true, linkedTaskMatchesCapture: true });
});
