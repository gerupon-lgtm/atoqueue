# Inbox Three Tabs and Layout Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 受信箱を未整理・メモ・不要の3タブへ整理し、不要記録の安全な一括操作、Task側のアーカイブ表記、共通ページ余白、PC左ナビの操作性を `mvp-1.4.0` として提供する。

**Architecture:** Captureの分類経路判定と一括更新は純粋なドメイン関数へ置き、React画面は選択状態・確認・保存・通知同期だけを担当する。既存のAppRepositoryと通知Outbox境界を維持し、UIからlocalStorageや通知HTTP APIを直接呼ばない。

**Tech Stack:** TypeScript、React 19.2、Vitest、React Testing Library、Playwright、pnpm workspace

## 実施結果（2026-08-10）

- Task 1〜5をTDDで実装し、受信箱3タブ、不要記録の個別・一括操作、Task側のアーカイブ表記、共通余白、PC左ナビ、`mvp-1.4.0` の版管理を反映した。
- 単体・結合テストは56ファイル452件、対象E2Eは16件すべて成功した。
- lint、型検査、本番ビルド、`git diff --check` はすべて成功した。
- 通知APIのprivate-data契約と `schemaVersion` は変更していない。
- バックアップ復元時の通知予約表示改善は、今回へ混在させず別対応候補として設計書へ記録した。

## Global Constraints

- `不要` はCaptureを復元可能な不要タブへ移す操作だけに用い、Taskを保管する操作は `アーカイブ` と表示する。
- タスク化済みCaptureは受信箱の一覧・件数へ表示しないが、端末内データとTaskへの参照は保持する。
- 通知サーバーへ本文、分類、経路バッジ、選択件数を送らない。
- 一括復元・一括完全削除は全対象を事前検証し、1回の保存と1回の通知同期で完了する。
- ページタイトルの位置・文字サイズを変えず、タイトルまたはヘッダ行から最初の要素までを `0.75rem` に統一する。
- `768px` 未満のフローティングフッターは寸法・配置を維持する。
- バージョンは `mvp-1.4.0`、workspace package versionは `1.4.0` とする。
- schemaVersionと通知APIのprivate-data契約は変更しない。
- 既存の未追跡ファイルと本計画対象外の変更をステージ・削除しない。

---

### Task 1: 不要記録の経路判定と一括ドメイン操作

**Files:**
- Modify: `packages/domain/src/classification.ts`
- Modify: `packages/domain/src/classification.test.ts`
- Modify: `packages/domain/src/capture-query.ts`
- Modify: `packages/domain/src/capture-query.test.ts`
- Verify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `AppSnapshot`、`Capture`、`rebuildGlobalNotificationSchedules()`、既存の `capture_classified` 履歴。
- Produces: `CaptureHistoryTab = "unclassified" | "note" | "unneeded"`、`UnneededCaptureSource = "unclassified" | "note"`、`getUnneededCaptureSource(snapshot, captureId)`、`restoreUnneededCaptures(input)`、`deleteUnneededCaptures(input)`。

- [ ] **Step 1: タスク化済みCaptureを除外するクエリの失敗テストを書く**

```ts
it("F-004 exposes only the three non-task inbox tabs", () => {
  expect(listCaptures(captures, "unclassified").map(({ id }) => id)).toEqual(["new-unclassified"]);
  expect(listCaptures(captures, "note").map(({ id }) => id)).toEqual(["note"]);
  expect(listCaptures(captures, "unneeded").map(({ id }) => id)).toEqual(["unneeded"]);
});
```

- [ ] **Step 2: クエリテストをRED確認する**

Run: `pnpm --filter @atoqueue/domain test -- capture-query.test.ts`

Expected: `"all"` 前提または新しい3タブ契約の不足でFAIL。

- [ ] **Step 3: 受信箱タブ型を3分類へ限定する**

```ts
export type CaptureHistoryTab = Exclude<Capture["classification"], "task">;
```

- [ ] **Step 4: 直近の分類サイクルから経路バッジを判定する失敗テストを書く**

```ts
expect(getUnneededCaptureSource(noteThenUnneeded, "capture-note")).toBe("note");
expect(getUnneededCaptureSource(directlyUnneeded, "capture-direct")).toBe("unclassified");
expect(getUnneededCaptureSource(restoredThenDirect, "capture-restored")).toBe("unclassified");
```

- [ ] **Step 5: 経路判定テストをRED確認する**

Run: `pnpm --filter @atoqueue/domain test -- classification.test.ts`

Expected: `getUnneededCaptureSource` が未定義でFAIL。

- [ ] **Step 6: 経路判定を最小実装する**

`capture_classified` を新しい順に調べ、最新の `unneeded` より前にある同一Captureの分類が `note` なら `note`、`unclassified` または該当なしなら `unclassified` を返す。Captureが存在しない、または現在 `unneeded` でない場合は既存と同じエラー境界を使う。

- [ ] **Step 7: 一括復元・一括削除の失敗テストを書く**

```ts
it("F-006 restores every selected unneeded capture atomically and rebuilds notification series once", () => {
  const next = restoreUnneededCaptures({ snapshot, captureIds: ["a", "b"], now });
  expect(next.captures.filter(({ classification }) => classification === "unclassified")).toHaveLength(2);
  expect(next.actionHistory).toEqual(expect.arrayContaining([
    expect.objectContaining({ entityId: "a", action: "capture_classified" }),
    expect.objectContaining({ entityId: "b", action: "capture_classified" }),
  ]));
});

it("F-006 deletes only selected unneeded captures and their capture history", () => {
  const next = deleteUnneededCaptures({ snapshot, captureIds: ["a", "b"], now });
  expect(next.captures.map(({ id }) => id)).not.toEqual(expect.arrayContaining(["a", "b"]));
  expect(next.actionHistory.some(({ entityId }) => entityId === "kept")).toBe(true);
});
```

各テストに、対象の1件が `unneeded` でなければ例外となり入力snapshotが変化しないケースを加える。

- [ ] **Step 8: 一括操作テストをRED確認する**

Run: `pnpm --filter @atoqueue/domain test -- classification.test.ts`

Expected: 一括関数未定義でFAIL。

- [ ] **Step 9: 全件事前検証してから一度だけ再構築する一括関数を実装する**

```ts
export interface ClassifyCapturesInput {
  snapshot: AppSnapshot;
  captureIds: readonly string[];
  now: string;
}
```

IDの重複と空配列を拒否し、全Captureが存在して `unneeded` であることを先に確認する。その後、全Capture更新または削除を行ったsnapshotに対して `rebuildGlobalNotificationSchedules()` を1回呼ぶ。既存の単一復元・削除関数は一括関数へ委譲する。

- [ ] **Step 10: Domain全テストと型検査をGREEN確認する**

Run: `pnpm --filter @atoqueue/domain test`

Run: `pnpm --filter @atoqueue/domain typecheck`

Expected: 全件PASS。

- [ ] **Step 11: Task 1をコミットする**

```powershell
git add -- packages/domain/src/classification.ts packages/domain/src/classification.test.ts packages/domain/src/capture-query.ts packages/domain/src/capture-query.test.ts
git commit -m "feat: add atomic unneeded capture operations"
```

---

### Task 2: 受信箱3タブ・件数ピル・不要記録の選択操作

**Files:**
- Modify: `apps/web/src/features/inbox/InboxPage.tsx`
- Modify: `apps/web/src/features/inbox/InboxPage.css`
- Modify: `apps/web/src/features/inbox/InboxPage.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Create: `apps/web/e2e/inbox-cleanup.spec.ts`

**Interfaces:**
- Consumes: Task 1の `CaptureHistoryTab`、`getUnneededCaptureSource()`、`restoreUnneededCaptures()`、`deleteUnneededCaptures()`。
- Produces: `未整理 / メモ / 不要` の3タブ、独立した `○件` ピル、不要タブの通常表示と選択モード、1保存・1同期の一括操作。

- [ ] **Step 1: 3タブ・件数・タスク非表示の失敗テストを書く**

```tsx
expect(screen.queryByRole("tab", { name: "すべて" })).toBeNull();
expect(screen.getByRole("tab", { name: /未整理.*2件/ })).toBeTruthy();
expect(screen.getByRole("tab", { name: /メモ.*1件/ })).toBeTruthy();
expect(screen.getByRole("tab", { name: /不要.*2件/ })).toBeTruthy();
expect(screen.queryByText("タスク化済みの記録")).toBeNull();
```

- [ ] **Step 2: 受信箱テストをRED確認する**

Run: `pnpm --filter @atoqueue/web test -- InboxPage.test.tsx`

Expected: `すべて` が残り、件数ピルがないためFAIL。

- [ ] **Step 3: 3タブと件数ピルを実装する**

各タブはボタン内でラベルと `<span className="inbox-tabs__count">○件</span>` を分離する。件数は全Captureから分類別に再計算し、task分類を含めない。タブは3列同幅とし、件数ピルは淡い中性色、選択中は白系半透明とする。

- [ ] **Step 4: 経路バッジと通常操作の失敗テストを書く**

```tsx
expect(await screen.findByText("未整理から")).toBeTruthy();
expect(screen.getByText("メモから")).toBeTruthy();
expect(screen.queryByRole("checkbox")).toBeNull();
expect(screen.getByRole("button", { name: "未整理に戻す" })).toBeTruthy();
expect(screen.getByRole("button", { name: "完全削除" })).toBeTruthy();
```

- [ ] **Step 5: 経路バッジを実装してGREEN確認する**

Run: `pnpm --filter @atoqueue/web test -- InboxPage.test.tsx`

Expected: 経路表示テストPASS。

- [ ] **Step 6: 選択・全選択・解除・キャンセルの失敗テストを書く**

`選択` を押すまではcheckboxを出さず、選択モードでは `すべて選択`、`選択解除`、`○件選択中`、同幅の `未整理に戻す` と `完全削除`、`キャンセル` を検証する。選択モード中は個別ボタンを表示しない。

- [ ] **Step 7: 選択モードを実装する**

`Set<string>` で選択IDを保持し、不要タブ以外への移動、キャンセル、一括操作成功時に空へ戻す。選択対象は現在表示中の不要Captureだけとする。

- [ ] **Step 8: 一括確認・保存・同期結果の失敗テストを書く**

```tsx
expect(confirm).toHaveBeenCalledWith("選択した2件を未整理に戻しますか？");
expect(repository.save).toHaveBeenCalledTimes(1);
expect(sync).toHaveBeenCalledTimes(1);
expect(await screen.findByRole("status")).toHaveTextContent("2件を未整理に戻しました。");
```

完全削除は `選択した2件を完全に削除しますか？この操作は元に戻せません。` を確認し、取消時は保存しない。同期失敗時はローカル成功と通知送信待ちを同じ結果欄で区別する。

- [ ] **Step 9: 一括操作を実装してWebテストをGREEN確認する**

Run: `pnpm --filter @atoqueue/web test -- InboxPage.test.tsx`

Run: `pnpm --filter @atoqueue/web typecheck`

Expected: 全件PASS。

- [ ] **Step 10: 受信箱E2Eを追加する**

`inbox-cleanup.spec.ts` で、未整理→不要、メモ→不要のバッジ、複数選択復元、複数選択完全削除の確認取消と確定、タスク化後に受信箱から消えることを利用者操作から検証する。

- [ ] **Step 11: Task 2をコミットする**

```powershell
git add -- apps/web/src/features/inbox/InboxPage.tsx apps/web/src/features/inbox/InboxPage.css apps/web/src/features/inbox/InboxPage.test.tsx apps/web/src/app/router.tsx apps/web/e2e/inbox-cleanup.spec.ts
git commit -m "feat: add three-tab inbox cleanup flow"
```

---

### Task 3: Task側の不要表記をアーカイブへ統一

**Files:**
- Modify: `apps/web/src/features/review/ReviewActionSheet.tsx`
- Modify: `apps/web/src/features/review/TodayReviewPage.test.tsx`
- Modify: `apps/web/src/features/review/ReviewResultPage.tsx`
- Modify: `apps/web/src/features/review/ReviewResultPage.test.tsx`
- Modify: `packages/domain/src/prompts.ts`
- Modify: `packages/domain/src/prompts.test.ts`

**Interfaces:**
- Consumes: 保存値 `ReviewAnswer = "archive"`、Task status `archived`、操作履歴 `task_archived`。
- Produces: 今日の確認、確認結果、放置レベル案内の表示語 `アーカイブ`。保存形式と通知取消動作は変更しない。

- [ ] **Step 1: Task側に不要表記が出ない失敗テストを書く**

```tsx
expect(screen.getByRole("button", { name: "アーカイブ" })).toBeTruthy();
expect(screen.queryByRole("button", { name: "不要" })).toBeNull();
```

確認結果では `アーカイブ: 1件` と状態 `アーカイブ`、レベル4案内では `完了・新しい期限・アーカイブ` を期待する。

- [ ] **Step 2: focused testsをRED確認する**

Run: `pnpm --filter @atoqueue/domain test -- prompts.test.ts`

Run: `pnpm --filter @atoqueue/web test -- TodayReviewPage.test.tsx ReviewResultPage.test.tsx`

Expected: 現行の `不要` 表示によりFAIL。

- [ ] **Step 3: 表示文字列だけをアーカイブへ変更する**

`onAnswer("archive")`、`task_archived`、status `archived` は変更せず、利用者向けラベルと案内文だけを変更する。

- [ ] **Step 4: Task 3のテストと型検査をGREEN確認する**

Run: `pnpm --filter @atoqueue/domain test -- prompts.test.ts`

Run: `pnpm --filter @atoqueue/web test -- TodayReviewPage.test.tsx ReviewResultPage.test.tsx`

Run: `pnpm --filter @atoqueue/web typecheck`

Expected: 全件PASS。

- [ ] **Step 5: Task 3をコミットする**

```powershell
git add -- apps/web/src/features/review/ReviewActionSheet.tsx apps/web/src/features/review/TodayReviewPage.test.tsx apps/web/src/features/review/ReviewResultPage.tsx apps/web/src/features/review/ReviewResultPage.test.tsx packages/domain/src/prompts.ts packages/domain/src/prompts.test.ts
git commit -m "fix: distinguish task archives from unneeded captures"
```

---

### Task 4: 共通ページ開始位置とPC左ナビ

**Files:**
- Modify: `apps/web/src/app/AppShell.css`
- Modify: `apps/web/src/app/AppShell.test.tsx`
- Modify: `apps/web/e2e/pwa-shell.spec.ts`
- Modify only if a page-specific override conflicts: `apps/web/src/features/settings/SettingsPage.css`
- Modify only if a page-specific override conflicts: `apps/web/src/features/review/TodayReviewPage.css`

**Interfaces:**
- Consumes: 既存の `.app-shell__content > section` と `.app-shell__nav-link`。
- Produces: タイトル直下 `0.75rem`、PC行高 `52px`・アイコン `24px`・文字 `16px`・行全体クリック、既存モバイルフッター維持。

- [ ] **Step 1: PCナビとモバイル維持のE2E期待値を追加する**

```ts
await page.setViewportSize({ width: 1024, height: 800 });
const desktopLink = page.getByRole("link", { name: "受信箱" });
expect((await desktopLink.boundingBox())?.height).toBeGreaterThanOrEqual(52);
await expect(desktopLink).toHaveCSS("font-size", "16px");
expect((await desktopLink.locator("svg").boundingBox())?.width).toBeGreaterThanOrEqual(24);
```

モバイルでは既存の高さ80px以下、固定配置、折返しなしを維持する。

- [ ] **Step 2: CSS回帰テストをRED確認する**

Run: `pnpm --filter @atoqueue/web test -- AppShell.test.tsx`

Run when browser is available: `pnpm --filter @atoqueue/web run test:e2e e2e/pwa-shell.spec.ts --workers=1`

Expected: PC行高・文字・アイコンの新基準でFAIL。

- [ ] **Step 3: 共通タイトル直下間隔とPCナビを実装する**

`.app-shell__content > section` のページ直下gapを `0.75rem` にし、カード内部のgapは維持する。`@media (min-width: 768px)` 内だけで左ペイン余白 `0.875rem`、リンク高 `52px`、アイコン `24px`、文字 `16px`、横幅100%を指定し、hover背景とfocus-visible outlineを行全体へ適用する。

- [ ] **Step 4: 主要ページの開始位置を確認するE2Eを追加する**

記録、受信箱、今日、タスク、設定を巡回し、タイトルまたはタイトルを含むヘッダ行と最初のページ要素の差が共通許容範囲内であることを確認する。タイトル文字サイズと上端は変更しない。

- [ ] **Step 5: Task 4のWebテスト・型検査・ビルドをGREEN確認する**

Run: `pnpm --filter @atoqueue/web test`

Run: `pnpm --filter @atoqueue/web typecheck`

Run: `pnpm --filter @atoqueue/web build`

Expected: 全件PASS。

- [ ] **Step 6: Task 4をコミットする**

```powershell
git add -- apps/web/src/app/AppShell.css apps/web/src/app/AppShell.test.tsx apps/web/e2e/pwa-shell.spec.ts apps/web/src/features/settings/SettingsPage.css apps/web/src/features/review/TodayReviewPage.css
git commit -m "style: align page spacing and desktop navigation"
```

---

### Task 5: mvp-1.4.0、設計文書、全体品質ゲート

**Files:**
- Modify: `apps/web/src/app-version.ts`
- Modify: `apps/web/src/features/settings/SettingsPage.test.tsx`
- Modify: `apps/api/src/start.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/api/package.json`
- Modify: `packages/domain/package.json`
- Modify: `packages/contracts/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docs/requirements.md`
- Modify: `基本設計サマリ.md`
- Modify: `docs/data-model.md`
- Modify: `docs/screens.md`
- Modify: `docs/tasks.md`
- Modify: `docs/api-design.md`
- Modify: `docs/superpowers/specs/2026-08-10-inbox-three-tabs-and-layout-consistency-design.md`
- Add: `docs/superpowers/plans/2026-08-10-inbox-three-tabs-and-layout-consistency.md`

**Interfaces:**
- Consumes: Tasks 1-4の完成動作。
- Produces: UI・API health・workspace package・設計文書で一致する `mvp-1.4.0`、実装結果を反映した設計記録。

- [ ] **Step 1: バージョン期待値を先に更新してRED確認する**

`SettingsPage.test.tsx` は `mvp-1.4.0` を期待し、API起動の成果物テストには本番既定バージョン `mvp-1.4.0` を確認する期待値を加える。

Run: `pnpm --filter @atoqueue/web test -- SettingsPage.test.tsx`

Expected: 現行 `mvp-1.3.0` によりFAIL。

- [ ] **Step 2: コードとpackage versionsを1.4.0へ更新する**

`APP_VERSION` とAPI production startは `mvp-1.4.0`、4 workspace packageのversionは `1.4.0` とする。`pnpm install --lockfile-only` でlockfileのworkspace versionを同期する。

- [ ] **Step 3: 設計文書を実装結果へ更新する**

要件・基本設計・画面・データモデル・API設計・タスク文書へ、3タブ、経路バッジ、一括操作、Task側アーカイブ表記、共通余白、PCナビ、通知取消、バージョンを反映する。バックアップ洗い替え表示とメモ通知再構築は別対応候補のまま残す。

- [ ] **Step 4: focused testsを実行する**

Run: `pnpm --filter @atoqueue/domain test -- classification.test.ts capture-query.test.ts prompts.test.ts`

Run: `pnpm --filter @atoqueue/web test -- InboxPage.test.tsx TodayReviewPage.test.tsx ReviewResultPage.test.tsx AppShell.test.tsx SettingsPage.test.tsx`

Expected: 全件PASS。

- [ ] **Step 5: workspace品質ゲートを実行する**

Run: `pnpm lint`

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm build`

Run: `git diff --check`

Expected: 全件PASS。PlaywrightがChromium `spawn EPERM` で起動できない場合は、対象spec名と起動前失敗を記録し、単体・型・buildの成功と区別する。

- [ ] **Step 6: 対象E2Eを実行する**

Run: `pnpm --filter @atoqueue/web run test:e2e e2e/inbox-cleanup.spec.ts e2e/pwa-shell.spec.ts --workers=1`

Expected: 対象テストPASS、または既知の実行環境によるChromium起動前 `spawn EPERM`。

- [ ] **Step 7: 最終差分を対象ファイルだけで確認する**

Run: `git status --short`

Run: `git diff --stat`

既存の未追跡handoff・画像・review reportを含めず、Task 1-5のファイルだけをステージする。

- [ ] **Step 8: Task 5をコミットする**

```powershell
git add -- apps/web/src/app-version.ts apps/web/src/features/settings/SettingsPage.test.tsx apps/api/src/start.ts apps/web/package.json apps/api/package.json packages/domain/package.json packages/contracts/package.json pnpm-lock.yaml docs/requirements.md 基本設計サマリ.md docs/data-model.md docs/screens.md docs/tasks.md docs/api-design.md docs/superpowers/specs/2026-08-10-inbox-three-tabs-and-layout-consistency-design.md docs/superpowers/plans/2026-08-10-inbox-three-tabs-and-layout-consistency.md
git commit -m "docs: release inbox cleanup as mvp 1.4.0"
```
