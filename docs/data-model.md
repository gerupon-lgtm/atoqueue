# あとキュー（仮称）データ設計

## 1. 設計モードと前提

- モード: 新規開発
- 正典: `docs/requirements.md`
- MVPの端末データ保存先: `localStorage`（確定）
- 通知バックエンド: タスク本文を保持しない最小構成（確定）
- 日時の端末内表現: ISO 8601、保存はUTC、表示と週境界判定は端末タイムゾーン（【想定】）
- 週末: 日曜23:59:59（端末ローカル時刻）（【想定】）

## 2. 保存境界

### 2.1 端末内

| キー                | 内容               | 更新単位              | 対応要件                                                                            |
| ------------------- | ------------------ | --------------------- | ----------------------------------------------------------------------------------- |
| `atoqueue:data:v1`  | `AppSnapshot` 全体 | 1操作ごとの一括保存   | F-003,F-004,F-005,F-006,F-007,F-008,F-009,F-010,F-011,F-012,F-014,F-015,F-016,F-017 |
| `atoqueue:draft:v1` | 入力途中の一文     | 入力後300msの遅延保存 | F-002,F-003                                                                         |

1つのスナップショットとして保存し、関連データ間の不整合を避ける。保存前にメモリ上で次状態を完成させ、`localStorage.setItem` を1回だけ呼ぶ。保存失敗時は旧状態を保持し、画面に復旧可能なエラーを表示する。

### 2.2 通知バックエンド

通知バックエンドが保持してよい情報は以下に限定する。

- 匿名の端末ID
- Push購読情報
- 端末シークレットのハッシュ
- 匿名の通知予約ID
- 通知予定時刻
- 通知種別
- 配送状態、試行回数、エラーコード

タスク本文、期限の意味、カテゴリ、完了状態、操作履歴は保持しない。通知予約の予定時刻は送信のために必要だが、それがタスク期限か再確認時刻かをサーバーから識別できない設計とする。

## 3. 端末内モデル

### 3.1 AppSnapshot

```ts
export interface AppSnapshot {
  schemaVersion: 7;
  appVersion: string;
  device: DeviceState;
  settings: Settings;
  captures: Capture[];
  tasks: Task[];
  reviewSessions: ReviewSession[];
  actionHistory: ActionEvent[];
  notificationOutbox: NotificationOutboxItem[];
  reminderMap: ReminderMapEntry[];
  savedAt: string;
}
```

### 3.2 DeviceState / Settings

```ts
export interface DeviceState {
  localDeviceId: string;
  pushDeviceId?: string;
  pushDeviceSecret?: string;
  pushSubscriptionStatus:
    "not_requested" | "granted" | "denied" | "unavailable";
  registeredAt?: string;
}

export interface Settings {
  locale: "ja-JP";
  timeZone: string;
  notificationEnabled: boolean;
  initialReminderDelayMinutes: number;
  deadlineReminderLeadMinutes: number;
  /** 日付だけで期限を指定したときの端末ローカル時刻。 */
  defaultDeadlineTime: string;
  /** 初回チュートリアルを閉じた端末内日時。未設定なら新規利用者へ表示する。 */
  onboardingCompletedAt?: string;
  quietHours?: { start: string; end: string };
  weeklyReviewDay: 0;
  /** 未整理の受信箱全体に対する再通知頻度。 */
  inboxReminderFrequency: "none" | "gentle" | "prompt";
  /** note に分類したメモ一覧全体に対する棚卸し頻度。 */
  memoReviewFrequency: "none" | "weekly" | "monthly";
  /** true のとき Enter で記録し、Shift+Enter は改行とする。 */
  enterSavesCapture: boolean;
  /** 端末内だけに保持する、利用者が追加したタスクカテゴリ。最大10件。 */
  customTaskCategories: string[];
}
```

`pushDeviceSecret` は端末内だけに保存し、JSONバックアップには含めない。`weeklyReviewDay: 0` は日曜日を表す。【想定】`quietHours` は初期値なしとし、MVPでは設定画面に公開しない。

`customTaskCategories` は前後空白除去後1〜12文字、最大10件、一意とする。プリセット `仕事 / 家 / 買い物 / その他` と同名の追加は禁止する。削除は設定上の選択肢から外す操作であり、既存Taskに保存済みのカテゴリ文字列は変更しない。同じ名前を再登録した場合は、そのカテゴリを再び有効な選択肢として扱う。

`dueAt` は利用者が選んだ端末ローカルの日付・任意時刻をUTCへ変換して保存する。時刻を選ばなかった場合はその日の23:59を使う。表示と日付境界の判定は `settings.timeZone` を使う。

### 3.3 Capture

```ts
export interface Capture {
  id: string;
  body: string;
  classification: "unclassified" | "task" | "note" | "unneeded";
  createdAt: string;
  updatedAt: string;
  classifiedAt?: string;
  linkedTaskId?: string;
}
```

制約:

- `body`: 前後空白を除いて1〜280文字（【想定】）
- `classification="task"` のとき `linkedTaskId` が必須
- 保存直後は必ず `unclassified`
- 自動分類結果だけで `task` へ更新しない
- `unneeded` は自動削除せず、利用者が完全削除するか端末データを全削除するまで保持する
- `unneeded` から `unclassified` へ戻す場合は `classifiedAt` と `linkedTaskId` を除去し、分類履歴を追加して受信箱通知系列を再構築する
- 完全削除は `unneeded` だけに許可し、対象CaptureとそのCaptureに属する操作履歴だけを端末内から削除する
- 受信箱は `unclassified`、`note`、`unneeded` だけを表示し、`task` は件数にも含めない
- `unneeded` の経路バッジは保存項目を増やさず、直近の分類サイクルにある `capture_classified` 履歴から `未整理から` または `メモから` を導出する
- 一括復元・一括完全削除は全対象を事前検証し、1件でも不正なら変更しない。通知系列は変更後のSnapshotに対して1回だけ再構築する

### 3.4 Task

```ts
export interface Task {
  id: string;
  sourceCaptureId: string;
  title: string;
  category?: "work" | "home" | "shopping" | "other";
  status: "active" | "completed" | "archived";
  dueMode: "unset" | "scheduled" | "none";
  dueAt?: string;
  nextReviewAt: string;
  undecidedCount: number;
  dismissCount: number;
  postponeCount: number;
  lastPromptedAt?: string;
  completedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
```

制約:

- `sourceCaptureId` は端末内で一意。1キャプチャから作れるタスクは最大1件。
- `dueMode="scheduled"` のときだけ `dueAt` が必須。
- `dueMode="none"` は利用者が「期限なし」を明示した状態。
- `dueMode="unset"` は未回答状態であり、期限設定の再確認対象。
- `status="completed"` のとき `completedAt` が必須。
- `status="archived"` のとき `archivedAt` が必須。
- `revision` は編集ごとに増加し、履歴と通知同期の競合検知に使う。

期限超過は状態として保存せず、`status="active" && dueMode="scheduled" && dueAt < now` で導出する。

### 3.5 放置レベル

```ts
export type NeglectLevel = 0 | 1 | 2 | 3 | 4;
```

放置レベルは保存せず、以下の順で毎回導出する。境界は初期値であり、7日間試用後に調整する（【想定】）。

| レベル | 条件（いずれか）                                                 | 声掛けの意図                           |
| ------ | ---------------------------------------------------------------- | -------------------------------------- |
| 0      | 作成24時間未満、期限前、見送り0回                                | 軽く確認する                           |
| 1      | 作成24時間以上、期限当日、見送り1回                              | 次の一手を選ばせる                     |
| 2      | 期限超過1〜3日、見送り1回、期限未設定の再確認2回目               | 経過事実と状態更新を促す               |
| 3      | 期限超過4〜7日、見送り2回以上                                    | 残すか判断するよう促す                 |
| 4      | 期限超過8日以上、延期・無反応が継続、期限未設定の再確認3回目以降 | 完了・再設定・アーカイブを明確に決める |

複数条件に該当する場合は最大レベルを採用する。OS通知を閉じた回数は取得できないため、`dismissCount` へ加算しない。

### 3.6 ReviewSession

```ts
export interface ReviewSession {
  id: string;
  localDate: string;
  orderedTaskIds: string[];
  currentIndex: number;
  visitedTaskIds: string[];
  answeredTaskIds: string[];
  /** このセッションの回答操作が作成した ActionEvent のID */
  actionEventIds: string[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

セッション開始時に対象順を固定する。回答後に次へ進んでも `currentIndex` を減らして前のタスクへ戻れる。完了後の修正はタスク詳細または当日の結果画面から行い、新しい履歴を追加する。

### 3.7 ActionEvent

```ts
export type ActionType =
  | "capture_created"
  | "capture_classified"
  | "task_created"
  | "task_completed"
  | "task_rescheduled"
  | "task_marked_no_due"
  | "task_dismissed"
  | "task_archived"
  | "task_edited"
  | "task_reopened"
  | "backup_exported"
  | "backup_restored";

export interface ActionEvent {
  id: string;
  entityType: "capture" | "task" | "settings" | "backup";
  entityId: string;
  action: ActionType;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  occurredAt: string;
}
```

履歴は追記専用とし、通常操作では削除しない。バックアップ容量抑制のため、【想定】90日を超えた履歴はエクスポート後に明示操作で圧縮できるが、MVP初期画面には公開しない。

### 3.8 通知同期モデル

```ts
export interface NotificationOutboxItem {
  id: string;
  operation: "upsert" | "cancel";
  reminderId: string;
  scheduledAt?: string;
  notificationType?:
    "inbox_review" | "task_review" | "deadline_review" | "unset_due_review";
  /** 省略時は一回限り。サーバーへ送ってよい繰り返し情報だけを表す。 */
  repeatCadence?: "weekly" | "monthly";
  taskRevision: number;
  attemptCount: number;
  nextAttemptAt: string;
  createdAt: string;
}

export interface ReminderMapEntry {
  reminderId: string;
  taskId?: string;
  captureId?: string;
  /** 受信箱・メモ一覧の全体予約。局所IDはサーバーへ送らない。 */
  scope?: "inbox" | "memo";
  kind?: "capture_initial" | "initial" | "deadline_before" | "review";
  taskRevision: number;
  createdAt: string;
}
```

`reminderId` は推測困難なUUIDとする。マッピングは `taskId`、`captureId`、`scope` のいずれか一つだけを所有者として持つ。サーバーはこれらのローカルIDを受け取らない。Push payloadの `reminderId` を端末側の `ReminderMapEntry` で解決し、解決できない場合は「今日の確認」全体を開く。1タスクは `initial`、`deadline_before`、`review` の最大3件を持ち、完了・アーカイブ時は全件を取消す。

## 4. リマインド計算規則

### 4.1 期限未設定

| 操作                      | 次回確認                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------- |
| タスク化時に未回答        | 3日後の23:59（実装済み。再確認時刻は今後の試用で調整可能）                         |
| 「まだ決めない」1〜2回目  | 3日後                                                                              |
| 「まだ決めない」3回目以降 | 翌週日曜18:00（【想定】）                                                          |
| 「期限なし」              | 期限設定確認は停止。次の日曜18:00の通常週次見直しだけ対象（日曜18:00以降なら翌週） |

### 4.2 期限超過または見送り

| 見送り回数 | 次回確認 |
| ---------- | -------- |
| 1回目      | 1日後    |
| 2回目      | 3日後    |
| 3回目      | 7日後    |
| 4回目以降  | 7日後    |

期限を変更した場合は `dismissCount` を0へ戻す。完了・アーカイブでは通知予約を取消す。過去日を新期限として保存しようとした場合は確認を表示する。

### 4.3 通知時刻と全体再通知（2026-08-09確定）

- 【確定】初回通知は、利用者が設定した作成後の分数で予約する。初期値は60分。
- 【確定】期限ありタスクの初回通知は期限より前に到来する場合だけ保持する。期限と同時刻または期限後なら初回予約を省略し、期限時の `review` 予約だけを残す。期限なし・期限未設定タスクにはこの抑制を適用しない。期限または初回通知設定の変更で不要になった既存の初回予約は取消Outboxへ積む。
- 【確定】未整理記録が一件以上ある場合、個々の記録ではなく受信箱全体の匿名予約系列を一つだけ持つ。最も古い未整理記録の作成日時と「初回通知まで」から初回を決め、新しい記録の追加では既存時刻を前倒し・リセットしない。
- 【確定】受信箱の再通知は `none`（初回のみ）、`gentle`（3日後、7日後、以降週1回）、`prompt`（1日後、3日後、7日後、以降週1回）から選ぶ。新規端末の初期値は `gentle`、v6からの移行値は `none` である。未整理が0件になれば系列全件を取消す。
- 【確定】`note` のメモ棚卸しもメモ一覧全体の匿名予約系列を一つだけ持つ。最も古いメモを基準に、`weekly` は7日後から週ごと、`monthly` は14日後からUTC暦月ごと（各月末へクランプ）に繰り返す。メモが0件になれば取消す。新規端末の初期値は `weekly`、移行値は `none` である。
- 【確定】利用者が記録をタスク化・メモ化・不要化したときは、全体予約を再計算する。タスク候補は自動確定しない。
- 【確定】通知予約とPush購読は端末単位で扱う。MVPではタスク本文・タスク状態を端末間同期しないため、ある端末で作ったタスクの通知を別端末へ配送しない。
- 【確定】端末データ削除では、保存済みの匿名端末識別子と秘密値でサーバー側のPush端末登録を先に無効化する。無効化に失敗した場合はローカルのスナップショットを消さず、再試行できるようにする。無効化後はブラウザのPush購読もベストエフォートで解除する。
- 【確定】期限ありタスクは、利用者が設定した期限前の分数で予約する。初期値は60分。期限時は通常の `review` 予約を使う。
- 【確定】設定は端末全体に適用する。頻度変更は明示保存時にのみ、古い全体予約を取消して新頻度で組み直す。通知設定前に保存した未整理記録は、設定完了時に初回通知時刻を過ぎていれば直ちに予約する。
- 【確定】サーバーへ送るのは匿名予約ID、予定時刻、通知種別、繰り返し間隔、端末IDだけであり、タスクID・キャプチャID・本文・期限の意味は送らない。
- 【確定】同一通知種別・同一予定時刻の複数予約は、`notification_type` と `scheduled_at` から作る16桁の匿名SHA-256接頭辞をPushの `groupId` として共有し、一つのOS通知へ集約する。通知種別または予定時刻が異なる場合は別の `groupId` とし、以前の通知を静かに上書きしない。`groupId` にタスク本文・局所ID・期限内容を含めない。
- 【確定】匿名Pushの配送属性は全通知共通で `urgency=high`、`TTL=86400` 秒とする。配送後は短い振動を要求するが、通知予約・端末データへ新たな私的属性を保存しない。

## 5. サーバーデータモデル

### 5.1 device_subscriptions

| 列                | 型        | 制約・用途                            |
| ----------------- | --------- | ------------------------------------- |
| `id`              | TEXT      | UUID、主キー                          |
| `device_id`       | TEXT      | UUID、一意                            |
| `endpoint`        | TEXT      | Push endpoint、一意、暗号化保存を推奨 |
| `p256dh`          | TEXT      | Push暗号鍵                            |
| `auth`            | TEXT      | Push認証情報                          |
| `secret_hash`     | TEXT      | 端末シークレットのハッシュ            |
| `status`          | TEXT      | `active` / `disabled`                 |
| `created_at`      | TEXT      | UTC                                   |
| `updated_at`      | TEXT      | UTC                                   |
| `last_error_code` | TEXT NULL | 直近の配送エラー                      |

### 5.2 reminder_jobs

| 列                  | 型        | 制約・用途                                              |
| ------------------- | --------- | ------------------------------------------------------- |
| `id`                | TEXT      | `reminderId`、主キー                                    |
| `device_id`         | TEXT      | `device_subscriptions.device_id` 外部キー               |
| `scheduled_at`      | TEXT      | UTC、検索索引                                           |
| `notification_type` | TEXT      | 汎用通知種別                                            |
| `repeat_cadence`    | TEXT NULL | `weekly` / `monthly`。NULLは一回限り                    |
| `status`            | TEXT      | `pending` / `claimed` / `sent` / `cancelled` / `failed` |
| `idempotency_key`   | TEXT      | 一意                                                    |
| `attempt_count`     | INTEGER   | 0以上                                                   |
| `claimed_at`        | TEXT NULL | 配送競合防止                                            |
| `sent_at`           | TEXT NULL | 配送API成功時刻                                         |
| `last_error_code`   | TEXT NULL | 安定した内部エラーコード                                |
| `created_at`        | TEXT      | UTC                                                     |
| `updated_at`        | TEXT      | UTC                                                     |

### 5.3 reminder_idempotency_operations

| 列                    | 型   | 制約・用途                                                         |
| --------------------- | ---- | ------------------------------------------------------------------ |
| `device_id`           | TEXT | `device_subscriptions.device_id`、複合主キーの一部                 |
| `reminder_id`         | TEXT | 匿名通知予約ID、複合主キーの一部                                   |
| `idempotency_key`     | TEXT | クライアント操作キー、複合主キーの一部                             |
| `request_fingerprint` | TEXT | 同一キーで異なる要求を409にする要求フィンガープリント              |
| `response_body`       | TEXT | 予約ID・予定時刻・通知種別などの最小応答JSON。タスク本文は含めない |
| `created_at`          | TEXT | UTC                                                                |

主キーは `(device_id, reminder_id, idempotency_key)` とする。予約を後から全置換しても、この操作履歴の応答は変更しない。通知DB消失時は他の通知メタデータと同様に失われ、端末側の有効予約から再同期する。

### 5.4 device_idempotency_operations

| 列                    | 型        | 制約・用途                                                   |
| --------------------- | --------- | ------------------------------------------------------------ |
| `device_id`           | TEXT      | `device_subscriptions.device_id` 外部キー、複合主キーの一部  |
| `operation`           | TEXT      | `subscription_update` / `device_delete`、複合主キーの一部    |
| `idempotency_key`     | TEXT      | クライアント操作キー、複合主キーの一部                       |
| `request_fingerprint` | TEXT      | 同じキーで異なる要求を409にするSHA-256フィンガープリント     |
| `response_status`     | INTEGER   | 再送時に返すHTTP結果コード                                   |
| `response_body`       | TEXT NULL | 再送時に返す端末メタデータだけのJSON。タスク本文は保存しない |
| `created_at`          | TEXT      | UTC                                                          |

端末購読の更新・無効化を再送安全にするサーバー専用メタデータであり、主キーは `(device_id, operation, idempotency_key)` とする。予約やタスク本文を保持せず、端末購読と同じ通知DBの保持・消失復旧方針に従う。

サーバーはOCI VPS上の単一Fastify systemdサービスを前提に、専用PostgreSQL DB `atoqueue_notify` から5分ごとに期限到来ジョブを最大100件取得する。ジョブ取得はPostgreSQLのトランザクションと行ロックを用いて競合を防ぐ。`DEADLINE_DELIVERY_LEAD_SECONDS`（初期値300秒）だけ先の予約までclaimし、期限前に配送を試行する。専用ロールは `atoqueue_notify_app`、スキーマは既定 `public`（【想定】）とする。一時失敗は5分、15分、60分後に再試行し、3回失敗で `failed` にする。15分以上 `claimed` のジョブは起動時に `pending` へ戻す。

通知DBはMVPで外部バックアップを構成しない。DB消失または端末認証が復旧不能になった場合、クライアントは保存済みのサーバー端末ID・シークレットを破棄して新規端末登録を行い、端末内の有効な `ReminderMap` から予約を再同期する。タスク本文などの端末内データはこの処理で失わない。

## 6. バックアップ形式

```ts
export interface BackupEnvelopeV1 {
  format: "atoqueue-backup";
  version: 1;
  exportedAt: string;
  appVersion: string;
  payload: Omit<
    AppSnapshot,
    "device" | "notificationOutbox" | "reminderMap"
  > & {
    device: Pick<DeviceState, "localDeviceId">;
  };
  checksum: string;
}
```

- Push購読情報、端末シークレット、通知送信待ちは出力しない。
- 復元前に形式、バージョン、チェックサム、各エンティティの制約を検証する。
- 復元は既存データを置き換えるため、件数差分を表示して明示確認を取る。
- 追加カテゴリを含む設定はバックアップ対象とする。
- 復元先の端末固有情報を維持し、有効タスク、未整理の受信箱、メモ棚卸しの通知予約を再計算する。
- 同じバックアップを再度復元しても、Capture・Task・履歴を追加せず同じ内容へ洗い替える。

## 7. 移行・破損時の扱い

1. `schemaVersion` が既知なら純粋関数で段階移行する。
   - v1 → v2: 各 `ReviewSession` に空の `actionEventIds` を追加する。既存の操作履歴を推測で再帰属しない。
   - v2: `answeredTaskIds` は `orderedTaskIds` の部分集合、`actionEventIds` は実在する一意なタスク操作履歴であり、当該セッションの処理済みタスクを参照することを検証する。
   - v3 → v4: 既存端末には `onboardingCompletedAt` として保存日時を設定し、既存利用者へ初回チュートリアルを再表示しない。v4の新規端末は未設定のまま開始し、案内を閉じた時だけ設定する。
   - v4 → v5: 日付だけの期限に使う `defaultDeadlineTime` を `23:59` で補う。
   - v5 → v6: 受信箱リマインドのローカル対応情報を扱える形式へ移行する。既存の未整理記録は次回の通知設定または時刻設定変更時に匿名予約を作成する。
   - v6 → v7: 受信箱再通知を `none`、メモ棚卸しを `none`、Enter登録を `true` で補う。新規スナップショットは `gentle`、`weekly`、`true` で開始する。全体予約は `ReminderMapEntry.scope` で表す。
   - v7 → v8: `customTaskCategories` を空配列で補い、Taskのカテゴリをプリセット限定型から文字列へ拡張する。既存Taskのカテゴリ値は保持する。
2. 新しい未知バージョンは上書きせず、読み取り停止とJSON退避を案内する。
3. JSON解析失敗時は破損値を別キー `atoqueue:corrupt:<timestamp>` へ退避して初期化可否を確認する。
4. 破損復旧や復元では元データを直ちに削除しない。

## 8. 要件トレーサビリティ

| 設計領域           | 要件ID                                                 |
| ------------------ | ------------------------------------------------------ |
| キャプチャ、下書き | F-002,F-003,NF-001,NF-002                              |
| 受信箱、候補化     | F-004,F-005                                            |
| 期限、再確認       | F-006,F-007,F-008,F-009,F-010,F-011                    |
| 今日の確認         | F-012,F-013,F-014,F-015                                |
| 履歴、バックアップ | F-016,F-017,NF-006,NF-008                              |
| 通知サーバー       | F-013,NF-003,NF-004,NF-005,NF-007,NF-009,NF-010,NF-013 |

## 9. 要確認事項

- 【要確認】一文の上限280文字で実利用を妨げないか
- 【要確認】「今週中」を日曜23:59とすることが利用者感覚に合うか
- 【要確認】週次確認を日曜18:00とする初期値が適切か
- 【要確認】90日超の履歴圧縮がMVP後に必要か
