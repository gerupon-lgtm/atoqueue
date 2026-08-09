# Custom Task Categories and Backup Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 利用者が端末固有のタスクカテゴリを最大10件追加・削除・選択でき、バックアップ復元が洗い替えであることと復元後の全通知再構築を明確にする。

**Architecture:** `Settings.customTaskCategories` とカテゴリ用domain関数を唯一のルール源とし、Web画面はrepository経由でSnapshotを一度だけ保存する。既存Taskはカテゴリ名を直接保持して削除後も値を残し、復元は既存のdomainバックアップ境界で全体通知系列とTask通知を再構築する。

**Tech Stack:** TypeScript、React 19.2、Vitest、React Testing Library、Playwright、pnpm workspace、localStorage repository

## Global Constraints

- プリセットは `仕事 / 家 / 買い物 / その他` の4件で変更不可とする。
- 追加カテゴリは端末内だけに保存し、最大10件、前後空白除去後1〜12文字とする。
- 削除済みカテゴリは既存Taskへ残し、新規選択肢からだけ外す。
- 追加カテゴリ名の同一表記が本文へ含まれる場合だけ候補提示し、自動確定しない。
- 通知APIへカテゴリ名、Task本文、復元件数を送らない。
- 復元は追加ではなく一括置換で、復元先端末のDeviceStateを維持する。
- UIは現行設定画面の配色、余白、カード、ボタン、完了表示を踏襲する。
- 表示・API・文書のバージョンを `mvp-1.5.0` に揃える。

---

## File Structure

- Create `packages/domain/src/task-categories.ts`: プリセット定義、追加カテゴリ検証、候補決定、過去カテゴリ、使用件数を提供する。
- Create `packages/domain/src/task-categories.test.ts`: カテゴリの全domain契約を固定する。
- Modify `packages/domain/src/model.ts`: schema 8、追加カテゴリ設定、Taskカテゴリ文字列を定義する。
- Modify `packages/domain/src/migrations.ts`: schema 7→8移行と厳格検証を追加する。
- Modify `packages/domain/src/repository.ts`: 空Snapshotの追加カテゴリ初期値を追加する。
- Modify `packages/domain/src/candidate.ts`: 有効な追加カテゴリを受け取る候補生成へ拡張する。
- Modify `packages/domain/src/backup.ts`: 復元時にTask、受信箱、メモの通知系列を再構築する。
- Create `apps/web/src/features/settings/CategorySettings.tsx`: 追加、削除予定、取消、保存、件数表示を担当する。
- Create `apps/web/src/features/settings/CategorySettings.css`: 現行トンマナでタグと編集UIを配置する。
- Create `apps/web/src/features/settings/CategorySettings.test.tsx`: 設定UIと保存境界を固定する。
- Modify `apps/web/src/features/settings/SettingsPage.tsx`: データカード内でカテゴリをバックアップより前に構成する。
- Modify `apps/web/src/features/settings/BackupSettings.tsx`: 洗い替え、端末間コピー、同期結果の文言を表示する。
- Modify `apps/web/src/features/inbox/TaskCandidatePage.tsx`: 追加カテゴリ候補と選択肢を表示する。
- Modify `apps/web/src/features/tasks/TaskDetailPage.tsx`: 有効・過去カテゴリを編集できるようにする。
- Modify `apps/web/src/features/tasks/TaskListPage.tsx`: 有効・過去カテゴリで絞り込む。
- Create `apps/web/src/features/tasks/task-category-options.ts`: 3画面共通の表示用カテゴリ選択肢を組み立てる。
- Modify `apps/web/e2e/backup-restore.spec.ts`: 追加カテゴリの別context復元と洗い替えを確認する。
- Create `apps/web/e2e/custom-task-categories.spec.ts`: スマホ幅の追加・タスク化・削除後保持を確認する。
- Modify requirements/design/tasks/plans/version files: 実装結果と `mvp-1.5.0` を記録する。

---

### Task 1: Schema 8 and Category Domain Rules

**Files:**

- Create: `packages/domain/src/task-categories.ts`
- Create: `packages/domain/src/task-categories.test.ts`
- Modify: `packages/domain/src/model.ts`
- Modify: `packages/domain/src/migrations.ts`
- Modify: `packages/domain/src/repository.test.ts`
- Modify: `packages/domain/src/repository.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces: `PRESET_TASK_CATEGORIES`, `validateCustomTaskCategories(names: readonly string[]): string[]`, `suggestTaskCategory(body: string, custom: readonly string[]): string | undefined`, `taskCategoryUsage(tasks: readonly Task[], category: string): { total: number; active: number; finished: number }`, `pastTaskCategories(tasks: readonly Task[], activeCustom: readonly string[]): string[]`.
- Produces: `Settings.customTaskCategories: string[]`, `AppSnapshot.schemaVersion: 8`, `Task.category?: string`.

- [x] **Step 1: Write failing category-domain tests**

```ts
it("trims valid custom categories and rejects preset, duplicate, long, and eleventh names", () => {
  expect(validateCustomTaskCategories([" 経費 ", "冷蔵庫"])).toEqual([
    "経費",
    "冷蔵庫",
  ]);
  expect(() => validateCustomTaskCategories(["仕事"])).toThrow("プリセット");
  expect(() => validateCustomTaskCategories(["経費", "経費"])).toThrow(
    "登録済み",
  );
  expect(() => validateCustomTaskCategories(["1234567890123"])).toThrow(
    "12文字",
  );
  expect(() =>
    validateCustomTaskCategories(
      Array.from({ length: 11 }, (_, i) => `分類${i}`),
    ),
  ).toThrow("10件");
});

it("keeps exact-script suggestions local and prefers the longest registered match", () => {
  expect(suggestTaskCategory("冷蔵庫の豆腐", ["冷蔵", "冷蔵庫"])).toBe(
    "冷蔵庫",
  );
  expect(suggestTaskCategory("れいぞうこのとうふ", ["冷蔵庫"])).toBeUndefined();
});

it("counts every task while separating active and finished usage", () => {
  expect(taskCategoryUsage(tasks, "冷蔵庫")).toEqual({
    total: 3,
    active: 2,
    finished: 1,
  });
});
```

- [x] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @atoqueue/domain test -- task-categories.test.ts repository.test.ts`

Expected: FAIL because module exports and schema 8 do not exist.

- [x] **Step 3: Implement schema and category rules**

```ts
export const PRESET_TASK_CATEGORIES = [
  { value: "work", label: "仕事" },
  { value: "home", label: "家" },
  { value: "shopping", label: "買い物" },
  { value: "other", label: "その他" },
] as const;

export function validateCustomTaskCategories(
  names: readonly string[],
): string[] {
  const normalized = names.map((name) => name.trim());
  if (normalized.length > 10) throw new Error("追加カテゴリは10件までです。");
  // Validate 1..12 characters and exact duplicate/preset labels before returning.
  return normalized;
}
```

Add `upgradeV7ToV8()` with `customTaskCategories: []`, validate the array only for schema 8, and include it in `normalizeSnapshot()`.

- [x] **Step 4: Run domain tests to verify GREEN**

Run: `pnpm --filter @atoqueue/domain test -- task-categories.test.ts repository.test.ts`

Expected: PASS.

- [x] **Step 5: Commit Task 1**

```bash
git add packages/domain/src
git commit -m "feat: add local custom task category rules"
```

---

### Task 2: Category Settings Editor

**Files:**

- Create: `apps/web/src/features/settings/CategorySettings.tsx`
- Create: `apps/web/src/features/settings/CategorySettings.css`
- Create: `apps/web/src/features/settings/CategorySettings.test.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.css`
- Modify: `apps/web/src/features/settings/SettingsPage.test.tsx`

**Interfaces:**

- Consumes: category-domain functions from Task 1 and `AppRepository`.
- Produces: `<CategorySettings repository={repository} />` that loads once, keeps a draft, and saves one Snapshot.

- [x] **Step 1: Write failing settings UI tests**

```tsx
it("adds categories in the data card before backup and saves once", async () => {
  const repository = memory();
  render(<SettingsPage repository={repository} />);
  await user.click(screen.getByText("データ", { selector: "summary" }));
  expect(screen.getByText(/この端末だけに追加できます/)).toBeTruthy();
  expect(
    screen
      .getByText("カテゴリ")
      .compareDocumentPosition(screen.getByText(/バックアップには/)),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  await user.type(screen.getByLabelText("カテゴリ名"), "冷蔵庫{Enter}");
  await user.click(screen.getByRole("button", { name: "カテゴリを保存" }));
  expect(repository.save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent(
    "カテゴリを保存しました",
  );
});

it("shows 10/10, disables add, and re-enables it for a pending removal", async () => {
  expect(await screen.findByText("10 / 10件")).toBeTruthy();
  expect(screen.getByLabelText("カテゴリ名")).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "分類0を削除予定にする" }),
  );
  expect(screen.getByText("9 / 10件")).toBeTruthy();
  expect(screen.getByLabelText("カテゴリ名")).toBeEnabled();
});
```

Also test removal usage copy, undo, unchanged-save disabling, invalid input, and repository rejection preserving the draft.

- [x] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @atoqueue/web test -- CategorySettings.test.tsx SettingsPage.test.tsx`

Expected: FAIL because `CategorySettings` is absent.

- [x] **Step 3: Implement the editor and existing-tone CSS**

Keep `saved`, `draft`, `pendingRemoval`, `input`, `status`, and `busy` as explicit component state. Derive the active draft count as `draft.length - pendingRemoval.size`; use `taskCategoryUsage()` for the removal message. Render preset tags without buttons and custom tags with accessible remove/undo buttons.

- [x] **Step 4: Run Web settings tests to verify GREEN**

Run: `pnpm --filter @atoqueue/web test -- CategorySettings.test.tsx SettingsPage.test.tsx`

Expected: PASS.

- [x] **Step 5: Commit Task 2**

```bash
git add apps/web/src/features/settings
git commit -m "feat: add custom category settings editor"
```

---

### Task 3: Task Candidate, Detail, and List Integration

**Files:**

- Create: `apps/web/src/presentation/task-category-options.ts`
- Create: `apps/web/src/presentation/task-category-options.test.ts`
- Modify: `packages/domain/src/candidate.ts`
- Modify: `packages/domain/src/candidate.test.ts`
- Modify: `apps/web/src/features/inbox/TaskCandidatePage.tsx`
- Modify: `apps/web/src/features/inbox/TaskCandidatePage.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPage.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPage.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskListPage.tsx`
- Modify: `apps/web/src/features/tasks/TaskListPage.test.tsx`

**Interfaces:**

- Consumes: `generateTaskCandidate(body, customCategories)`, `PRESET_TASK_CATEGORIES`, `pastTaskCategories()`.
- Produces: `taskCategoryOptions(snapshot, currentCategory?) => Array<{ value: string; label: string }>`.

- [x] **Step 1: Write failing integration tests**

```ts
it("prefers an exact custom category over the preset heuristic", () => {
  expect(
    generateTaskCandidate("仕事用の冷蔵庫を買う", ["冷蔵庫"]).category,
  ).toBe("冷蔵庫");
});
```

```tsx
it("offers active custom categories but preserves the current removed category", async () => {
  expect(await screen.findByRole("option", { name: "経費" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "冷蔵庫（過去）" })).toBeTruthy();
});
```

Add list-filter coverage that a removed category filters completed and archived tasks as well as active tasks.

- [x] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @atoqueue/domain test -- candidate.test.ts && pnpm --filter @atoqueue/web test -- TaskCandidatePage.test.tsx TaskDetailPage.test.tsx TaskListPage.test.tsx task-category-options.test.ts`

Expected: FAIL because custom category arguments/options are not implemented.

- [x] **Step 3: Implement shared options and screen wiring**

Load `snapshot.settings.customTaskCategories` with each screen Snapshot. Pass them to candidate generation. Replace duplicated fixed `<option>` elements with `taskCategoryOptions()`. Preserve an editing Task's removed category and derive list-only past categories from all tasks.

- [x] **Step 4: Run focused tests to verify GREEN**

Run: `pnpm --filter @atoqueue/domain test -- candidate.test.ts && pnpm --filter @atoqueue/web test -- TaskCandidatePage.test.tsx TaskDetailPage.test.tsx TaskListPage.test.tsx task-category-options.test.ts`

Expected: PASS.

- [x] **Step 5: Commit Task 3**

```bash
git add packages/domain/src/candidate.ts packages/domain/src/candidate.test.ts apps/web/src/features/inbox apps/web/src/features/tasks apps/web/src/presentation
git commit -m "feat: use custom categories across task screens"
```

---

### Task 4: Today Review Refresh and Next-Task Navigation

**Files:**

- Modify: `packages/domain/src/review-session.ts`
- Modify: `packages/domain/src/review-session.test.ts`
- Modify: `packages/domain/src/task-actions.ts`
- Modify: `packages/domain/src/task-actions.test.ts`
- Modify: `apps/web/src/features/review/TodayReviewPage.tsx`
- Modify: `apps/web/src/features/review/TodayReviewPage.test.tsx`
- Modify: `apps/web/src/features/review/TodayReviewPage.css`

**Interfaces:**

- Produces: `refreshReviewSession(session, tasks, now, calendar): ReviewSession` that appends newly eligible task IDs without reordering existing entries.
- Produces: `goToNextTask(session, tasks, now): ReviewSession` and circular unanswered selection after an answer.

- [x] **Step 1: Write failing regression tests**

```ts
it("adds a newly created today task to an unfinished one-task session", () => {
  const refreshed = refreshReviewSession(
    sessionWith(["first"]),
    [first, createdToday],
    now,
    calendar,
  );
  expect(refreshed.orderedTaskIds).toEqual(["first", "created-today"]);
});

it("cycles to skipped unanswered work before completing the session", () => {
  const skipped = goToNextTask(
    sessionWith(["first", "second"]),
    [first, second],
    now,
  );
  const answered = answerReview({
    snapshot: withSession(skipped),
    sessionId: skipped.id,
    answer: "complete",
    now,
    calendar,
  });
  expect(answered.reviewSessions[0]).toMatchObject({
    currentIndex: 0,
    completedAt: undefined,
  });
});
```

```tsx
it("refreshes a stale one-task session and shows the next-task action", async () => {
  render(
    <TodayReviewPage
      repository={repositoryWithStaleSession()}
      now={() => now}
      calendar={calendar}
    />,
  );
  expect(await screen.findByText("1 / 2")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "次のタスク" }));
  expect(await screen.findByText("新しく今日にしたタスク")).toBeTruthy();
});
```

- [x] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @atoqueue/domain test -- review-session.test.ts task-actions.test.ts && pnpm --filter @atoqueue/web test -- TodayReviewPage.test.tsx`

Expected: FAIL because session refresh, next navigation, and button do not exist.

- [x] **Step 3: Implement refresh and safe circular navigation**

Refresh an unfinished session at load by appending IDs returned by a fresh `startReviewSession()` that are absent from `orderedTaskIds`. `次のタスク` changes only `currentIndex`; answering chooses the next active unanswered ID after the current index and wraps to the beginning before completing. Keep `前のタスク` and the existing action buttons unchanged.

- [x] **Step 4: Run regression tests to verify GREEN**

Run: `pnpm --filter @atoqueue/domain test -- review-session.test.ts task-actions.test.ts && pnpm --filter @atoqueue/web test -- TodayReviewPage.test.tsx`

Expected: PASS.

- [x] **Step 5: Commit Task 4**

```bash
git add packages/domain/src/review-session.ts packages/domain/src/review-session.test.ts packages/domain/src/task-actions.ts packages/domain/src/task-actions.test.ts apps/web/src/features/review
git commit -m "fix: refresh and navigate today's review tasks"
```

---

### Task 5: Backup Replacement Copy and Full Reminder Rebuild

**Files:**

- Modify: `packages/domain/src/backup.ts`
- Modify: `packages/domain/src/backup.test.ts`
- Modify: `apps/web/src/features/settings/BackupSettings.tsx`
- Modify: `apps/web/src/features/settings/BackupSettings.test.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.test.tsx`

**Interfaces:**

- Consumes: `rebuildGlobalNotificationSchedules()` and `queueTaskNotifications()`.
- Produces: restored Snapshot with cancellations plus active-task, inbox, and memo schedules; UI copy explaining replacement and cross-device copy.

- [x] **Step 1: Write failing backup tests**

```ts
it("rebuilds task, inbox, and memo reminder scopes after restore", async () => {
  const restored = await restoreBackup({ current, serialized, now, idFactory });
  expect(restored.reminderMap.some((entry) => entry.taskId)).toBe(true);
  expect(restored.reminderMap.some((entry) => entry.scope === "inbox")).toBe(
    true,
  );
  expect(restored.reminderMap.some((entry) => entry.scope === "memo")).toBe(
    true,
  );
});
```

```tsx
expect(screen.getByText(/現在のデータへの追加ではありません/)).toBeTruthy();
expect(screen.getByText(/別端末への復元はデータのコピーです/)).toBeTruthy();
```

Also restore the same file twice and assert entity counts do not grow.

- [x] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @atoqueue/domain test -- backup.test.ts && pnpm --filter @atoqueue/web test -- BackupSettings.test.tsx SettingsPage.test.tsx`

Expected: memo reminder assertion and new copy assertions FAIL.

- [x] **Step 3: Implement full reminder rebuild and display copy**

After cancelling old mappings and queueing active Task notifications, call `rebuildGlobalNotificationSchedules()` once on the restored Snapshot so inbox and memo scopes are both derived from the oldest current Capture. Keep one repository save and one injected flush call in `BackupSettings`.

- [x] **Step 4: Run backup tests to verify GREEN**

Run: `pnpm --filter @atoqueue/domain test -- backup.test.ts && pnpm --filter @atoqueue/web test -- BackupSettings.test.tsx SettingsPage.test.tsx`

Expected: PASS.

- [x] **Step 5: Commit Task 5**

```bash
git add packages/domain/src/backup.ts packages/domain/src/backup.test.ts apps/web/src/features/settings/BackupSettings.tsx apps/web/src/features/settings/BackupSettings.test.tsx apps/web/src/features/settings/SettingsPage.test.tsx
git commit -m "fix: clarify restore replacement and rebuild reminders"
```

---

### Task 6: Version, Documentation, and Browser Acceptance

**Files:**

- Modify: `apps/web/src/app-version.ts`
- Modify: `apps/web/src/features/settings/SettingsPage.test.tsx`
- Modify: workspace `package.json` files that expose `1.4.0`
- Create: `apps/web/e2e/custom-task-categories.spec.ts`
- Modify: `apps/web/e2e/backup-restore.spec.ts`
- Modify: `docs/requirements.md`
- Modify: `docs/data-model.md`
- Modify: `docs/screens.md`
- Modify: `docs/tasks.md`
- Modify: `docs/superpowers/plans/2026-08-03-atoqueue-mvp.md`
- Modify: this plan with verification results

**Interfaces:**

- Consumes: completed Tasks 1–5.
- Produces: release-ready `mvp-1.5.0` documentation and acceptance coverage.

- [x] **Step 1: Add failing E2E and version assertions**

The custom category E2E opens Settings > Data, adds `冷蔵庫`, saves, creates `冷蔵庫の豆腐`, confirms the suggestion without auto-submission, removes the category, and verifies the Task retains `冷蔵庫（過去）`. The backup E2E restores into a clean context and verifies the warning copy and exact entity counts after a second restore.

- [x] **Step 2: Run targeted E2E to establish current failure**

Run: `pnpm --filter @atoqueue/web run test:e2e e2e/custom-task-categories.spec.ts e2e/backup-restore.spec.ts --workers=1`

Expected: FAIL before final version/docs wiring, or report Chromium `spawn EPERM` separately if the sandbox cannot launch it.

- [x] **Step 3: Update version and documents**

Set app display version to `mvp-1.5.0`. Document:

- `F-005/F-006/F-008/F-018`: fixed presets plus up to 10 device-local custom categories.
- `F-017`: restore replaces rather than merges, cross-device restore copies, destination notification identity remains.
- data model: schema 8 and deleted-category retention on Task.
- screens: Data card category editor, 10/10 state, pending removal, usage breakdown, old-category options.
- tasks and MVP plan: exact completed tests and deployment state.

- [x] **Step 4: Run full quality gates**

Run:

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @atoqueue/web run test:e2e e2e/custom-task-categories.spec.ts e2e/backup-restore.spec.ts --workers=1
git diff --check
```

Expected: all static/unit/type/build gates PASS; targeted E2E PASS on a launch-capable environment.

- [x] **Step 5: Commit release changes**

```bash
git add apps/web packages/domain docs package.json pnpm-lock.yaml
git commit -m "chore: release custom categories as mvp 1.5.0"
```

**実装結果（2026-08-10）:** schema 8、端末固有カテゴリ、候補・詳細・一覧の共通選択肢、削除後の過去カテゴリ保持、当日ReviewSessionの対象追加、バックアップ洗い替えと全通知系列再構築をTDDで実装した。Lint、単体・結合テスト58ファイル477件、型検査、本番ビルドは成功した。対象Playwright E2E 4件はCodex環境のChromium起動が `spawn EPERM` となり、アサーション実行前に停止したため、GitHub Actionsと実機で確認する。

---

### Task 7: Push and Deploy mvp-1.5.0

**Files:**

- Verify: `.github/workflows/deploy.yml`
- Verify: `docs/operations/deployment.md`

**Interfaces:**

- Consumes: clean, fully verified branch at `mvp-1.5.0`.
- Produces: pushed branch, successful GitHub Actions deployment, public PWA/API verification.

- [x] **Step 1: Verify clean release commit and branch**

Run: `git status --short && git log -5 --oneline`

Expected: only user-owned unrelated untracked files remain; all release files are committed.

- [x] **Step 2: Push the current branch**

Run: `git push origin task/atoqueue-mvp`

Expected: remote branch advances to the release commit.

- [x] **Step 3: Trigger the deployment workflow for the pushed commit**

Run: `gh workflow run deploy.yml --ref task/atoqueue-mvp -f ref=task/atoqueue-mvp`

Expected: workflow is queued for the current branch. If the workflow input is named differently, inspect `gh workflow view deploy.yml --yaml` and pass its exact input name.

- [x] **Step 4: Watch deployment to completion**

Run: `gh run watch --exit-status`

Expected: Test and build, OCI notification API deployment, and GitHub Pages publication all succeed.

- [x] **Step 5: Verify public release**

Run:

```powershell
(Invoke-WebRequest -Uri "https://atoqueue.sikumilab.com" -UseBasicParsing).StatusCode
(Invoke-RestMethod -Uri "https://api.atoqueue.sikumilab.com/healthz").status
```

Expected: PWA HTTP 200 and API `status: ok`. Open Settings > App Information and verify `mvp-1.5.0` after the Pages cache updates.

**配置結果（2026-08-10）:** release commit `db809a3` をpushし、GitHub Actions Deploy #77（run `31342182972`）を手動実行した。Test and build、GitHub Pages、OCI notification APIの3ジョブはすべて成功した。本番API `/healthz` はHTTP 200で `version: mvp-1.5.0` を返し、公開PWAの配信JavaScriptにも `mvp-1.5.0` が含まれることを確認した。
