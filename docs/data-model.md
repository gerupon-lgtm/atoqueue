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
  schemaVersion: 1;
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
  quietHours?: { start: string; end: string };
  weeklyReviewDay: 0;
}
```

`pushDeviceSecret` は端末内だけに保存し、JSONバックアップには含めない。`weeklyReviewDay: 0` は日曜日を表す。【想定】`quietHours` は初期値なしとし、MVPでは設定画面に公開しない。

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
export type NeglectLevel = 0 | 1 | 2 | 3;
```

放置レベルは保存せず、以下の順で毎回導出する。境界は初期値であり、7日間試用後に調整する（【想定】）。

| レベル | 条件（いずれか）                                            | 声掛けの意図                     |
| ------ | ----------------------------------------------------------- | -------------------------------- |
| 0      | 作成24時間未満、期限前、見送り0回                           | 軽く確認する                     |
| 1      | 作成24時間以上、期限当日、見送り1回                         | 次の一手を選ばせる               |
| 2      | 期限超過1〜6日、見送り2〜3回、期限未設定の再確認2回目       | 具体的な日付か処理を求める       |
| 3      | 期限超過7日以上、見送り4回以上、期限未設定の再確認3回目以降 | 完了・再設定・不要を明確に決める |

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
  notificationType?: "task_review" | "deadline_review" | "unset_due_review";
  taskRevision: number;
  attemptCount: number;
  nextAttemptAt: string;
  createdAt: string;
}

export interface ReminderMapEntry {
  reminderId: string;
  taskId: string;
  taskRevision: number;
  createdAt: string;
}
```

`reminderId` は推測困難なUUIDとする。サーバーは `taskId` を受け取らない。Push payloadの `reminderId` を端末側の `ReminderMapEntry` で解決する。解決できない場合は「今日の確認」全体を開く。

## 4. リマインド計算規則

### 4.1 期限未設定

| 操作                      | 次回確認                                     |
| ------------------------- | -------------------------------------------- |
| タスク化時に未回答        | 3日後の同時刻（【想定】）                    |
| 「まだ決めない」1〜2回目  | 3日後                                        |
| 「まだ決めない」3回目以降 | 翌週日曜18:00（【想定】）                    |
| 「期限なし」              | 期限設定確認は停止。通常の週次見直しだけ対象 |

### 4.2 期限超過または見送り

| 見送り回数 | 次回確認                  |
| ---------- | ------------------------- |
| 1回目      | 1日後                     |
| 2回目      | 3日後                     |
| 3回目      | 7日後                     |
| 4回目以降  | 翌週日曜18:00（【想定】） |

期限を変更した場合は `dismissCount` を0へ戻す。完了・不要では通知予約を取消す。過去日を新期限として保存しようとした場合は確認を表示する。

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
| `status`            | TEXT      | `pending` / `claimed` / `sent` / `cancelled` / `failed` |
| `idempotency_key`   | TEXT      | 一意                                                    |
| `attempt_count`     | INTEGER   | 0以上                                                   |
| `claimed_at`        | TEXT NULL | 配送競合防止                                            |
| `sent_at`           | TEXT NULL | 配送API成功時刻                                         |
| `last_error_code`   | TEXT NULL | 安定した内部エラーコード                                |
| `created_at`        | TEXT      | UTC                                                     |
| `updated_at`        | TEXT      | UTC                                                     |

サーバーは単一稼働インスタンスを前提に30秒ごとに期限到来ジョブを取得する（【想定】）。将来水平分割する場合は、SQLiteから行ロック可能なDBへ移行する。

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
- 復元後は端末固有情報を維持し、全タスクの通知予約を再計算する。

## 7. 移行・破損時の扱い

1. `schemaVersion` が既知なら純粋関数で段階移行する。
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
