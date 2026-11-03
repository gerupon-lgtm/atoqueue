# Unified Capture History and Notification Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 受信箱で登録起点の全履歴を確認・復元・削除でき、「不要」保存直後に古い匿名通知予約を取消・置換する。

**Architecture:** `Capture` の一覧抽出とライフサイクル操作はdomainへ置き、React画面はRepositoryと注入された通知同期サービスだけを使う。通知の匿名予約再計算は既存Outboxを再利用し、端末保存とサーバー同期の成否を別々に扱う。

**Tech Stack:** TypeScript、React 19.2、Vitest、React Testing Library、Playwright、pnpm workspace、既存LocalStorageRepository・NotificationSyncService

## Global Constraints

- 対象要件は F-004、F-006、F-014、NF-004、NF-006、NF-010、NF-013。
- タスク本文・記録本文・分類・ローカルIDを通知API、PostgreSQL、ログ、Push payloadへ送らない。
- 初期タブは `未整理`。`すべて` は登録起点の全Captureを新しい順に1行ずつ表示する。
- タスク化済みCaptureは紐づくタスク詳細へ移動し、同じ一覧へTaskを重複表示しない。
- `unneeded` は自動削除せず、「未整理に戻す」と確認付き「完全削除」を提供する。
- 端末保存成功後の通知同期失敗は分類操作をロールバックせず、Outboxを再送待ちとして保持する。
- データ項目は増やさないため `schemaVersion` は変更しない。
- 複数表示状態と通知同期ロジックの変更として、バージョンを `mvp-1.3.0` へ更新する。

## File Structure

- Create: `packages/domain/src/capture-query.ts` — Captureタブ抽出と表示順だけを担当する。
- Create: `packages/domain/src/capture-query.test.ts` — 全分類・タブ・順序のドメイン契約を固定する。
- Modify: `packages/domain/src/classification.ts` — 不要記録の復元・完全削除と匿名通知系列再計算を担当する。
- Modify: `packages/domain/src/classification.test.ts` — 不要化・復元・削除・通知取消の不変条件を固定する。
- Modify: `packages/domain/src/index.ts` — Capture queryを公開する。
- Modify: `apps/web/src/features/inbox/InboxPage.tsx` — 4タブ、状態ラベル、復元、削除、操作結果を表示する。
- Modify: `apps/web/src/features/inbox/InboxPage.css` — 4タブと不要操作を既存トンマナでコンパクトに配置する。
- Modify: `apps/web/src/features/inbox/InboxPage.test.tsx` — UI・通知同期・失敗時表示を固定する。
- Modify: `apps/web/src/app/router.tsx` — タスク詳細導線とNotificationSyncServiceを注入する。
- Modify: `apps/web/e2e/inbox-classification.spec.ts` — 実ブラウザの不要化・復元・完全削除を検証する。
- Modify: `apps/web/src/app-version.ts`、各workspace `package.json`、`apps/api/src/start.ts` — `mvp-1.3.0`へ揃える。
- Modify: `docs/requirements.md`、`docs/data-model.md`、`docs/screens.md`、`docs/tasks.md`、`docs/api-design.md` — 実装結果と現在バージョンを反映する。

---

### Task 1: Capture一覧の公開クエリ

**Files:**

- Create: `packages/domain/src/capture-query.ts`
- Create: `packages/domain/src/capture-query.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Consumes: `Capture[]` と `CaptureHistoryTab`。
- Produces: `export type CaptureHistoryTab = "all" | "unclassified" | "note" | "unneeded"`、`listCaptures(captures, tab): Capture[]`。

- [ ] **Step 1: 失敗する一覧テストを書く**

```ts
it("F-004 lists every capture once newest-first in the all history", () => {
  const captures = [
    capture("old-task", "2026-08-01T09:00:00.000Z", "task"),
    capture("memo", "2026-08-02T09:00:00.000Z", "note"),
    capture("unneeded", "2026-08-03T09:00:00.000Z", "unneeded"),
    capture("new", "2026-08-04T09:00:00.000Z", "unclassified"),
  ];

  expect(listCaptures(captures, "all").map(({ id }) => id)).toEqual([
    "new",
    "unneeded",
    "memo",
    "old-task",
  ]);
});

it.each(["unclassified", "note", "unneeded"] as const)(
  "filters the %s capture tab",
  (tab) =>
    expect(
      listCaptures(captures, tab).every(
        (capture) => capture.classification === tab,
      ),
    ).toBe(true),
);
```

- [ ] **Step 2: REDを確認する**

Run:

```powershell
& "$env:APPDATA\npm\pnpm.cmd" --filter @atoqueue/domain test -- capture-query.test.ts
```

Expected: `listCaptures` が未実装でFAIL。

- [ ] **Step 3: 最小のクエリを実装する**

```ts
import type { Capture } from "./model";

export type CaptureHistoryTab =
  "all" | Exclude<Capture["classification"], "task">;

export function listCaptures(
  captures: readonly Capture[],
  tab: CaptureHistoryTab,
): Capture[] {
  return captures
    .filter((capture) => tab === "all" || capture.classification === tab)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
```

`packages/domain/src/index.ts`から`./capture-query`をexportする。

- [ ] **Step 4: GREENと型を確認する**

```powershell
& "$env:APPDATA\npm\pnpm.cmd" --filter @atoqueue/domain test -- capture-query.test.ts
& "$env:APPDATA\npm\pnpm.cmd" --filter @atoqueue/domain typecheck
```

Expected: domain全テストと型検査がPASS。

- [ ] **Step 5: Task 1をコミットする**

```powershell
git add packages/domain/src/capture-query.ts packages/domain/src/capture-query.test.ts packages/domain/src/index.ts
git commit -m "feat: query unified capture history (F-004 F-006)"
```

---

### Task 2: 不要記録の復元・削除と通知系列再計算

**Files:**

- Modify: `packages/domain/src/classification.ts`
- Modify: `packages/domain/src/classification.test.ts`

**Interfaces:**

- Consumes: `ClassifyCaptureInput`、既存`rebuildGlobalNotificationSchedules`。
- Produces: `restoreUnneededCapture(input): AppSnapshot`、`deleteUnneededCapture(input): AppSnapshot`。

- [ ] **Step 1: 復元・削除・取消の失敗テストを書く**

```ts
it("F-006 restores an unneeded capture and rebuilds the inbox series", () => {
  const unneeded = markAsUnneeded({
    snapshot: snapshotWithCapture(),
    captureId: "capture-1",
    now,
  });
  const next = restoreUnneededCapture({
    snapshot: unneeded,
    captureId: "capture-1",
    now: later,
  });

  expect(next.captures[0]).toMatchObject({
    classification: "unclassified",
    updatedAt: later,
  });
  expect(next.captures[0]).not.toHaveProperty("classifiedAt");
  expect(next.reminderMap.some((entry) => entry.scope === "inbox")).toBe(true);
  expect(next.actionHistory.at(-1)).toMatchObject({
    action: "capture_classified",
    after: { classification: "unclassified" },
  });
});

it("F-006 permanently deletes only an unneeded capture and its capture history", () => {
  const unneeded = markAsUnneeded({
    snapshot: snapshotWithCapture(),
    captureId: "capture-1",
    now,
  });
  const next = deleteUnneededCapture({
    snapshot: unneeded,
    captureId: "capture-1",
    now: later,
  });

  expect(next.captures).toEqual([]);
  expect(
    next.actionHistory.some(
      (event) =>
        event.entityType === "capture" && event.entityId === "capture-1",
    ),
  ).toBe(false);
  expect(next.reminderMap.some((entry) => entry.scope === "inbox")).toBe(false);
});

it("F-014 cancels every inbox reservation after the last unresolved capture becomes unneeded", () => {
  const next = markAsUnneeded({
    snapshot: snapshotWithCapture(),
    captureId: "capture-1",
    now,
  });
  expect(
    next.notificationOutbox.filter((item) => item.operation === "cancel"),
  ).toHaveLength(4);
  expect(next.reminderMap.some((entry) => entry.scope === "inbox")).toBe(false);
});
```

復元・削除へ`unneeded`以外を渡すと`AlreadyClassifiedError`になるテストも追加する。

- [ ] **Step 2: REDを確認する**

```powershell
& "$env:APPDATA\npm\pnpm.cmd" --filter @atoqueue/domain test -- classification.test.ts
```

Expected: 復元・削除exportが存在せずFAIL。既存不要化取消テストが不足条件を検出できる状態にする。

- [ ] **Step 3: 復元を実装する**

```ts
export function restoreUnneededCapture(
  input: ClassifyCaptureInput,
): AppSnapshot {
  const capture = getClassifiableCapture(
    input.snapshot,
    input.captureId,
    "unneeded",
  );
  const {
    classifiedAt: _classifiedAt,
    linkedTaskId: _linkedTaskId,
    ...rest
  } = capture;
  const updated: Capture = {
    ...rest,
    classification: "unclassified",
    updatedAt: input.now,
  };
  return rebuildAfterCaptureChange(input.snapshot, updated, input.now, true);
}
```

`getClassifiableCapture`の許可分類を`Capture["classification"]`へ広げ、既存呼出しの契約は維持する。`rebuildAfterCaptureChange`はCapture置換、`rebuildGlobalNotificationSchedules`、`capture_classified`履歴、`savedAt`更新を一度だけ行う。

- [ ] **Step 4: 完全削除を実装する**

```ts
export function deleteUnneededCapture(
  input: ClassifyCaptureInput,
): AppSnapshot {
  getClassifiableCapture(input.snapshot, input.captureId, "unneeded");
  const captures = input.snapshot.captures.filter(
    ({ id }) => id !== input.captureId,
  );
  const actionHistory = input.snapshot.actionHistory.filter(
    (event) =>
      !(event.entityType === "capture" && event.entityId === input.captureId),
  );
  const global = rebuildGlobalNotificationSchedules({
    snapshot: { ...input.snapshot, captures, actionHistory },
    now: input.now,
  });
  return {
    ...input.snapshot,
    captures,
    actionHistory,
    ...global,
    savedAt: input.now,
  };
}
```

- [ ] **Step 5: GREENと全domain回帰を確認する**

```powershell
& "$env:APPDATA\npm\pnpm.cmd" --filter @atoqueue/domain test -- classification.test.ts notification-queue.test.ts
& "$env:APPDATA\npm\pnpm.cmd" --filter @atoqueue/domain typecheck
```

Expected: domain全テストPASS。通知OutboxとReminderMapに本文・Capture IDが含まれない。

- [ ] **Step 6: Task 2をコミットする**

```powershell
git add packages/domain/src/classification.ts packages/domain/src/classification.test.ts
git commit -m "feat: restore and delete unneeded captures (F-006 F-014)"
```

---

### Task 3: 受信箱4タブと即時通知同期

**Files:**

- Modify: `apps/web/src/features/inbox/InboxPage.tsx`
- Modify: `apps/web/src/features/inbox/InboxPage.css`
- Modify: `apps/web/src/features/inbox/InboxPage.test.tsx`
- Modify: `apps/web/src/app/router.tsx`

**Interfaces:**

- Consumes: `listCaptures`、`restoreUnneededCapture`、`deleteUnneededCapture`、`NotificationSyncService.flush()`。
- Produces: `InboxPageProps.onTaskOpen?: (taskId: string) => void`、`InboxPageProps.sync?: () => Promise<unknown>`。

- [ ] **Step 1: 4タブと全履歴の失敗テストを書く**

```tsx
it("F-004 shows all capture origins once and opens the linked task", async () => {
  const onTaskOpen = vi.fn();
  render(
    <InboxPage
      repository={repositoryWithEveryClassification()}
      onTaskOpen={onTaskOpen}
    />,
  );

  expect(screen.getByRole("tab", { name: "未整理" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.click(screen.getByRole("tab", { name: "すべて" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
  expect(screen.getByText("タスク化済み")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "タスクを開く" }));
  expect(onTaskOpen).toHaveBeenCalledWith("task-1");
});
```

- [ ] **Step 2: 不要化直後の同期と失敗表示のREDを書く**

```tsx
it("F-014 flushes cancellation immediately after saving an unneeded capture", async () => {
  const sync = vi.fn().mockResolvedValue(undefined);
  const repository = repositoryWithCaptures();
  render(<InboxPage repository={repository} sync={sync} />);
  fireEvent.click((await screen.findAllByRole("button", { name: "不要" }))[0]!);
  await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("status")).toHaveTextContent("不要にしました。");
});

it("keeps the local classification when cancellation synchronization is pending", async () => {
  const sync = vi.fn().mockRejectedValue(new Error("offline"));
  render(<InboxPage repository={repositoryWithCaptures()} sync={sync} />);
  fireEvent.click((await screen.findAllByRole("button", { name: "不要" }))[0]!);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "通知の取消は送信待ちです。",
  );
});
```

不要タブの「未整理に戻す」、確認表示後の「完全削除する」、確認取消のテストも先に追加する。

- [ ] **Step 3: REDを確認する**

```powershell
& "$env:APPDATA\npm\pnpm.cmd" --filter @atoqueue/web test -- InboxPage.test.tsx
```

Expected: 新しいタブ、props、復元・削除UIがないためFAIL。

- [ ] **Step 4: 4タブと分類表示を実装する**

```tsx
const [tab, setTab] = useState<CaptureHistoryTab>("unclassified");
const visibleCaptures = listCaptures(captures, tab);
const labels = {
  unclassified: "未整理",
  note: "メモ",
  unneeded: "不要",
  task: "タスク化済み",
} as const;
```

タブは`すべて / 未整理 / メモ / 不要`の順に4列同幅で表示する。タスク化済み行は本文・登録日時・状態ラベルと「タスクを開く」だけを表示し、`linkedTaskId`を`onTaskOpen`へ渡す。

- [ ] **Step 5: 保存と通知同期を分離して実装する**

```ts
async function persistAndSync(
  next: AppSnapshot,
  successMessage: string,
): Promise<void> {
  await repository.save(next);
  await reload();
  try {
    await sync?.();
    setFeedback(successMessage);
  } catch {
    setFeedback(`${successMessage} 通知の取消は送信待ちです。`);
  }
}
```

分類保存そのものが失敗した場合だけ既存のエラー表示にし、同期失敗で保存済み分類を戻さない。復元時は「未整理に戻しました。」、完全削除時は「完全削除しました。」を表示する。

- [ ] **Step 6: 不要記録の復元と確認付き削除を実装する**

不要行に同幅の「未整理に戻す」「完全削除」を配置する。「完全削除」押下後は同じ行へ本文を含まない確認文と「完全削除する」「やめる」を表示し、確認時だけ`deleteUnneededCapture`を保存する。

- [ ] **Step 7: Routerの公開導線を接続する**

```tsx
<InboxPage
  onTaskCandidate={(captureId) => navigate(`/inbox/${captureId}`)}
  onTaskOpen={(taskId) => navigate(`/tasks/${taskId}`)}
  repository={applicationRepository}
  sync={() => notificationSync.flush()}
/>
```

- [ ] **Step 8: GREEN・型・Web回帰を確認する**

```powershell
& "$env:APPDATA\npm\pnpm.cmd" --filter @atoqueue/web test -- InboxPage.test.tsx
& "$env:APPDATA\npm\pnpm.cmd" --filter @atoqueue/web typecheck
```

Expected: Web全単体テストと型検査がPASS。

- [ ] **Step 9: Task 3をコミットする**

```powershell
git add apps/web/src/features/inbox/InboxPage.tsx apps/web/src/features/inbox/InboxPage.css apps/web/src/features/inbox/InboxPage.test.tsx apps/web/src/app/router.tsx
git commit -m "feat: browse and resolve full capture history (F-004 F-006 F-014)"
```

---

### Task 4: E2E・文書・mvp-1.3.0・デプロイ

**Files:**

- Modify: `apps/web/e2e/inbox-classification.spec.ts`
- Modify: `apps/web/src/app-version.ts`
- Modify: `apps/web/src/features/settings/SettingsPage.test.tsx`
- Modify: `apps/web/e2e/notification-settings.spec.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/start.ts`
- Modify: `packages/domain/package.json`
- Modify: `packages/contracts/package.json`
- Modify: `docs/requirements.md`
- Modify: `docs/data-model.md`
- Modify: `docs/screens.md`
- Modify: `docs/tasks.md`
- Modify: `docs/api-design.md`
- Modify: `docs/superpowers/plans/2026-08-03-atoqueue-mvp.md`

**Interfaces:**

- Consumes: Task 1〜3の公開動作。
- Produces: 公開バージョン`mvp-1.3.0`、設計・実装の一致、実ブラウザ回帰、公開デプロイ。

- [ ] **Step 1: 実ブラウザE2Eを先に追加する**

```ts
test("keeps a recoverable local history and cancels obsolete inbox reminders", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("思いついたこと").fill("履歴テスト");
  await page.getByRole("button", { name: "保存して戻る" }).click();
  await page.getByRole("link", { name: "受信箱" }).click();
  await page.getByRole("button", { name: "不要" }).click();
  await page.getByRole("tab", { name: "不要" }).click();
  await expect(page.getByText("履歴テスト")).toBeVisible();
  await page.getByRole("button", { name: "未整理に戻す" }).click();
  await page.getByRole("tab", { name: "未整理" }).click();
  await expect(page.getByText("履歴テスト")).toBeVisible();
  await page.getByRole("button", { name: "不要" }).click();
  await page.getByRole("tab", { name: "不要" }).click();
  await page.getByRole("button", { name: "完全削除" }).click();
  await page.getByRole("button", { name: "完全削除する" }).click();
  await expect(page.getByText("履歴テスト")).toHaveCount(0);
});
```

- [ ] **Step 2: mvp-1.3.0へ一括更新する**

`APP_VERSION`、API既定version、4 workspace package versions、設定画面単体テスト、通知設定E2E、health例を`mvp-1.3.0`へ揃える。lockfileにworkspace versionが記録されていないことを確認し、不要なlockfile差分は作らない。

- [ ] **Step 3: 設計文書を実装結果へ更新する**

`docs/requirements.md`へ現在version、`docs/data-model.md`へCapture保持・復元・完全削除、`docs/screens.md`へ4タブと操作結果、`docs/tasks.md`へ即時同期、`docs/api-design.md`へhealth version、既存MVP計画末尾へ要件ID・TDD結果・検証件数を記録する。【想定】を新たな【確定】へ変更する場合は、今回承認された範囲だけに限定する。

- [ ] **Step 4: 対象E2EをRED→GREEN確認する**

```powershell
& "$env:APPDATA\npm\pnpm.cmd" --filter @atoqueue/web run test:e2e e2e/inbox-classification.spec.ts --workers=1
```

Expected: 実装前RED、Task 1〜3後GREEN。

- [ ] **Step 5: 全品質ゲートを実行する**

```powershell
& "$env:APPDATA\npm\pnpm.cmd" lint
& "$env:APPDATA\npm\pnpm.cmd" typecheck
& "$env:APPDATA\npm\pnpm.cmd" test
& "$env:APPDATA\npm\pnpm.cmd" build
& "$env:APPDATA\npm\pnpm.cmd" --filter @atoqueue/web run test:e2e --workers=1
git diff --check
```

Expected: Lint、型検査、全単体・結合テスト、本番ビルド、Chromium全E2E、空白検査がPASS。

- [ ] **Step 6: プライバシーとプレースホルダーを再確認する**

```powershell
rg -n "TODO|TBD|XXX|\.skip\(|\.only\(" . --glob '!node_modules/**' --glob '!dist/**'
& "$env:APPDATA\npm\pnpm.cmd" --filter @atoqueue/api test -- privacy-regression.test.ts
```

Expected: 今回追加箇所に未解決placeholderなし。privacy regression PASS。

- [ ] **Step 7: Task 4をコミット・pushする**

```powershell
git add -- apps/web/e2e/inbox-classification.spec.ts apps/web/e2e/notification-settings.spec.ts apps/web/package.json apps/web/src/app-version.ts apps/web/src/features/settings/SettingsPage.test.tsx apps/api/package.json apps/api/src/start.ts packages/domain/package.json packages/contracts/package.json docs/requirements.md docs/data-model.md docs/screens.md docs/tasks.md docs/api-design.md docs/superpowers/plans/2026-08-03-atoqueue-mvp.md
git commit -m "feat: release unified capture history as mvp-1.3.0" -m "Requirements: F-004 F-006 F-014 NF-004 NF-006 NF-010 NF-013"
git push origin task/atoqueue-mvp
```

`git add`の前後で`git status --short`を確認し、既存の未追跡画像・handoff・review report・別計画書をステージしない。Task 1〜3でコミット済みのファイルが残っていないことも確認する。

- [ ] **Step 8: GitHub Actionsと公開状態を確認する**

```powershell
$sha = git rev-parse HEAD
gh workflow run deploy.yml --repo gerupon-lgtm/atoqueue --ref task/atoqueue-mvp -f ref=$sha
$run = gh run list --repo gerupon-lgtm/atoqueue --workflow deploy.yml --event workflow_dispatch --limit 1 --json databaseId,headSha | ConvertFrom-Json
if ($run.headSha -ne $sha) { throw "The newest deployment does not target $sha" }
gh run watch $run.databaseId --repo gerupon-lgtm/atoqueue --exit-status
```

Actions成功後、次を確認する。

```powershell
Invoke-RestMethod "https://api.atoqueue.sikumilab.com/healthz"
Invoke-WebRequest "https://atoqueue.sikumilab.com/" -UseBasicParsing
```

Expected: API health `status=ok`、`version=mvp-1.3.0`。公開PWA bundleに`mvp-1.3.0`が含まれ、`/inbox`を直接開いて4タブを利用できる。
