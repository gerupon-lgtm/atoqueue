# テンパリスト起動URL連携 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** あとキューの複数Taskをテンパリストv0.4.0へ一方向に渡し、開く操作の履歴を控えめな「連携済」ラベルとして残す。

**Architecture:** URL契約・連携状態の純粋処理、保存アダプター、application service、選択/確認画面、リンク起動Portを分離する。AppSnapshotの専用領域へ直前の確定内容とTask別の開く操作履歴を保存し、Task本体・通知状態は変更しない。起動方式の実機評価を先行試験として切り出し、本体は差替え可能なPortで検証する。

**Tech Stack:** TypeScript、Node.js 24 LTS、pnpm 10.20.0、React、Vite、Vitest、React Testing Library、Playwright。新しい本番依存パッケージは追加しない。

**Spec:** `docs/superpowers/specs/2026-09-11-tempalist-checklist-link-design.md`（2026-09-11利用者承認）。

## Global Constraints

- 固定の起動先は `https://tempalist.sikumilab.com/#create=<payload>`。
- schemaVersionは数値1、kindは `checklist-create`、sourceは `atoqueue`。requestIdは確定時に発行する小文字のUUID v4。
- 初版のコメントは空欄。任意項目 `note` を省略し、`Capture.body` は自動転記しない。
- 制限は完成URL全体で8000文字以内。JSONの文字数や選択件数のみでは判定しない。
- 元Taskの状態・本文・期限・確認予定・通知予約は変更しない。通知共通基盤v1/v2のAPI、登録設定、VAPID、DB、Dispatcherは変更しない。
- 同じ操作の再試行は同じpayload/URL/requestId。編集・別リスト作成では新ID。再起動時の自動起動・自動再送は禁止。
- 「連携済」は開く操作の受付履歴であり、受信・チェックリスト保存成功ではない。
- Androidを優先。iOSは実機の起動先・保存領域と操作の容易さで判断し、成立しない場合は本連携だけをAndroid限定とする。
- 正式アイコン未提供中は「テンパリスト連携済」の文字ラベルを使う。参考画像の他アプリのアイコンを転用しない。
- UIからlocalStorageや通知APIを直接呼ばない。URLやpayloadをログ・アクセス解析へ出さない。
- 本計画ではローカル実装・自動検証までを扱う。本番公開、公開設定変更、実データを使う実機操作は別途承認・利用者操作を必要とする。

## 実行前の状態と安全な検証

- [ ] `git status --short` と `git diff --cached --name-only` を確認し、開始時から存在する変更を保護する。作業開始時は `task/atoqueue-mvp`、設計コミットは `58a8368`。既存の本番運用記録の未コミット変更を本機能へ混ぜない。
- [ ] AGENTS.md指定順で `docs/requirements.md`、`基本設計サマリ.md`、`docs/data-model.md`、`docs/screens.md`、`docs/api-design.md`、`docs/tasks.md`、MVP計画と本Specを読む。
- [ ] 基準テストを実行する。以後も重い検証は同じホストで並列実行しない。

```powershell
node --version
corepack.cmd pnpm --version
node node_modules/vitest/vitest.mjs run --workspace vitest.workspace.ts --project domain --maxWorkers 1 --minWorkers 1
```

`rg.exe` の起動に失敗する場合は `git grep` / `Select-String` を使う。pnpmのPATH既定値を信用せずCorepack指定版を使う。Playwrightの4173番はテンパリストの既存ローカルサーバーが使っていたため、実行前に確認し、他アプリのプロセスを停止しない。

## 共有インターフェース

以下の型はTask 1/2で定義する。Task 3以降で別名・別構造を再定義しない。

```ts
// packages/domain/src/tempalist-link.ts
export interface TempalistPayload {
  schemaVersion: 1;
  kind: "checklist-create";
  source: "atoqueue";
  requestId: string;
  title: string;
  items: Array<{ sourceTaskId: string; label: string }>;
}
export function validateTempalistPayload(value: unknown): TempalistPayload;
export function buildTempalistUrl(value: unknown): string;

// packages/domain/src/tempalist-transfer.ts
export interface TempalistDraft {
  title: string;
  tasks: Array<{ id: string; title: string; revision: number }>;
}
export interface PreparedTempalistRequest {
  payload: TempalistPayload;
  url: string;
  preparedAt: string;
}
export interface TempalistMarker {
  taskId: string;
  requestId: string;
  lastOpenedAt: string;
}
export interface TempalistState {
  lastRequest: PreparedTempalistRequest | null;
  markers: TempalistMarker[];
}
export function emptyTempalistState(): TempalistState;
export function validateTempalistState(value: unknown): TempalistState;
export function prepareTempalistRequest(input: {
  snapshot: AppSnapshot;
  draft: TempalistDraft;
  requestId: string;
  now: string;
}): PreparedTempalistRequest;
export function markTempalistOpened(input: {
  state: TempalistState;
  request: PreparedTempalistRequest;
  existingTaskIds: readonly string[];
  now: string;
}): TempalistState;

// AppSnapshotの追加フィールド
// schemaVersion: 11;
// tempalist: TempalistState;
```

AppSnapshot型は既存の `model.ts` からimportする。循環依存は型importだけにし、状態関数からrepositoryやReactを参照しない。配列を採用し、元Task IDを通常オブジェクトのプロパティ名として使わない。

### 合成テストデータ

次を `packages/domain/src/tempalist-test-fixture.ts` に作成し、domainのテストでは相対importする。webのテストからは同ファイルへ相対importする（domainの製品用indexからはexportしない）。テスト専用関数であり、製品コードでは呼ばない。

```ts
import { createEmptySnapshot } from "./repository";
export function makeTempalistFixture() {
  const now = "2026-09-11T00:00:00.000Z";
  const requestId = "11111111-1111-4111-8111-111111111111";
  const snapshot = createEmptySnapshot({
    appVersion: "mvp-1.28.0",
    localDeviceId: requestId,
    timeZone: "Asia/Tokyo",
    now,
  });
  snapshot.tasks = ["牛乳を買う", "電池を買う"].map((title, index) => ({
    id: `task-${index}`,
    sourceCaptureId: `capture-${index}`,
    title,
    status: "active",
    dueMode: "unset",
    nextReviewAt: now,
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }));
  snapshot.captures = snapshot.tasks.map((task) => ({
    id: task.sourceCaptureId,
    body: "送信禁止の元記録",
    classification: "task",
    linkedTaskId: task.id,
    createdAt: now,
    updatedAt: now,
    classifiedAt: now,
  }));
  const draft = {
    title: "買い物",
    tasks: snapshot.tasks.map(({ id, title, revision }) => ({
      id,
      title,
      revision,
    })),
  };
  return { snapshot, draft, requestId, now };
}
```

## Task 1: URL契約と実機試験用の最小入口

**Files:**

- Create: `packages/domain/src/tempalist-link.ts`
- Test: `packages/domain/src/tempalist-link.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/web/src/features/tempalist/TempalistLinkProbe.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Create: `docs/operations/tempalist-link-device-check.md`
- Modify: `docs/requirements.md`, `基本設計サマリ.md`, `docs/screens.md`, `docs/tasks.md`

**Interfaces:** Produces `TempalistPayload`, `validateTempalistPayload`, `buildTempalistUrl`。試験画面は固定の合成2項目のみを扱い、repositoryを受け取らない。

- [ ] **Step 1: 要件F-020を追加する。** IDが未使用であることを `git grep -n F-020 -- docs` で確認し、承認済み設計の「明示操作の一方向コピー・元Task非変更・開く操作済み表示」を追加する。既存F-019の通知基盤仕様へ混ぜない。
- [ ] **Step 2: 公開境界の失敗テストを書く。** 次のテストと、不正型、未知フィールド、空白だけの値、ID重複、8000/超過の検査を同ファイルへ追加する。

```ts
import { expect, it } from "vitest";
import { buildTempalistUrl } from "./tempalist-link";
it("F-020 preserves UTF-8, order and opaque IDs without private extras", () => {
  const payload = {
    schemaVersion: 1,
    kind: "checklist-create",
    source: "atoqueue",
    requestId: "11111111-1111-4111-8111-111111111111",
    title: "買い物 🛒",
    items: [
      { sourceTaskId: "milk-1", label: "牛乳🥛\n2本" },
      { sourceTaskId: "milk-2", label: "牛乳🥛\n2本" },
    ],
  };
  const url = buildTempalistUrl(payload);
  expect(new URL(url).search).toBe("");
  expect(
    JSON.parse(
      Buffer.from(url.split("#create=")[1]!, "base64url").toString("utf8"),
    ),
  ).toEqual(payload);
  expect(url.length).toBeLessThanOrEqual(8000);
});
```

- [ ] **Step 3: REDを確認する。** Run: `node node_modules/vitest/vitest.mjs run --workspace vitest.workspace.ts --project domain tempalist-link.test.ts --maxWorkers 1 --minWorkers 1`。新しいexport未実装で失敗することを確認する。
- [ ] **Step 4: strict検証と符号化を実装する。** トップレベルの許可キーはschemaVersion/kind/source/requestId/title/items、項目はsourceTaskId/labelのみ。送信側初版ではnoteを生成しない。UUIDの大文字は小文字化し、ID・labelの内容と改行は変更しない。文字数超過は切り捨てずthrowする。

```ts
export function buildTempalistUrl(value: unknown): string {
  const payload = validateTempalistPayload(value);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const url = "https://tempalist.sikumilab.com/#create=" + encoded;
  if (url.length > 8000) throw new Error("項目を分けて送ってください。");
  return url;
}
```

- [ ] **Step 5: GREENと受信関数の互換を確認する。** 上記コマンドを再実行する。テンパリストのローカル `readChecklistLink` との相互確認は合成データだけで行い、製品コードの依存には追加しない。
- [ ] **Step 6: 最小試験画面を作る。** 固定UUID・固定2項目からURLを作り、通常の `<a href={url}>試験用リストを開く</a>` を表示する。受信先で作成前確認が出ることを説明する。`import.meta.env.DEV` のときだけ `/dev/tempalist-link` routeへ登録し、本番buildには試験入口を出さない。
- [ ] **Step 7: 実機の記録票を作る。** Android/iOS、送受信PWAの起動状態、URLの開き方、保存後の普段のPWAでの再表示、再起動での重複防止を列にする。HTTPS試験配置は承認を得てから行う。実機結果がなくてもTask 2〜6は偽の起動Portで進められるが、正式な起動方式・対応OS・公開可否は確定しない。
- [ ] **Step 8: このTaskの変更だけコミットする。** `git diff --check` 後、上記Filesだけを指定して `git commit -m "feat: add F-020 tempalist URL contract and device probe"`。他タスクの変更は含めない。

## Task 2: 確定内容・連携履歴とschema移行

**Files:**

- Create: `packages/domain/src/tempalist-transfer.ts`
- Create: `packages/domain/src/tempalist-test-fixture.ts`
- Test: `packages/domain/src/tempalist-transfer.test.ts`
- Modify: `packages/domain/src/model.ts`, `repository.ts`, `migrations.ts`, `index.ts`
- Test: `packages/domain/src/repository.test.ts`
- Modify: `docs/data-model.md`

**Interfaces:** Consumes Task 1。Produces共有型のTempalistState/TempalistDraft/PreparedTempalistRequestと3状態関数、AppSnapshot.tempalist。

- [ ] **Step 1: REDテストを書く。** fixturesは `createEmptySnapshot` を使い、実在のTask ID/title/revisionをdraftへ取り込む。確定前変更・削除、0件、ID重複、同名別ID、元Snapshot非変更を検査する。

```ts
const { snapshot, draft, requestId, now } = makeTempalistFixture();
const before = structuredClone(snapshot);
const request = prepareTempalistRequest({ snapshot, draft, requestId, now });
expect(request.payload.items).toEqual(
  draft.tasks.map((t) => ({ sourceTaskId: t.id, label: t.title })),
);
expect(snapshot).toEqual(before);
const marked = markTempalistOpened({
  state: { lastRequest: request, markers: [] },
  request,
  existingTaskIds: snapshot.tasks.map((t) => t.id),
  now,
});
expect(marked.markers.map((m) => m.taskId)).toEqual(
  draft.tasks.map((t) => t.id),
);
expect(
  markTempalistOpened({
    state: marked,
    request,
    existingTaskIds: snapshot.tasks.map((t) => t.id),
    now,
  }).markers,
).toEqual(marked.markers);
```

`makeTempalistFixture` は `./tempalist-test-fixture`、検査関数は `./tempalist-transfer`、expect/itはVitestからimportする。

- [ ] **Step 2: REDを実行する。** Run: `node node_modules/vitest/vitest.mjs run --workspace vitest.workspace.ts --project domain tempalist-transfer.test.ts repository.test.ts --maxWorkers 1 --minWorkers 1`。
- [ ] **Step 3: 状態関数を実装する。** `emptyTempalistState()` は `{lastRequest:null,markers:[]}`。prepareは最新Taskとid/title/revisionを比較し、不一致なら例外、成功ならpayloadとURLのコピーを返す。markはrequestを再検証し、存在する対象IDのマーカーを1件ずつ置換する。対象外マーカーは保持する。lastRequestを別操作の古い値へ巻き戻さない。
- [ ] **Step 4: 旧形式移行と新形式検証を実装する。** schemaVersionを11へ更新し、1〜10は連携領域を空で補う。11ではtempalist領域、日時、ID重複、固定Origin、payloadとURL一致を検査する。旧形式に紛れた未検証tempalistは引き継がない。未知版や破損値を黙って空へ上書きしない。
- [ ] **Step 5: GREENと既存移行を確認する。** 既存fixtureの「最新schemaは10」という期待値だけを11へ更新し、v10の移行fixtureは10のまま残す。`git grep -n 'schemaVersion.*10' -- packages/domain apps/web` で用途を判別し、一括で全て11に置き換えない。
- [ ] **Step 6: データモデルとTask 2の変更をコミットする。** `git commit -m "feat: persist tempalist transfer state in schema 11"`。

## Task 3: 競合安全な保存とバックアップ・復元

**Files:**

- Create: `apps/web/src/application/tempalist-repository.ts`
- Create: `apps/web/src/infrastructure/local-storage/snapshot-write-lock.ts`
- Modify: `apps/web/src/infrastructure/local-storage/local-storage-repository.ts`
- Test: `apps/web/src/infrastructure/local-storage/tempalist-persistence.test.ts`
- Modify: `packages/domain/src/repository.ts`, `packages/domain/src/backup.ts`
- Test: `packages/domain/src/backup.test.ts`
- Modify: `apps/web/src/features/settings/BackupSettings.tsx`
- Test: `apps/web/src/features/settings/BackupSettings.test.tsx`

**Interfaces:**

```ts
export interface TempalistRepository {
  load(): Promise<AppSnapshot>;
  updateTempalist(
    update: (latest: AppSnapshot) => TempalistState,
  ): Promise<TempalistState>;
}
export interface SnapshotWriteLock {
  run<T>(operation: () => T): Promise<T>;
}
// 既存AppRepository.saveへ追加する省略可能な第2引数
// save(next: AppSnapshot, options?: { replaceTempalist?: boolean }): Promise<void>;
```

- [ ] **Step 1: 失敗を再現するテストを書く。** `LocalStorageRepository` に試験用StorageとLockを注入する。古いSnapshotをloadした後にupdateTempalistを行い、その古いSnapshotを通常saveしても連携済が消えないことを検査する。逆順では連携更新が新しいTask編集を消さないことも検査する。

```ts
const stale = await repository.load();
await repository.updateTempalist((latest) => ({
  ...latest.tempalist,
  markers: [marker],
}));
await repository.save(stale);
expect((await repository.load()).tempalist.markers).toEqual([marker]);
```

`marker` は `{taskId:existingTask.id,requestId:"11111111-1111-4111-8111-111111111111",lastOpenedAt:"2026-09-11T00:00:00.000Z"}`。別タブ相当のrepository2個が同じStorage/Lockを共有するケースを追加する。

- [ ] **Step 2: REDを実行する。** Run: `node node_modules/vitest/vitest.mjs run --workspace vitest.workspace.ts --project web tempalist-persistence.test.ts --maxWorkers 1 --minWorkers 1`。
- [ ] **Step 3: ロック内で最新値を読み、連携領域だけを更新する。** Lockのブラウザ実装は同一Originの全Snapshot書込みで同じ名前 `atoqueue:snapshot-write` を使う。処理本体は同期のgetItem→検証→変換→setItemとし、その間にawaitしない。通常save、updateTempalist、clearAppData、明示復元が同じロックを共有する。

```ts
return writeLock.run(() => {
  const latest = readCurrentSnapshot();
  const tempalist = validateTempalistState(update(structuredClone(latest)));
  writeValidatedSnapshot({ ...latest, tempalist, savedAt: now() });
  return structuredClone(tempalist);
});
```

上の `readCurrentSnapshot` / `writeValidatedSnapshot` はLocalStorageRepositoryのprivate helperとして実装し、既存の破損退避とPersistenceError変換を共用する。成功通知は書込み後だけ行う。Web Locks非対応では連携用更新を明確なエラーにし、既存の単独タスク保存機能は維持する。対応を装ったクロスタブ排他の代替は追加しない。

- [ ] **Step 4: 通常saveと復元を区別する。** 通常saveは最新保存値のtempalist（なければempty）を保持し、古い入力から連携領域を復活・消去させない。連携更新はupdateTempalistだけ、バックアップの明示置換だけは `save(restored,{replaceTempalist:true})` で入力の連携状態を採用する。既存のPromise待ちUIと通知同期を回帰確認する。
- [ ] **Step 5: バックアップ往復テストと実装を追加する。** BackupDataは `tempalist:{markers:TempalistMarker[]}` のみを含め、復元時にlastRequestをnullへする。旧バックアップは空履歴。関係のないTask IDや不正日時のマーカーは取り込み拒否。復元後の通知再構築は既存どおりで、本機能から通知の方針を変えない。

`backup.ts` のvalidateDataとsnapshotFromDataでは、schema 11のバックアップをmigrateSnapshotへ渡す前に `tempalist:{markers:data.tempalist.markers,lastRequest:null}` へ展開する。schema 11なのにmarkersが欠落するバックアップは拒否し、schema 10以前だけ空履歴へ移行する。

```ts
const json = await createBackup(snapshot);
const data = JSON.parse(json).payload;
expect(data.tempalist).toEqual({ markers: snapshot.tempalist.markers });
expect(data.tempalist).not.toHaveProperty("lastRequest");
const restored = await restoreBackup({ current, serialized: json, now });
expect(restored.tempalist).toEqual({
  markers: snapshot.tempalist.markers,
  lastRequest: null,
});
```

- [ ] **Step 6: 容量不足・削除・旧データ復元を確認する。** setItem失敗時は既存状態を保持し、成功通知を出さない。端末データ削除で連携も消える。保存と削除・復元の競合で古い連携を復活させない。

通常saveでは、残るTask IDに対応するマーカーだけを保持し、Taskの完全削除で表示履歴を整理する。直前requestは確定内容なので書き換えず、削除済みTaskを含む再試行でもそのTaskのマーカーを復活させない。

- [ ] **Step 7: GREENを実行してコミットする。** domainのbackup.test.tsとwebの上記3ファイルを直列実行。`git commit -m "feat: protect tempalist metadata across saves and backups"`。

## Task 4: 確定・再試行・起動をつなぐapplication service

**Files:**

- Create: `apps/web/src/application/tempalist-transfer-service.ts`
- Test: `apps/web/src/application/tempalist-transfer-service.test.ts`
- Create: `apps/web/src/infrastructure/tempalist/browser-tempalist-launcher.ts`
- Test: `apps/web/src/infrastructure/tempalist/browser-tempalist-launcher.test.ts`

**Interfaces:**

```ts
export interface TempalistLaunchPort {
  open(url: string): void;
}
export interface TempalistTransferService {
  prepare(draft: TempalistDraft): Promise<PreparedTempalistRequest>;
  lastRequest(): Promise<PreparedTempalistRequest | null>;
  open(request: PreparedTempalistRequest): Promise<void>;
}
export function createTempalistTransferService(input: {
  repository: TempalistRepository;
  launcher: TempalistLaunchPort;
  now: () => string;
  requestId: () => string;
}): TempalistTransferService;
```

- [ ] **Step 1: REDテストを書く。** prepareは最新値に対して比較し、同じ未変更draftの多重確定では同じ処理中Promiseを返す。新しい選択フローでのprepareは同内容でも新ID。openは確定済みrequestを再検証して記録保存→起動の順で動く。

```ts
const { snapshot, draft, requestId: uuid, now } = makeTempalistFixture();
const before = structuredClone(snapshot);
let stored = structuredClone(snapshot);
const repository: TempalistRepository = {
  load: async () => structuredClone(stored),
  updateTempalist: async (update) => {
    const tempalist = update(structuredClone(stored));
    stored = { ...stored, tempalist: structuredClone(tempalist) };
    return structuredClone(tempalist);
  },
};
const open = vi.fn();
const service = createTempalistTransferService({
  repository,
  launcher: { open },
  now: () => now,
  requestId: () => uuid,
});
const request = await service.prepare(draft);
expect((await repository.load()).tempalist.markers).toEqual([]);
await service.open(request);
await service.open(request);
expect(open.mock.calls).toEqual([[request.url], [request.url]]);
expect((await repository.load()).tasks).toEqual(before.tasks);
expect((await repository.load()).notificationOutbox).toEqual(
  before.notificationOutbox,
);
```

同テストのvi/expectはVitestから、TempalistRepositoryは `./tempalist-repository` からimportする。共有fixtureは `../../../../packages/domain/src/tempalist-test-fixture` からimportする。多重確定の同一性はtitleとtasksのID/title/revision/順序の一致で判定し、処理終了後は処理中Promiseを破棄する。異なるdraftの同時確定はbusyエラーとし、黙って別の内容のPromiseを返さない。

- [ ] **Step 2: REDを実行する。** Run: `node node_modules/vitest/vitest.mjs run --workspace vitest.workspace.ts --project web tempalist-transfer-service.test.ts --maxWorkers 1 --minWorkers 1`。
- [ ] **Step 3: 最小serviceを実装する。** prepare内でrequestIdを1回発行し、updateTempalistのコールバック内でprepareTempalistRequestを実行する。openは渡されたrequestのコピーを固定し、markTempalistOpenedで最新の履歴を更新してからlauncher.openを呼ぶ。別タブでlastRequestが変わっても古いURLを新しいURLに読み替えない。
- [ ] **Step 4: 失敗・再試行を検査する。** 保存失敗時はopenが0回。launcher例外は受信失敗と断定せず「開く操作を完了できませんでした。同じ内容でもう一度開けます」と案内し、記録済み履歴をロールバックしない。外部通信で結果を問い合わせない。
- [ ] **Step 5: ブラウザadapterの仮実装を隔離する。** 通常遷移は検証済み固定OriginのURLだけを `location.assign(url)` へ渡すPortとして用意する。実機試験でPWA捕捉できなければTask 1の結果をもとにこのadapterと起動UIだけを調整する。非同期window.openへの置換やユーザータップなしの連続起動はしない。実機未確認のadapterを正式対応と報告しない。
- [ ] **Step 6: GREENとコミット。** `git commit -m "feat: add tempalist transfer orchestration and retry"`。

## Task 5: 複数選択・確認・再起動導線

**Files:**

- Modify: `apps/web/src/features/tasks/TaskListPage.tsx`, `TaskListPage.test.tsx`
- Create: `apps/web/src/features/tempalist/TempalistTransferPanel.tsx`
- Create: `apps/web/src/features/tempalist/TempalistTransferPanel.css`
- Test: `apps/web/src/features/tempalist/TempalistTransferPanel.test.tsx`
- Modify: `apps/web/src/app/router.tsx`

**Interfaces:** `TaskListPage`へ省略可能な `tempalist?:TempalistTransferService` を注入し、未注入の旧テストは従来表示のままにする。本番routerでは実serviceを渡す。Panelは `{draft,onChange,onCancel,service}` を受け取り、onChangeはTempalistDraftを返す。

- [ ] **Step 1: REDを追加する。** タスクを2件選択→検索変更→選択件数維持→確認に全2件表示→上下移動→除外→タイトル編集をRTLで検査する。

```tsx
fireEvent.click(screen.getByRole("button", { name: "チェックリストにする" }));
fireEvent.click(screen.getByRole("checkbox", { name: "牛乳を買うを選択" }));
fireEvent.click(screen.getByRole("checkbox", { name: "電池を買うを選択" }));
fireEvent.click(screen.getByRole("button", { name: "内容を確認" }));
expect(screen.getByRole("textbox", { name: "リスト名" })).toHaveValue(
  "あとキューのチェックリスト",
);
expect(screen.getAllByRole("button", { name: /除外/ })).toHaveLength(2);
```

render時は既存TaskListPageテスト同様MemoryRouterで包み、合成Task2件のrepositoryと偽TempalistTransferServiceを注入する。

- [ ] **Step 2: REDを実行する。** Run: `node node_modules/vitest/vitest.mjs run --workspace vitest.workspace.ts --project web TaskListPage.test.tsx TempalistTransferPanel.test.tsx --maxWorkers 1 --minWorkers 1`。
- [ ] **Step 3: 選択と確認状態を実装する。** IDを重複しない配列で保持し、解除後の再選択は末尾にする。通常のリンク操作と選択操作を分け、0件では確認不可。パネルはTask一覧内の別表示として実装し、選択内容をURLクエリ・router historyへ載せない。

確認画面へ「URLには選択したタスク名が含まれます」「元のタスクと通知はあとキューに残ります」を表示する。payloadの値はReactのテキストとして描画し、HTML挿入を使わない。

- [ ] **Step 4: 確定済みと編集を分ける。** 「内容を確定」でprepareを1回実行し、その後に「テンパリストで開く」を表示する。編集へ戻った時点で旧確定データをその編集の送信に使わない。再起動後の「直前の連携をもう一度開く」はlastRequestだけを使う。
- [ ] **Step 5: 長さ・保存待ち・失敗表示を実装する。** 確定前の文字数表示用UUIDには固定長のv4ダミーを使い、実UUIDは確定時だけ発行する。8000超や空タイトルなら確定不可。保存中は多重押下、取消、編集、画面内の切替を抑止し、失敗時は選択と入力を保持して復帰する。
- [ ] **Step 6: 実機試験前の説明を置く。** 公開条件確定まではAndroid優先・iOS未検証を明示し、iOS対応済みとは表示しない。Android限定の判断が出た場合の非対応表示はTask 7で確認する。
- [ ] **Step 7: GREEN、キーボード操作、320px幅を確認してコミットする。** `git commit -m "feat: add task selection and tempalist transfer preview"`。

## Task 6: 共通の連携済バッジ

**Files:**

- Create: `apps/web/src/presentation/TempalistLinkedBadge.tsx`, `TempalistLinkedBadge.css`
- Test: `apps/web/src/presentation/TempalistLinkedBadge.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskListPage.tsx`, `TaskDetailPage.tsx`
- Modify: `apps/web/src/features/review/TodayReviewPage.tsx`
- Test: `apps/web/src/features/review/TodayReviewPage.test.tsx`
- Test: `apps/web/src/features/tasks/TaskDetailPage.test.tsx`

**Interfaces:** `TempalistLinkedBadge({linked:boolean,iconSrc?:string})`。各親画面は最新SnapshotのmarkersからtaskIdを照合し、表示コンポーネントへbooleanだけ渡す。

- [ ] **Step 1: REDを書く。** 未連携ではDOMなし。連携済はボタンではない。アイコン有無で表示ラベルが変わっても、アクセシブル名は「テンパリストへ開く操作済み」で一定。

```tsx
const view = render(<TempalistLinkedBadge linked={false} />);
expect(screen.queryByLabelText("テンパリストへ開く操作済み")).toBeNull();
view.rerender(<TempalistLinkedBadge linked />);
expect(screen.getByLabelText("テンパリストへ開く操作済み")).toHaveTextContent(
  "テンパリスト連携済",
);
expect(screen.queryByRole("button")).toBeNull();
```

- [ ] **Step 2: RED後、最小表示を実装する。** `span`に説明的aria-label、淡い背景・細枠を設定し、文字のコントラストは維持する。アイコンは装飾画像として空alt、小さな固定サイズ。現在は文字だけを表示し、未提供の画像パスは作らない。
- [ ] **Step 3: 一覧・今日・詳細へ配置する。** カテゴリ・日時などの補足情報群に置き、見出しや期限超過表示を押し出さない。Task本体の更新日時・状態をラベル表示のために変えない。
- [ ] **Step 4: GREENと非増殖を確認する。** 同じTaskを再度開いてもラベルが1個、編集・完了・再開後も表示、起動せず確定だけの場合は非表示を確認する。`git commit -m "feat: show unobtrusive tempalist linked badges"`。

## Task 7: 結合・リリース準備・実機判定

**Files:**

- Create: `apps/web/e2e/tempalist-transfer.spec.ts`
- Modify: `apps/web/playwright.config.ts`, `apps/web/e2e/pwa-shell.spec.ts`
- Create: `docs/operations/releases/mvp-1.28.0.md`
- Modify: `docs/operations/tempalist-link-device-check.md`, `docs/tasks.md`, `基本設計サマリ.md`
- Modify: `apps/web/src/app-version.ts`, `apps/api/src/start.ts`, `apps/web/package.json`, `apps/api/package.json`, `packages/domain/package.json`, `packages/contracts/package.json`, `packages/notification-client/package.json`

**Interfaces:** 全Taskの公開UI・repository・URL契約。API契約・通知実装は変更しない。版番号は既存の共通版運用に合わせるが、本番APIの再配置は本計画で実施しない。

- [ ] **Step 1: E2Eのポート競合を解消する。** `playwright.config.ts`で `const port=Number(process.env.ATOQUEUE_E2E_PORT??4173)` を使い、baseURL・webServerポートを揃える。pwa-shellのiOS試験のハードコード4173をfixtureのbaseURLへ置換する。既存サーバーの停止や再利用で対象アプリを取り違えない。
- [ ] **Step 2: E2Eを追加する。** 実際の利用者データを使わず、合成Task2件を選ぶ。起動URLはブラウザ内で受け止め、外部リスト保存をしない。

```ts
await page.route("https://tempalist.sikumilab.com/**", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<p>受信先の試験用画面</p>",
  });
});
await page.getByRole("button", { name: "内容を確定", exact: true }).click();
await Promise.all([
  page.waitForURL("https://tempalist.sikumilab.com/**"),
  page.getByRole("button", { name: "テンパリストで開く", exact: true }).click(),
]);
const openedUrl = page.url();
const payload = JSON.parse(
  Buffer.from(
    new URL(openedUrl).hash.slice("#create=".length),
    "base64url",
  ).toString("utf8"),
);
expect(payload.items).toEqual([
  { sourceTaskId: "task-0", label: "牛乳を買う" },
  { sourceTaskId: "task-1", label: "電池を買う" },
]);
expect(new URL(openedUrl).search).toBe("");
expect(openedUrl.length).toBeLessThanOrEqual(8000);
```

実テストでは採用した起動UIに合わせて完全URLを取得する。通常anchor採用時は `await page.getByRole('link',{name:'テンパリストで開く'}).getAttribute('href')`、location.assign採用時は外部遷移後の `page.url()` でフラグメントを含む値を取得する。待機条件は `page.waitForURL('https://tempalist.sikumilab.com/**')`。外部HTTP request.url()からpayloadを復元する誤ったassertionは書かない。

- [ ] **Step 3: 不変条件を検査する。** 起動前後のTask配列と通知Outbox/reminderMapを比較し一致を確認する。戻る・reloadで連携済維持、同一内容の再試行URL一致、編集時新ID、8000超停止、容量不足で外部起動なしを確認する。
- [ ] **Step 4: 版を更新する。** 現在の1.27.0から、ロジック変更のため1.28.0 / mvp-1.28.0へ更新する。実装開始時に他変更が進んでいればその最新マイナーから採番し、記録ファイル名も揃える。保存schema11とURLschema1を混同しない。
- [ ] **Step 5: 全品質ゲートを直列実行する。** 全件結果・終了コード・実行条件を記録する。E2Eは専用ポートと1workerを使い、必要に応じて最大5ファイルずつに分割する。

```powershell
node node_modules/eslint/bin/eslint.js .
corepack.cmd pnpm -r --workspace-concurrency=1 typecheck
node node_modules/vitest/vitest.mjs run --workspace vitest.workspace.ts --maxWorkers 1 --minWorkers 1
corepack.cmd pnpm -r --workspace-concurrency=1 build
$env:ATOQUEUE_E2E_PORT='4189'
node apps/web/node_modules/@playwright/test/cli.js test --config apps/web/playwright.config.ts --workers=1
node deploy/scripts/verify-deployment-artifacts.mjs
node --test deploy/scripts/deploy-release.test.mjs
git diff --check
```

- [ ] **Step 6: 最小試験の結果を本番用adapterへ反映する。** Androidであとキュー画面からの操作、相手終了時・起動中、普段のPWAと保存領域一致、既存リストの再利用を確認する。iOSで成立しなければ本連携をAndroid限定にする。モバイルエミュレーションだけではOSの実機判定を完了扱いにしない。
- [ ] **Step 7: 完了範囲を分けて記録する。** 「ローカル自動検証済み」「実機確認待ち」「アイコン待ち」「本番未公開」を区別する。実機や配置承認がなければ、その必要事項を利用者へ提示して停止する。リンク受信仕様変更はSpec/fixture/変換モジュールへ戻す。
- [ ] **Step 8: 対象変更だけコミットし、検証記録を渡す。** `git commit -m "test: verify tempalist handoff and prepare 1.28.0"`。本番deploy・API再起動・テンパリストrepoへの書込みは行わない。

## 計画の自己確認

- Spec 1〜4: Task 1/5。Spec 5: Task 2/4/6。Spec 6: Task 2/3。Spec 7: 各Files/Interfaces。Spec 8: Task 1/7。Spec 9: 実機試験と本番公開のゲート。
- モバイル起動の不確実性はTask 1/7の測定対象に隔離し、未検証のまま対応済みとは扱わない。
- 保存競合、復元時の履歴維持と再試行データ除外、元Task非変更を独立したテスト対象にした。
- これは実行前の計画であり、チェック未完了を実装済みとは扱わない。
