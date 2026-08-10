# あとキュー（仮称）MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 思いつきを一文で端末内へ退避し、後からタスク化し、放置度合いに応じた「今日の確認」とWeb Pushで確実な処理へ導くPWAのMVPを実装する。

**Architecture:** pnpm monorepo内にReact PWA、純粋なドメインパッケージ、HTTP契約パッケージ、Fastify通知APIを分離する。タスク本文・期限・履歴は `localStorage` にだけ保存し、APIは匿名端末と匿名通知予約だけをOCI VPS上のPostgreSQLへ保存する。通知が不達でも、PWA起動時に同じドメインルールから確認対象を再計算する。

**Tech Stack:** TypeScript, Node.js 24 LTS, pnpm, React 19.2, Vite 8, React Router, vite-plugin-pwa, Fastify 5, PostgreSQL, pg, Zod, web-push, Vitest, React Testing Library, Playwright, ESLint, Prettier, systemd, Caddy, GitHub Actions

---

## Plan conventions

- Working directory: repository root.
- Every task starts with a failing test and ends with a focused commit.
- Requirement IDs are copied into test names or comments when behavior is not obvious.
- Do not send `title`, `body`, `taskId`, `category`, due meaning, or action history to the API.
- All dates saved in UTC ISO 8601; local-day calculations receive an explicit time zone.
- Commands use PowerShell-compatible one-command-per-line form.
- Current directory is not yet a Git repository. Task 1 initializes it before the first commit.

## Task 1: Bootstrap the monorepo and quality gates

**Requirements:** NF-007, NF-008, NF-009, NF-011, NF-013

**Files:**

- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `.env.example`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `vitest.workspace.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/server.ts`
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `.github/workflows/ci.yml`
- Test: `packages/domain/src/smoke.test.ts`
- Test: `apps/api/src/server.test.ts`

**Step 1: Initialize source control**

Run:

```powershell
git init
```

Expected: an empty Git repository is created in this workspace.

**Step 2: Create workspace manifests**

Root `package.json` must expose exactly these entry commands:

```json
{
  "name": "atoqueue",
  "private": true,
  "packageManager": "pnpm@10",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "dev": "pnpm --parallel --filter './apps/*' dev",
    "lint": "eslint .",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest --run --workspace vitest.workspace.ts",
    "test:e2e": "pnpm --filter @atoqueue/web test:e2e",
    "build": "pnpm -r build"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

**Step 3: Install the selected toolchain**

Run each command separately:

```powershell
corepack enable
pnpm install
pnpm add -Dw typescript eslint @eslint/js typescript-eslint prettier vitest @vitest/coverage-v8
pnpm --filter @atoqueue/web add react react-dom react-router-dom zod
pnpm --filter @atoqueue/web add -D vite @vitejs/plugin-react vite-plugin-pwa @types/react @types/react-dom @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @playwright/test
pnpm --filter @atoqueue/api add fastify @fastify/cors @fastify/rate-limit pg zod web-push argon2 pino
pnpm --filter @atoqueue/api add -D @types/pg @types/web-push
```

Expected: the lockfile is created with no peer-dependency errors. If Vite 8 or Node 24 is rejected by a selected dependency, stop and record the incompatibility before changing versions.

**Step 4: Write failing smoke tests**

`packages/domain/src/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DOMAIN_SCHEMA_VERSION } from "./index";

describe("domain package", () => {
  it("starts at the current schema version", () => {
    expect(DOMAIN_SCHEMA_VERSION).toBe(2);
  });
});
```

`apps/api/src/server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "./server";

describe("GET /healthz", () => {
  it("returns the service status", async () => {
    const app = buildApp({ version: "0.1.0" });
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", version: "0.1.0" });
    await app.close();
  });
});
```

**Step 5: Verify the tests fail for missing exports**

Run:

```powershell
pnpm test
```

Expected: FAIL because `DOMAIN_SCHEMA_VERSION` and `buildApp` do not exist.

**Step 6: Implement the minimum package exports and health route**

- Export `DOMAIN_SCHEMA_VERSION = 1 as const`.
- Implement `buildApp({ version })` as a Fastify factory.
- Register `GET /healthz` returning `{ status, version, time }`.
- Keep `listen()` out of the factory; call it only from a separate executable entry later.

**Step 7: Run all quality commands**

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all commands exit 0.

**Step 8: Commit**

```powershell
git add .
git commit -m "chore: bootstrap atoqueue workspace"
```

## Task 2: Define the domain model and local repository

**Requirements:** F-003, F-016, NF-002, NF-006, NF-008

**Files:**

- Create: `packages/domain/src/model.ts`
- Create: `packages/domain/src/errors.ts`
- Create: `packages/domain/src/repository.ts`
- Create: `packages/domain/src/migrations.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/src/repository.test.ts`
- Create: `apps/web/src/infrastructure/local-storage/local-storage-repository.ts`
- Create: `apps/web/src/infrastructure/local-storage/local-storage-repository.test.ts`

**Step 1: Write the failing repository contract tests**

Cover these cases in a shared test factory:

```ts
repositoryContract(
  "localStorage repository",
  () => new LocalStorageRepository(window.localStorage),
);
```

Required assertions:

- missing storage returns `createEmptySnapshot()` with the current `schemaVersion`;
- save then load preserves Unicode task text and action history;
- `save()` writes only `atoqueue:data:v1` once;
- malformed JSON is copied to `atoqueue:corrupt:<timestamp>` and throws `CorruptDataError`;
- newer unknown `schemaVersion` throws `UnsupportedSchemaVersionError` without overwriting data;
- storage quota failure throws `PersistenceError` without clearing the current UI state.

**Step 2: Run the focused test and confirm failure**

```powershell
pnpm --filter @atoqueue/web test -- local-storage-repository.test.ts
```

Expected: FAIL because model and repository files do not exist.

**Step 3: Implement exact model boundaries**

Copy the interfaces from `docs/data-model.md` into `packages/domain/src/model.ts`. Add factory:

```ts
export function createEmptySnapshot(params: {
  appVersion: string;
  localDeviceId: string;
  timeZone: string;
  now: string;
}): AppSnapshot;
```

Add repository port:

```ts
export interface AppRepository {
  load(): Promise<AppSnapshot>;
  save(next: AppSnapshot): Promise<void>;
  loadDraft(): Promise<string>;
  saveDraft(value: string): Promise<void>;
  clearDraft(): Promise<void>;
}
```

**Step 4: Implement validation and migration**

- Parse JSON to `unknown`.
- Validate the root and all entity arrays before casting.
- Implement `migrateSnapshot(input: unknown): AppSnapshot`.
- 初期実装ではv1だけを受理した。実装済みのv2ではv1をv2へ移行して受理し、v2を検証する。v3以降の未知版は拒否する。
- Generate corrupt backup keys with the injected clock, not `Date.now()` inside tests.

**Step 5: Re-run the focused and package tests**

```powershell
pnpm --filter @atoqueue/web test -- local-storage-repository.test.ts
pnpm --filter @atoqueue/domain test
pnpm typecheck
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add packages/domain apps/web/src/infrastructure/local-storage
git commit -m "feat: add versioned local data repository"
```

## Task 3: Build the installable offline PWA shell

**Requirements:** F-001, F-003, NF-002, NF-011, NF-012

**Files:**

- Modify: `apps/web/vite.config.ts`
- Create: `apps/web/public/icons/icon-192.png`
- Create: `apps/web/public/icons/icon-512.png`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/app/AppShell.tsx`
- Create: `apps/web/src/app/AppShell.css`
- Create: `apps/web/src/app/AppShell.test.tsx`
- Create: `apps/web/e2e/pwa-shell.spec.ts`
- Modify: `apps/web/src/main.tsx`

**Step 1: Write failing UI and E2E tests**

Component assertions:

- navigation labels are `記録`, `受信箱`, `今日`, `タスク`, `設定`;
- current route has `aria-current="page"`;
- keyboard focus is visible and tab order follows visual order.

Playwright assertions:

- `/`, `/inbox`, `/today`, `/tasks`, `/settings` return the app shell;
- after one online visit, `/` loads with browser context offline;
- manifest contains name, icons, `display: standalone`, `start_url: /`.

**Step 2: Confirm failure**

```powershell
pnpm --filter @atoqueue/web test -- AppShell.test.tsx
pnpm --filter @atoqueue/web test:e2e -- pwa-shell.spec.ts
```

Expected: FAIL because routing and PWA registration are absent.

**Step 3: Configure the PWA**

Use `VitePWA` with:

```ts
{
  registerType: "prompt",
  manifest: {
    name: "あとキュー",
    short_name: "あとキュー",
    lang: "ja",
    start_url: "/",
    display: "standalone",
    theme_color: "#173B33",
    background_color: "#F7F5EE"
  },
  workbox: {
    navigateFallback: "/index.html"
  }
}
```

Do not show an update prompt until the new worker is ready. Never clear local data during an update.

**Step 4: Implement responsive navigation**

- bottom navigation below 768px;
- left rail at 768px and above;
- minimum target 44px;
- retain labels with icons; do not use icon-only primary navigation.

**Step 5: Verify**

```powershell
pnpm --filter @atoqueue/web test -- AppShell.test.tsx
pnpm --filter @atoqueue/web build
pnpm --filter @atoqueue/web test:e2e -- pwa-shell.spec.ts
```

Expected: PASS and the production build contains a manifest and Service Worker.

**Step 6: Commit**

```powershell
git add apps/web
git commit -m "feat: add installable offline pwa shell"
```

## Task 4: Implement quick capture with draft safety

**Requirements:** F-002, F-003, NF-001, NF-002, NF-006, NF-012

**Files:**

- Create: `packages/domain/src/capture.ts`
- Create: `packages/domain/src/capture.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/web/src/features/capture/QuickCapturePage.tsx`
- Create: `apps/web/src/features/capture/QuickCapturePage.css`
- Create: `apps/web/src/features/capture/QuickCapturePage.test.tsx`
- Create: `apps/web/e2e/quick-capture.spec.ts`
- Modify: `apps/web/src/app/router.tsx`

**Step 1: Write the failing domain tests**

```ts
it("F-002 saves a trimmed unclassified capture", () => {
  const next = createCapture(snapshot, "  猫の餌を買う  ", now, "capture-1");
  expect(next.captures.at(-1)).toMatchObject({
    body: "猫の餌を買う",
    classification: "unclassified",
  });
  expect(next.actionHistory.at(-1)?.action).toBe("capture_created");
});
```

Also assert empty, whitespace-only, and 281-character input fail without mutating the snapshot.

**Step 2: Write the failing component tests**

- only one text field and the `保存して戻る` button appear;
- deadline/category controls do not appear;
- the save button is disabled for empty input;
- input calls `saveDraft` after 300ms;
- successful save clears draft and announces the exact success message;
- repository failure retains the typed value and shows the exact recovery message;
- `Ctrl+Enter` and `Meta+Enter` save.

**Step 3: Confirm failure**

```powershell
pnpm --filter @atoqueue/domain test -- capture.test.ts
pnpm --filter @atoqueue/web test -- QuickCapturePage.test.tsx
```

Expected: FAIL because capture behavior is absent.

**Step 4: Implement the pure command and page**

```ts
export function createCapture(
  snapshot: AppSnapshot,
  rawBody: string,
  now: string,
  id: string,
): AppSnapshot;
```

Return a new snapshot; do not mutate arrays in place. Generate IDs outside the function and pass them in for deterministic tests.

**Step 5: Verify behavior and the 10-second path**

```powershell
pnpm --filter @atoqueue/domain test -- capture.test.ts
pnpm --filter @atoqueue/web test -- QuickCapturePage.test.tsx
pnpm --filter @atoqueue/web test:e2e -- quick-capture.spec.ts
```

Expected: PASS. The E2E test reloads after saving and sees the capture in the local snapshot.

**Step 6: Commit**

```powershell
git add packages/domain apps/web/src/features/capture apps/web/e2e/quick-capture.spec.ts
git commit -m "feat: add safe one-sentence capture"
```

## Task 5: Implement inbox classification and task confirmation（完了: 2026-08-03）

**Requirements:** F-004, F-005, F-006, F-007, NF-001, NF-006

**Files:**

- Create: `packages/domain/src/classification.ts`
- Create: `packages/domain/src/classification.test.ts`
- Create: `packages/domain/src/due-date.ts`
- Create: `packages/domain/src/due-date.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/web/src/features/inbox/InboxPage.tsx`
- Create: `apps/web/src/features/inbox/InboxPage.test.tsx`
- Create: `apps/web/src/features/inbox/TaskCandidatePage.tsx`
- Create: `apps/web/src/features/inbox/TaskCandidatePage.test.tsx`
- Create: `apps/web/e2e/inbox-classification.spec.ts`
- Modify: `apps/web/src/app/router.tsx`

**Step 1: Write failing domain tests**

Required cases:

- a rule can suggest `task` but does not alter `classification`;
- `confirmTask()` creates exactly one task and links the capture;
- a second confirmation of the same capture throws `AlreadyClassifiedError`;
- `markAsNote()` and `markAsUnneeded()` append history;
- due choices resolve to today 23:59, tomorrow 23:59, Sunday 23:59, custom date 23:59, `none`, and `unset`;
- `unset` schedules `nextReviewAt` three days later;
- local DST/time-zone boundaries are evaluated through an injected calendar service.

**Step 2: Write failing UI tests**

Assert inbox order is newest first and action labels are exactly `タスクかも`, `メモ`, `不要`. Assert the candidate page does not create a task until `タスクにする` is pressed.

**Step 3: Confirm failure**

```powershell
pnpm --filter @atoqueue/domain test -- classification.test.ts due-date.test.ts
pnpm --filter @atoqueue/web test -- InboxPage.test.tsx TaskCandidatePage.test.tsx
```

Expected: FAIL.

**Step 4: Implement pure classification commands**

Required signatures:

```ts
export function suggestClassification(body: string): "task" | "unknown";
export function confirmTask(input: ConfirmTaskInput): AppSnapshot;
export function markAsNote(input: ClassifyCaptureInput): AppSnapshot;
export function markAsUnneeded(input: ClassifyCaptureInput): AppSnapshot;
export function resolveDueChoice(input: ResolveDueChoiceInput): DueResolution;
```

Use a small transparent keyword/ending rule for the suggestion label. Never call an AI service.

**Step 5: Implement pages and verify**

```powershell
pnpm --filter @atoqueue/domain test -- classification.test.ts due-date.test.ts
pnpm --filter @atoqueue/web test -- InboxPage.test.tsx TaskCandidatePage.test.tsx
pnpm --filter @atoqueue/web test:e2e -- inbox-classification.spec.ts
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add packages/domain apps/web/src/features/inbox apps/web/e2e/inbox-classification.spec.ts
git commit -m "feat: add user-confirmed inbox classification"
```

**実装結果（2026-08-03）:** 候補表示はローカルの透明な規則に限定し、タイトル・期限・カテゴリの初期候補を編集可能な形で提示する。候補表示時にはキャプチャ状態を変えず、`タスクにする` の明示操作だけがタスクとリンクを生成する。本文編集と分類操作は直列化し、期限なしは次の日曜18:00（同時刻以降なら翌週）の週次見直しへ回す。ドメイン29件、Web37件、型検査、両パッケージのビルド、単一E2Eが成功した。

## Task 6: Implement reminder policy and neglect levels（完了: 2026-08-03）

**Requirements:** F-008, F-009, F-010, F-011, NF-003, NF-006

**Files:**

- Create: `packages/domain/src/reminder-policy.ts`
- Create: `packages/domain/src/reminder-policy.test.ts`
- Create: `packages/domain/src/prompts.ts`
- Create: `packages/domain/src/prompts.test.ts`
- Modify: `packages/domain/src/index.ts`

**Step 1: Write the full failing table-driven test**

Include this matrix:

| Given                        | Expected          |
| ---------------------------- | ----------------- |
| unset due, undecided count 0 | now + 3 days      |
| unset due, undecided count 1 | now + 3 days      |
| unset due, undecided count 2 | next Sunday 18:00 |
| dismissed count 0            | now + 1 day       |
| dismissed count 1            | now + 3 days      |
| dismissed count 2            | now + 7 days      |
| dismissed count 3            | now + 7 days      |

Add neglect-level boundary assertions for exactly 24 hours, overdue 1 day, overdue 7 days, dismiss counts 1/2/4, and repeated unset-due prompts.

**Step 2: Confirm failure**

```powershell
pnpm --filter @atoqueue/domain test -- reminder-policy.test.ts prompts.test.ts
```

Expected: FAIL because policy functions are missing.

**Step 3: Implement pure functions**

```ts
export function calculateNextReview(input: NextReviewInput): string;
export function calculateNeglectLevel(input: NeglectInput): 0 | 1 | 2 | 3 | 4;
export function choosePrompt(level: 0 | 1 | 2 | 3 | 4): PromptCopy;
```

`PromptCopy` must contain the exact Japanese messages from `docs/screens.md`. Keep copy outside React components so tone changes do not change the state machine.

**要件優先の差分（2026-08-03）:** F-011に合わせて放置レベルは0〜4とする。F-012に合わせて「今回は閉じる」は1日後、3日後、7日後、以後は7日ごとに再提示する。旧来の4段階・4回目以降を週次にする記述は採用しない。

**Step 4: Run tests and inspect boundary coverage**

```powershell
pnpm --filter @atoqueue/domain test -- reminder-policy.test.ts prompts.test.ts --coverage
```

Expected: PASS with 100% branch coverage for `reminder-policy.ts`.

**Step 5: Commit**

```powershell
git add packages/domain/src/reminder-policy.ts packages/domain/src/reminder-policy.test.ts packages/domain/src/prompts.ts packages/domain/src/prompts.test.ts packages/domain/src/index.ts
git commit -m "feat: add escalating reminder policy"
```

**実装結果（2026-08-03）:** 要件優先の5段階（0〜4）で放置レベルを導出し、期限未設定は3日後・3回目以降は次の日曜18:00、見送りは1日後・3日後・7日後・以後7日ごとにした。`test:coverage`で`reminder-policy.ts`の分岐100%を強制し、ドメイン59件、型検査、ビルドが成功した。

## Task 7: Implement the review-session state machine（完了: 2026-08-03）

**Requirements:** F-012, F-014, F-015, F-016, NF-001, NF-006

**Files:**

- Create: `packages/domain/src/review-session.ts`
- Create: `packages/domain/src/review-session.test.ts`
- Create: `packages/domain/src/task-actions.ts`
- Create: `packages/domain/src/task-actions.test.ts`
- Modify: `packages/domain/src/index.ts`

**Step 1: Write failing state-machine tests**

Required scenarios:

- due tasks are ordered by overdue duration, neglect level, due today, unset due, normal review, then creation time;
- session order stays fixed when a task is edited;
- answering moves `currentIndex` to the next item;
- `goToPreviousTask()` moves back one and never below zero;
- re-answering a visited task appends a new event and updates current task state;
- interrupted session resumes at the saved index;
- final answer sets `completedAt`;
- completed session result retains all processed task IDs;
- completed/archived tasks are skipped if stale in a resumed session.

**Step 2: Confirm failure**

```powershell
pnpm --filter @atoqueue/domain test -- review-session.test.ts task-actions.test.ts
```

Expected: FAIL.

**Step 3: Implement commands**

```ts
export function startReviewSession(input: StartReviewInput): ReviewSession;
export function currentReviewTask(input: CurrentReviewTaskInput): Task | null;
export function answerReview(input: AnswerReviewInput): AppSnapshot;
export function goToPreviousTask(
  session: ReviewSession,
  now: string,
): ReviewSession;
export function summarizeReview(
  session: ReviewSession,
  events: ActionEvent[],
): ReviewSummary;
```

Allowed answers are `complete`, `do_today`, `reschedule`, `no_due`, `dismiss`, `archive`. Each command must update `revision`, append an `ActionEvent`, and enqueue a notification upsert/cancel when applicable.

**Step 4: Verify state transitions**

```powershell
pnpm --filter @atoqueue/domain test -- review-session.test.ts task-actions.test.ts --coverage
```

Expected: PASS and all transition branches are executed.

**Step 5: Commit**

```powershell
git add packages/domain/src
git commit -m "feat: add reversible daily review session"
```

**実装結果（2026-08-03）:** 固定順序・中断再開・前への移動・再回答・結果集計を端末内の状態機械として実装した。完了・保管はローカルを先に更新して匿名の取消Outboxを積む。`schemaVersion`をv2へ上げ、v1のレビューセッションには空の`actionEventIds`を追加して移行する。v2では終端日時、期限モード、順序ID、セッション所有イベントを検証する。状態遷移対象の分岐100%、ドメイン112件、型検査、ビルド、移行テストが成功した。

## Task 8: Build Today Review and result screens（完了: 2026-08-03）

**Requirements:** F-012, F-014, F-015, F-016, NF-001, NF-012

**Files:**

- Create: `apps/web/src/features/review/TodayReviewPage.tsx`
- Create: `apps/web/src/features/review/TodayReviewPage.css`
- Create: `apps/web/src/features/review/TodayReviewPage.test.tsx`
- Create: `apps/web/src/features/review/ReviewActionSheet.tsx`
- Create: `apps/web/src/features/review/ReviewResultPage.tsx`
- Create: `apps/web/src/features/review/ReviewResultPage.test.tsx`
- Create: `apps/web/e2e/today-review.spec.ts`
- Modify: `apps/web/src/app/router.tsx`

**Step 1: Write the failing Today Review tests**

Assert the following exact behaviors:

- the heading text `今日の確認` is left aligned consistently with other screens;
- the right control text is `前のタスク`, without an arrow;
- the previous control is absent on item 1 and visible from item 2 onward;
- the progress count is inside the task card at its top-right;
- one task card is rendered at a time;
- level 0–4 messages match `choosePrompt()`;
- `完了`, `今日やる`, `日付を変える`, `期限なし`, `今回は閉じる`, `不要` call the matching domain command;
- choosing an answer moves immediately to the next task without a confirmation dialog;
- returning to the previous task displays its current result and permits re-answering;
- the last answer navigates to `/today/result`;
- the empty state uses the exact copy from `docs/screens.md`.

**Step 2: Write the failing result tests**

- group counts by action;
- list every processed task with current status;
- each row exposes `修正` linking to `/tasks/:taskId`;
- links to `/tasks` and `/` are present.

**Step 3: Confirm failure**

```powershell
pnpm --filter @atoqueue/web test -- TodayReviewPage.test.tsx ReviewResultPage.test.tsx
```

Expected: FAIL.

**Step 4: Implement the pages**

Use a container hook that loads the snapshot, starts/resumes a session, calls domain commands, and persists the returned snapshot. Keep React components free of date arithmetic and `localStorage` calls.

CSS invariant:

```css
.reviewHeader {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
}
.reviewHeader__previous {
  justify-self: start;
}
.reviewHeader__title {
  justify-self: center;
}
.reviewHeader__progress {
  justify-self: end;
}
```

**Step 5: Add the full E2E path**

Seed three tasks. Complete the first, reschedule the second, move to the third, return twice, change the first to rescheduled, finish, and verify the result plus action history.

**Step 6: Verify**

```powershell
pnpm --filter @atoqueue/web test -- TodayReviewPage.test.tsx ReviewResultPage.test.tsx
pnpm --filter @atoqueue/web test:e2e -- today-review.spec.ts
```

Expected: PASS at 320×640 and 1280×800 viewports.

**Step 7: Commit**

```powershell
git add apps/web/src/features/review apps/web/e2e/today-review.spec.ts apps/web/src/app/router.tsx
git commit -m "feat: add one-at-a-time today review"
```

**実装結果（2026-08-09更新）:** Task 7の状態機械を`AppRepository`経由で画面化し、空セッションの再計算、戻った項目の最新回答表示、結果からの修正導線、期限・経過表示、DST境界を実装した。見出しは他画面と同じ左揃え、2件目以降の「前のタスク」は見出し右、進行件数はカード内右上とした。Today Reviewを含むWeb E2E全27件、単体・結合テスト、型検査、ビルドが成功した。

## Task 9: Build task list, detail, edits, and history（完了: 2026-08-04）

**Requirements:** F-014, F-015, F-016, F-018, NF-006, NF-012

**Files:**

- Create: `packages/domain/src/task-query.ts`
- Create: `packages/domain/src/task-query.test.ts`
- Create: `apps/web/src/features/tasks/TaskListPage.tsx`
- Create: `apps/web/src/features/tasks/TaskListPage.test.tsx`
- Create: `apps/web/src/features/tasks/TaskDetailPage.tsx`
- Create: `apps/web/src/features/tasks/TaskDetailPage.test.tsx`
- Create: `apps/web/src/features/tasks/ActionHistoryList.tsx`
- Create: `apps/web/e2e/task-management.spec.ts`
- Modify: `apps/web/src/app/router.tsx`

**Step 1: Write failing query tests**

Cover active/completed/archived tabs, overdue/today/unset/none/category filters, Unicode substring search, and the default sort: earliest `nextReviewAt`, earliest `dueAt`, oldest `createdAt`.

**Step 2: Write failing UI tests**

- list badges show due state with text, not color alone;
- detail shows source capture, current state, due state, next review, neglect reason, and chronological history;
- completion, reopen, reschedule, no due, dismiss, archive, title edit, and category edit persist;
- an API sync failure does not roll back the local edit and shows `通知の更新を送信待ちにしています`.

**Step 3: Confirm failure**

```powershell
pnpm --filter @atoqueue/domain test -- task-query.test.ts
pnpm --filter @atoqueue/web test -- TaskListPage.test.tsx TaskDetailPage.test.tsx
```

Expected: FAIL.

**Step 4: Implement list and detail**

Keep filtering in `packages/domain/src/task-query.ts`. The page passes search/filter values and renders the result; it does not duplicate business rules.

**Step 5: Verify**

```powershell
pnpm --filter @atoqueue/domain test -- task-query.test.ts
pnpm --filter @atoqueue/web test -- TaskListPage.test.tsx TaskDetailPage.test.tsx
pnpm --filter @atoqueue/web test:e2e -- task-management.spec.ts
```

Expected: PASS, including modification after a completed Today Review session.

**Step 6: Commit**

```powershell
git add packages/domain/src/task-query.ts packages/domain/src/task-query.test.ts apps/web/src/features/tasks apps/web/e2e/task-management.spec.ts apps/web/src/app/router.tsx
git commit -m "feat: add active task management and history"
```

**実装結果（2026-08-09再検証）:** 一覧・詳細・履歴・編集を端末内状態と匿名Outboxの境界を保って実装した。元メモを含むUnicode検索、IANAタイムゾーン基準の当日判定、選択日による期限変更、保存失敗の復旧表示、44px以上の主要操作をテストした。タスク管理を含むWeb E2E全27件、単体・結合テスト、型検査、Webビルドが成功した。

## Task 10: Define strict notification contracts and device registration API

**Requirements:** F-013, NF-004, NF-005, NF-007, NF-008, NF-009, NF-010, NF-013

**Files:**

- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/push.ts`
- Create: `packages/contracts/src/devices.ts`
- Create: `packages/contracts/src/reminders.ts`
- Create: `packages/contracts/src/contracts.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/errors/api-error.ts`
- Create: `apps/api/src/plugins/request-context.ts`
- Create: `apps/api/src/plugins/security.ts`
- Create: `apps/api/src/db/connection.ts`
- Create: `apps/api/src/db/migrate.ts`
- Create: `apps/api/src/db/migrations/001_initial.sql`
- Create: `apps/api/src/devices/device-repository.ts`
- Create: `apps/api/src/devices/device-service.ts`
- Create: `apps/api/src/devices/device-routes.ts`
- Create: `apps/api/src/devices/device-routes.test.ts`
- Modify: `apps/api/src/server.ts`

**Step 1: Write failing strict-schema tests**

`CreateReminderRequestSchema` must reject unknown keys. Include:

```ts
expect(() =>
  CreateReminderRequestSchema.parse({
    deviceId,
    scheduledAt,
    notificationType: "task_review",
    body: "猫の餌を買う",
  }),
).toThrow();
```

Repeat for `title`, `taskId`, and `category`. Verify all response and error schemas parse their documented examples.

**Step 2: Write failing device API tests**

Use Fastify injection and an isolated PostgreSQL fixture. Cover:

- `GET /v1/push/public-key`;
- `POST /v1/devices` returns a device secret only once;
- DB stores `secret_hash`, never the raw secret;
- `PUT /v1/devices/:id/subscription` requires the bearer secret;
- `DELETE /v1/devices/:id` disables the subscription and cancels pending jobs;
- request logs do not contain endpoint, keys, bearer secret, or task-like request data;
- invalid and oversized requests return the stable error envelope.

**Step 3: Confirm failure**

```powershell
pnpm --filter @atoqueue/contracts test -- contracts.test.ts
pnpm --filter @atoqueue/api test -- device-routes.test.ts
```

Expected: FAIL.

**Step 4: Create the database schema**

Implement `device_subscriptions` and `reminder_jobs` exactly as `docs/data-model.md` defines in PostgreSQL. Add indexes:

```sql
CREATE INDEX idx_reminder_jobs_due
ON reminder_jobs(status, scheduled_at);

CREATE UNIQUE INDEX idx_reminder_jobs_idempotency
ON reminder_jobs(device_id, idempotency_key);
```

PostgreSQLの外部キー制約を `001_initial.sql` で定義する。SQLite固有のWAL設定は行わず、PostgreSQLの通常の永続化設定を使用する。

**Step 5: Implement API security**

- Parse environment variables with Zod at startup.
- Hash device secrets with Argon2id.
- Configure CORS with one exact origin.
- Add documented rate limits.
- Redact `authorization`, subscription endpoint, `p256dh`, `auth`, and request bodies from logs.
- Map internal exceptions to the stable error envelope.

**Step 6: Verify**

```powershell
pnpm --filter @atoqueue/contracts test
pnpm --filter @atoqueue/api test -- device-routes.test.ts
pnpm --filter @atoqueue/api typecheck
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add packages/contracts apps/api
git commit -m "feat: add private device registration api"
```

**実装結果（2026-08-04）:** 端末登録・購読更新・無効化、共有Zod契約、PostgreSQL migration、Argon2id端末認証、信頼済みCaddy経由のレート制限、操作冪等性、プライバシー制限ログを実装した。ビルド済みアセットからmigrationを読込むこと、DBヘルス依存、設定、ログ漏えいをテストした。実行エントリポイントと `listen()` はこのTaskの範囲外であり、次のTask 11で作成する `apps/api/src/start.ts` に繰り延べる。

## Task 11: Implement reminder API, scheduler, and generic Web Push

**Requirements:** F-013, NF-003, NF-004, NF-005, NF-007, NF-009, NF-010, NF-013

**実装結果（2026-08-04）:** 匿名端末所有者の予約PUT/取消、履歴を保持する予約冪等性、PostgreSQL行ロックによる配送claim、claim token付き配送確定、汎用Web Push、5分pollと起動時のstale claim回復を実装した。ビルド済み `dist/start.js` は `pnpm --filter @atoqueue/api start` から起動し、相対パス実行時も設定検証と起動処理へ到達することを成果物テストで確認した。

**Files:**

- Create: `apps/api/src/reminders/reminder-repository.ts`
- Create: `apps/api/src/reminders/reminder-service.ts`
- Create: `apps/api/src/reminders/reminder-routes.ts`
- Create: `apps/api/src/reminders/reminder-routes.test.ts`
- Create: `apps/api/src/push/push-client.ts`
- Create: `apps/api/src/push/web-push-client.ts`
- Create: `apps/api/src/scheduler/reminder-dispatcher.ts`
- Create: `apps/api/src/scheduler/reminder-dispatcher.test.ts`
- Create: `apps/api/src/start.ts`
- Modify: `apps/api/src/server.ts`

**Step 1: Write failing reminder-route tests**

Cover create, full replacement, cancel, other-device isolation, past-time validation, idempotent replay, idempotency conflict, and forbidden fields. Query PostgreSQL after each request and assert that the only user-supplied values are device ID, reminder ID, schedule, type, and idempotency key.

**Step 2: Write failing dispatcher tests**

Use an injected fake clock and `PushClient` port:

```ts
export interface PushClient {
  send(input: {
    subscription: PushSubscriptionRecord;
    payload: { type: "review_due"; reminderId: string; url: string };
  }): Promise<{ statusCode: number }>;
}
```

Required cases:

- claim at most 100 due jobs;
- do not send future or cancelled jobs;
- successful send marks `sent`;
- temporary failure reschedules at 5, 15, then 60 minutes;
- third failed attempt marks `failed`;
- 404/410 disables the subscription and fails pending jobs;
- jobs claimed over 15 minutes ago return to pending at startup;
- two dispatcher ticks do not send the same claim twice;
- payload contains no task data and uses `/today?reminder=<id>`.

**Step 3: Confirm failure**

```powershell
pnpm --filter @atoqueue/api test -- reminder-routes.test.ts reminder-dispatcher.test.ts
```

Expected: FAIL.

**Step 4: Implement routes and dispatcher**

- `PUT /v1/reminders/:reminderId` upserts by authenticated device and idempotency key.
- `DELETE` is idempotent for the authenticated owner.
- Claim jobs in a PostgreSQL transaction with row locking.
- Poll every 5 minutes from `start.ts`; call `unref()` on the timer so tests can exit.
- Keep `web-push` library calls behind `PushClient`.
- Use the generic notification data from `docs/api-design.md`.

**Step 5: Verify**

```powershell
pnpm --filter @atoqueue/api test -- reminder-routes.test.ts reminder-dispatcher.test.ts
pnpm --filter @atoqueue/api test
pnpm --filter @atoqueue/api build
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add apps/api/src/reminders apps/api/src/push apps/api/src/scheduler apps/api/src/start.ts apps/api/src/server.ts
git commit -m "feat: deliver anonymous generic reminders"
```

## Task 12: Add notification permission, outbox sync, and notification navigation

**Requirements:** F-013, NF-002, NF-003, NF-004, NF-005, NF-006, NF-010, NF-012

**Files:**

- Create: `apps/web/src/infrastructure/notifications/notification-api.ts`
- Create: `apps/web/src/infrastructure/notifications/notification-api.test.ts`
- Create: `apps/web/src/infrastructure/notifications/outbox-sync.ts`
- Create: `apps/web/src/infrastructure/notifications/outbox-sync.test.ts`
- Create: `apps/web/src/infrastructure/notifications/push-subscription.ts`
- Create: `apps/web/src/infrastructure/notifications/push-subscription.test.ts`
- Create: `apps/web/src/service-worker.ts`
- Create: `apps/web/src/features/settings/NotificationSettings.tsx`
- Create: `apps/web/src/features/settings/NotificationSettings.test.tsx`
- Create: `apps/web/e2e/notification-settings.spec.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/main.tsx`

**Step 1: Write failing permission-flow tests**

- initial page load never calls `Notification.requestPermission()`;
- the page explains benefit and local-data privacy first;
- only pressing `通知を設定する` requests permission;
- denied and unavailable states show browser-setting or in-app fallback guidance;
- granted state registers the device and stores secret only in local data;
- repeated setup updates the subscription instead of creating duplicate devices.

**Step 2: Write failing Outbox tests**

- local task edits succeed while offline and leave an outbox item;
- upsert sends the exact strict contract with no task data;
- cancel removes a server reminder and local mapping;
- 429 honors `Retry-After`;
- 5xx uses exponential retry;
- 400 stops retry and exposes a settings error;
- 401 marks device registration stale;
- app launch and `online` event trigger `flushOutbox()`;
- a stale outbox item with an older `taskRevision` is discarded.

**Step 3: Write failing Service Worker tests**

- push displays title `あとキュー`, body `確認したい項目があります`, and tag `atoqueue-review`;
- task text cannot be supplied through payload schema;
- click focuses an existing same-origin client or opens the payload URL;
- invalid or missing reminder ID opens `/today`.

**Step 4: Confirm failure**

```powershell
pnpm --filter @atoqueue/web test -- notification-api.test.ts outbox-sync.test.ts push-subscription.test.ts NotificationSettings.test.tsx
```

Expected: FAIL.

**Step 5: Implement client and worker**

- Use a typed fetch adapter based on `packages/contracts`.
- Construct requests from `NotificationOutboxItem`, never from a full `Task`.
- Resolve `reminderId` to `taskId` only after the app loads local data.
- If the mapping is absent or task inactive, show normal Today Review.
- Register `online` listener once at application bootstrap and remove it on teardown in tests.

**Step 6: Verify**

```powershell
pnpm --filter @atoqueue/web test -- notification-api.test.ts outbox-sync.test.ts push-subscription.test.ts NotificationSettings.test.tsx
pnpm --filter @atoqueue/web test:e2e -- notification-settings.spec.ts
pnpm --filter @atoqueue/web build
```

Expected: PASS. Manual Push delivery remains for staging because browser push services cannot be fully simulated in unit tests.

**Step 7: Commit**

```powershell
git add apps/web/src/infrastructure/notifications apps/web/src/service-worker.ts apps/web/src/features/settings/NotificationSettings.tsx apps/web/src/features/settings/NotificationSettings.test.tsx apps/web/e2e/notification-settings.spec.ts apps/web/vite.config.ts apps/web/src/main.tsx
git commit -m "feat: add privacy-safe push reminder sync"
```

## Task 13: Implement JSON backup, restore, and Settings page

**Requirements:** F-017, F-018, NF-004, NF-006, NF-008, NF-012

**Files:**

- Create: `packages/domain/src/backup.ts`
- Create: `packages/domain/src/backup.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/web/src/features/settings/BackupSettings.tsx`
- Create: `apps/web/src/features/settings/BackupSettings.test.tsx`
- Create: `apps/web/src/features/settings/SettingsPage.tsx`
- Create: `apps/web/src/features/settings/SettingsPage.test.tsx`
- Create: `apps/web/e2e/backup-restore.spec.ts`
- Modify: `apps/web/src/app/router.tsx`

**Step 1: Write failing backup-domain tests**

Assert:

- export then import preserves captures, tasks, review sessions, action history, and settings;
- export excludes `pushDeviceSecret`, subscription data, outbox, and reminder map;
- checksum mismatch fails before mutation;
- unknown format/version fails;
- invalid entity references fail;
- import preserves current device identity;
- successful restore appends `backup_restored` and rebuilds reminder outbox;
- failed restore returns the original snapshot unchanged.

**Step 2: Write failing Settings tests**

- data section has `JSONバックアップを書き出す` and `JSONバックアップから復元`;
- restore displays incoming/current counts before an explicit replacement action;
- invalid files show a reason and never replace data;
- information section displays app name, version, `この端末内`, and the no-sync statement;
- notification settings from Task 12 are embedded.

**Step 3: Confirm failure**

```powershell
pnpm --filter @atoqueue/domain test -- backup.test.ts
pnpm --filter @atoqueue/web test -- BackupSettings.test.tsx SettingsPage.test.tsx
```

Expected: FAIL.

**Step 4: Implement deterministic backup format**

- Canonicalize JSON object keys before SHA-256 checksum.
- Name downloads `atoqueue-backup-YYYY-MM-DD.json`.
- Parse as `unknown` and validate before presenting counts.
- Persist the restored snapshot once after user confirmation.
- Trigger Outbox flush after restore if online.

**Step 5: Verify**

```powershell
pnpm --filter @atoqueue/domain test -- backup.test.ts
pnpm --filter @atoqueue/web test -- BackupSettings.test.tsx SettingsPage.test.tsx
pnpm --filter @atoqueue/web test:e2e -- backup-restore.spec.ts
```

Expected: PASS, including restore into a clean browser context.

**Step 6: Commit**

```powershell
git add packages/domain/src/backup.ts packages/domain/src/backup.test.ts packages/domain/src/index.ts apps/web/src/features/settings apps/web/e2e/backup-restore.spec.ts apps/web/src/app/router.tsx
git commit -m "feat: add portable local backup and restore"
```

## Task 14: Close accessibility, resilience, and browser gaps

**Requirements:** NF-001–NF-013

**Files:**

- Create: `apps/web/e2e/accessibility.spec.ts`
- Create: `apps/web/e2e/offline-resilience.spec.ts`
- Create: `apps/web/e2e/data-recovery.spec.ts`
- Create: `apps/web/e2e/browser-matrix.md`
- Create: `apps/api/src/privacy-regression.test.ts`
- Create: `docs/operations/browser-verification.md`
- Modify: UI styles and components only where a test exposes a defect

**Step 1: Add failing accessibility checks**

Install `@axe-core/playwright`, then test all eight screen routes with representative data. Fail on serious/critical findings. Add keyboard-only paths for capture, inbox classification, Today Review, task edit, and backup.

**Step 2: Add failing resilience tests**

Cover:

- save/reload while offline;
- API unavailable during local edit;
- online recovery flush;
- localStorage quota failure preserving the form;
- malformed local JSON recovery path;
- unsupported schema version without overwrite;
- stale notification link;
- notification denied and unavailable;
- server restart with pending PostgreSQL reminders.

**Step 3: Add the privacy regression test**

Seed unique canaries such as `SECRET_TASK_CANARY_8D3`. Exercise all API routes and one dispatcher cycle, then search serialized HTTP captures, PostgreSQL text columns, push payloads, and captured logs. Assert the canary never appears.

**Step 4: Confirm failures before fixes**

```powershell
pnpm --filter @atoqueue/web test:e2e -- accessibility.spec.ts offline-resilience.spec.ts data-recovery.spec.ts
pnpm --filter @atoqueue/api test -- privacy-regression.test.ts
```

Expected: at least one initial failure demonstrates the tests are active; document any suite that passes immediately and why.

**Step 5: Fix only exposed gaps**

Do not redesign layouts. Correct labels, focus order, contrast, recovery messages, or retry behavior at the smallest responsible boundary.

**Step 6: Run full quality gate**

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm audit --audit-level high
```

Expected: all functional commands exit 0; no unresolved high/critical production dependency vulnerability. Record accepted exceptions with package, path, exploitability, and removal condition.

**Step 7: Perform manual browser checks**

Record date, device, OS, browser version, install result, offline result, permission result, test Push result, and notification-click result for:

- iOS Home Screen PWA;
- Android Chrome installed PWA;
- Windows Chrome installed PWA;
- Windows Edge installed PWA.

**Step 8: Commit**

```powershell
git add apps docs/operations/browser-verification.md
git commit -m "test: verify accessibility resilience and privacy"
```

## Task 15: Add reproducible deployment, operations, and pilot checklist

**Requirements:** F-001–F-018, NF-003, NF-007, NF-009, NF-010, NF-011, NF-013

**Files:**

- Create: `.github/workflows/deploy.yml`
- Create: `deploy/systemd/atoqueue-notification-api.service`
- Create: `deploy/caddy/atoqueue-api.caddyfile`
- Create: `deploy/scripts/deploy-release.sh`
- Create: `docs/operations/deployment.md`
- Create: `docs/operations/notification-db-recovery.md`
- Create: `docs/operations/push-key-rotation.md`
- Create: `docs/pilot/7-day-checklist.md`
- Create: `docs/pilot/result-template.md`
- Modify: `AGENTS.md`
- Modify: `基本設計サマリ.md` only if deployment decisions replace a current 【想定】

**Step 1: Write failing deployment configuration checks**

Verify the deployment workflow and service artifacts are absent before implementation, then add tests or static assertions that require:

- `systemd` runs the API as non-login user `atoqueue` on `127.0.0.1:3030` and restarts it on failure;
- Caddy only proxies `https://api.atoqueue.sikumilab.com` to that loopback address;
- the service reads `/etc/atoqueue/notification-api.env` without placing secrets in Git, images, or GitHub workflow output;
- the app uses PostgreSQL DB `atoqueue_notify` through role `atoqueue_notify_app`;
- GitHub Actions tests every push and deploys only from a manually approved production environment through `atoqueue-deploy` and its dedicated SSH key.

**Step 2: Implement the systemd and GitHub Actions deployment**

- build Web and API with Node 24 in CI;
- publish the PWA to GitHub Pages at `https://atoqueue.sikumilab.com`;
- deploy the API release to the OCI VPS only through a manually triggered, approved GitHub Actions workflow;
- migrate the existing PostgreSQL notification DB, restart the systemd unit, then require `/healthz` to succeed;
- use Caddy for TLS and reverse proxying; Cloudflare DNS starts in DNS-only mode;
- never deploy containers, a local notification DB volume, or real VAPID keys;
- roll back to the previous release if migration, restart, or health check fails.

**Step 3: Write operating procedures**

`deployment.md` must contain exact commands for build, PostgreSQL migration, start, health check, rollback, and log inspection for the OCI VPS. It must use the confirmed PWA URL, notification API URL, PostgreSQL DB/role, Caddy TLS, and GitHub Actions approval flow.

`notification-db-recovery.md` must explain that OCI Object Storage and scheduled database backup are out of MVP scope. It must define the manual pre-migration `pg_dump` option and the post-loss recovery flow: client clears obsolete server credentials, registers a device again, and re-sends active reminders from local state.

`push-key-rotation.md` must explain that VAPID rotation invalidates or requires re-registration of existing subscriptions and define the user-facing recovery state.

**Step 4: Create the 7-day pilot**

Checklist fields:

- daily capture count;
- self-reported missed thoughts;
- inbox processed count;
- review sessions started/completed;
- level 2/3 tasks resolved by complete/reschedule/archive;
- notification delivery observations per device;
- friction notes;
- keep/change/remove decision for every F-001–F-018 feature.

Do not send analytics to the server; calculate from exported local data and participant notes.

**Step 5: Verify approved deployment and recovery**

Run the manually approved GitHub Actions deployment to the OCI VPS. Confirm Caddy HTTPS, `/healthz`, systemd restart recovery, and a DB-loss simulation that results in client re-registration and reminder re-sync. Run the 7-day pilot on the production URL; no public staging environment is created for MVP.

Expected: health is 200 before and after restart, pending notification jobs remain in PostgreSQL across restart, and client-local tasks remain intact after notification DB loss.

**Step 6: Run final release checks**

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
git status --short
```

Expected: all checks pass and only intended documentation/runtime files are staged or tracked.

**Step 7: Commit**

```powershell
git add .github deploy docs AGENTS.md 基本設計サマリ.md
git commit -m "docs: add deployment operations and mvp pilot"
```

## Final implementation review

Before claiming completion, answer each question with file/test evidence:

1. Does every F-001–F-018 requirement have an implementation task and an acceptance test?
2. Does every NF-001–NF-013 requirement have an automated or named manual verification?
3. Can any code path serialize task text into an HTTP request, API log, PostgreSQL row, or Push payload?
4. Does the app remain useful when notification permission is denied, Push is late, or the API is down?
5. Can a user return to the previous Today Review task and change the choice without an Undo toast?
6. Is `今日の確認` left aligned, with an arrowless previous control shown only from item 2 onward and progress inside the task card?
7. Can a completed review be modified from result, list, and detail screens?
8. Are date/time functions tested at day, week, and time-zone boundaries?
9. Does backup round-trip all user data while excluding all device secrets?
10. Are all environment variables, commands, error codes, IDs, and file paths consistent across code and documents?
11. Are there any placeholders such as TODO/TBD/XXX or unexplained skipped tests?
12. Does a clean clone pass install, migration, build, test, approved deployment, systemd restart, and health verification?

Run one last source scan:

```powershell
rg -n "TODO|TBD|XXX|\.skip\(|\.only\(" . --glob '!node_modules/**' --glob '!dist/**'
```

Expected: no unresolved production placeholders, skipped tests, or focused tests.

## Follow-up: configurable notification timing（2026-08-08）

**Requirements:** F-014, F-018, NF-003, NF-004, NF-005, NF-007, NF-010, NF-013

**Confirmed design:** Every active task can have anonymous `initial`, `deadline_before`, and `review` reservations. The initial and deadline-before delays are global device settings, both initially 60 minutes. Completion, archival, and unneeded actions cancel every reservation for that task. The API claims reservations up to `DEADLINE_DELIVERY_LEAD_SECONDS` (default 300) ahead of the current time so a five-minute poll can attempt delivery before the deadline. This does not guarantee OS delivery time.

**Implementation steps:** Add a versioned local model migration, plan anonymous schedules in the domain package, rebuild reservation outbox after settings or task changes, preserve schedule kinds during error recovery, and cover the API prefetch window with fake-clock tests. No task title, task ID, deadline meaning, or history may cross the API boundary.

**Confirmed follow-up:** Pilot feedback confirmed that same-type, same-timestamp generic notifications should be coalesced into one visible notification, while a different type or timestamp must use a different notification tag.

**Delivery-attention follow-up:** `mvp-1.7.0` requests high Web Push urgency, retains pending Push messages for 24 hours, and requests a short vibration from supporting clients. It does not force `silent`, persistent notifications, or DND bypass; OS and user settings remain authoritative.

### 2026-08-09 implementation follow-up: initial reminder deadline boundary

- 【確定】`initial` は期限ありタスクの期限より前に到来する場合だけ作る。同時刻または期限後なら省略し、期限時の `review` を残す。
- 【確定】期限なし・期限未設定タスクの `initial` は従来どおり作る。
- 【確定】期限または初回通知設定の変更で不要になった既存 `initial` は、全予約再計算時に取消Outboxへ積む。
- 検証は予定生成の境界、期限変更、設定変更、期限なし・期限未設定をドメインテストで固定する。API・PostgreSQL・Push payloadの契約は変更しない。
- 実装結果: 上記境界をドメインテストでREDから確認して実装し、Web・Domain・Contracts 349件、API通常70件、Chromium E2E 27件、型検査、Lint、直接ビルドを通過した。表示バージョンを `mvp-1.0.1` へ更新した。

### 2026-08-09 implementation follow-up: operation feedback and version policy

- 対象要件: F-004、F-015、F-017、F-018、NF-001、NF-006。
- 【確定】保存・変更の処理中は対象ボタンの文言を切り替えて二重操作を防ぎ、成功・失敗を操作区画の直下へ表示する。
- 【確定】端末内への保存と通知サーバーへの反映は別結果として表示する。通知同期だけが失敗した場合もローカル保存・復元は成功として扱う。
- 【確定】表示バージョンは`mvp-1.1.0`。単一画面かつロジック変更なしはパッチ、複数画面またはロジック変更ありはマイナーとしてパッチを0へ戻し、メジャーは事前相談する。
- 実装結果: 通知タイミング・確認頻度・通知端末設定、タスク内容・期限・状態、受信箱本文、バックアップ・復元・削除へ操作結果表示を追加した。既存設定の読込みだけで通知設定完了を誤表示しないようにし、「期限なし」は入力状態も解除する。全427テスト、Chromium E2E 27件、Lint、型検査、本番ビルドを通過した。

## Follow-up: タスク一覧の全状態表示（2026-08-09）

**Requirements:** F-014, F-015, F-016

- 【確定】状態フィルターへ「すべて」を追加し、対応中・完了・アーカイブを同じ一覧で確認できるようにする。初期値は従来どおり「対応中」とする。
- 【確定】検索・期限・カテゴリの各条件は、「すべて」を選んだ場合も同じように適用する。
- 【確定】フィルターロジックを変更するためマイナー改修とし、表示・Web・API・ワークスペースのバージョンを`mvp-1.2.0`へ揃える。
- 実装結果: ドメイン検索とタスク一覧画面の公開境界でREDを確認してから実装し、全429テスト、Chromium E2E 27件、Lint、型検査、本番ビルドを通過した。

## Follow-up: 受信箱の全記録履歴と通知取消（2026-08-09）

**Requirements:** F-004、F-006、F-014、NF-004、NF-006、NF-010、NF-013

- 【確定】受信箱は `すべて / 未整理 / メモ / 不要` の4タブとし、初期値は未整理、全タブを登録日時の新しい順に表示する。
- 【確定】`すべて` は全Captureを起点ごとに1件だけ表示する。タスク化済み行は紐づくTask詳細へ移動し、Taskを同じ一覧へ重複表示しない。
- 【確定】不要記録は自動削除せず、未整理へ復元できる。完全削除は確認後だけ実行し、対象CaptureとそのCaptureの操作履歴を端末から削除する。
- 【確定】不要化・復元・完全削除はローカル保存後に匿名通知Outboxを即時同期する。通信失敗時はローカル変更を維持し、送信待ちとして再送する。
- 実装結果: Capture query、復元・削除ドメイン操作、4タブUI、タスク詳細導線、保存後同期、同期失敗表示をTDDで追加した。複数画面と通知ロジックを変更したため表示・API・ワークスペースのバージョンを `mvp-1.3.0` へ揃え、全442テスト、Chromium E2E 28件、Lint、型検査、本番ビルドを通過した。

## Follow-up: mobile UI, deadline time, and first-use guidance（2026-08-08）

**Requirements:** F-002, F-006, F-007, F-013, F-018, NF-008, NF-010, NF-012

**Confirmed design:** The quick-capture screen keeps deadline entry out of the initial action. At task conversion and task editing, a user may add an optional `HH:MM` time to today, tomorrow, this Sunday, or a custom date. A blank time remains 23:59. The local IANA time zone converts that selection to UTC for persistence, and dates are rendered back in the device time zone. New v4 snapshots show a local-only guide covering notification timing, explicit browser notification setup, and inbox task conversion. Existing v3 data migrates as already guided.

**Implementation steps:** Add time-aware due-choice tests before extending the domain calendar call; render an accessible time input in candidate and detail screens; add schema v4 migration tests; format local dates, time zones, and offsets at the presentation boundary; use Kosugi and a consistent settings-style card/form system across screens; replace fragile text icons with `2.5`-stroke SVG navigation icons. Explain the five-minute dispatcher poll and Android/PWA notification checks in Settings. No new task data may cross the notification boundary.

## Follow-up: 受信箱3タブとレイアウト統一（2026-08-10）

**Requirements:** F-004、F-006、F-009、F-010、F-014、F-015、NF-001、NF-004、NF-006、NF-010、NF-013

- 【確定】受信箱は `未整理 / メモ / 不要` の3タブとし、タスク化済みCaptureは一覧・件数へ表示しない。Task本体とCapture参照は端末内に保持する。
- 【確定】不要記録には `未整理から` または `メモから` の経路を表示し、個別操作に加えて全選択・選択解除・一括復元・確認付き一括完全削除を提供する。
- 【確定】Captureを捨てる操作は `不要`、Taskを保管する操作は `アーカイブ` と表示する。
- 【確定】ページタイトルから最初の要素までの間隔を `0.75rem` に統一し、PC左ナビの文字・アイコン・操作範囲を拡大する。スマホのフローティングフッター寸法は維持する。
- 【確定】表示・Web・API・ワークスペースのバージョンを `mvp-1.4.0` / `1.4.0` へ揃える。
- 実装結果: ドメインの一括操作を事前検証後の単一snapshot更新として実装し、画面では1回の保存と1回の通知同期に限定した。単体・結合テスト56ファイル452件、対象Chromium E2E 16件、Lint、型検査、本番ビルドを通過した。

### 追補: 端末固有カテゴリ・復元改善・当日セッション更新（2026-08-10）

- 対象要件: F-005、F-006、F-009、F-010、F-016、F-017、F-018、NF-003、NF-004、NF-005、NF-010。
- 【確定】プリセット `仕事 / 家 / 買い物 / その他` は変更不可とし、端末固有カテゴリを最大10件まで追加する。本文への同一表記の完全包含だけを候補とし、自動確定しない。
- 【確定】削除済みカテゴリは新規選択肢から外すが、既存Taskのカテゴリ値は保持し、画面では `（過去）` と表示する。
- 【確定】バックアップ復元は追加ではなく洗い替えとし、復元先端末の通知資格情報を維持する。復元後はTask・未整理受信箱・メモ棚卸しの匿名通知予約を再構築する。
- 【確定】未完了の当日ReviewSessionは、再読込み時に新しく対象となったTaskを末尾へ追加する。複数対象では「次のタスク」を表示する。
- 【確定】表示・Web・API・ワークスペースのバージョンを `mvp-1.5.0` / `1.5.0` へ揃える。
- 詳細計画: `docs/superpowers/plans/2026-08-10-custom-task-categories-and-backup-restore.md`。

### 2026-08-10 patch follow-up: category save guidance

- 対象要件: F-005、F-017、NF-012。
- 【確定】設定画面に「追加・削除した内容は、『カテゴリを保存』を押すと確定します。」と表示し、確定操作を明示する。
- 【確定】単一画面の文言修正でロジック変更がないため、表示・Web・API・ワークスペースのバージョンを `mvp-1.5.1` / `1.5.1` へ揃える。
