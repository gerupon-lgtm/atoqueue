# あとキュー（仮称）通知API設計

## 1. 目的と境界

このAPIはPWAが閉じている間のWeb Push配送だけを担当する。タスク管理APIではない。

保持する: 匿名端末、Push購読、匿名通知予約、配送状態。

保持しない: タスク本文、メモ本文、カテゴリ、タスク期限という意味、完了状態、操作履歴、利用者名、メールアドレス。

## 2. 共通仕様

| 項目         | 仕様                                   |
| ------------ | -------------------------------------- |
| Base path    | `/v1`                                  |
| Content-Type | `application/json`                     |
| 日時         | ISO 8601 UTC                           |
| ID           | UUID v4（【想定】）                    |
| 端末認証     | `Authorization: Bearer <deviceSecret>` |
| 冪等性       | 変更系に `Idempotency-Key` を付与      |
| 最大本文     | 16 KiB（【想定】）                     |
| CORS         | 配信元PWAオリジンだけ許可              |
| ログ         | 本文・購読鍵・Bearer値をマスク         |

サーバー時刻との差が5分を超える要求は拒否せず、`scheduledAt` を絶対時刻として扱う。過去5分以内の予約は即時配送対象、5分より前の予約は `INVALID_SCHEDULE` とする（【想定】）。

## 3. 認証モデル

`POST /v1/devices` だけは未認証で、登録成功時に一度だけ `deviceSecret` を返す。以後は `deviceId` とBearerシークレットを照合する。サーバーはArgon2id等によるハッシュだけを保存する（【想定】）。

MVPでは利用者アカウントを持たないため、端末シークレット紛失時は新しい端末登録として扱い、古い購読はPush配送失敗または保守期限で無効化する。

## 4. エラー形式

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Request validation failed.",
    "requestId": "req_01...",
    "details": [
      { "path": "scheduledAt", "reason": "must be an ISO 8601 UTC timestamp" }
    ]
  }
}
```

| HTTP | code                   | 意味             | クライアント動作                 |
| ---- | ---------------------- | ---------------- | -------------------------------- |
| 400  | `INVALID_REQUEST`      | 形式不正         | Outboxを失敗停止、設定画面に表示 |
| 400  | `INVALID_SCHEDULE`     | 許容外の過去日時 | ローカルで再計算して再送         |
| 401  | `DEVICE_UNAUTHORIZED`  | 認証失敗         | 再登録を案内                     |
| 404  | `DEVICE_NOT_FOUND`     | 端末なし         | 再登録                           |
| 404  | `REMINDER_NOT_FOUND`   | 取消対象なし     | 取消は成功相当としてOutbox削除   |
| 409  | `IDEMPOTENCY_CONFLICT` | 同じキーで別内容 | 新しいキーで状態全体を再同期     |
| 413  | `PAYLOAD_TOO_LARGE`    | 本文過大         | 実装不具合として停止             |
| 429  | `RATE_LIMITED`         | 制限超過         | `Retry-After` 後に再送           |
| 500  | `INTERNAL_ERROR`       | 一時的内部障害   | 指数バックオフ                   |
| 503  | `PUSH_UNAVAILABLE`     | 配送基盤一時障害 | 指数バックオフ                   |

## 5. エンドポイント

### 5.1 GET /healthz

プロセスとDB接続の状態を返す。外部Pushサービスへの毎回の疎通は行わない。

```json
{
  "status": "ok",
  "version": "0.1.0",
  "time": "2026-08-03T09:00:00.000Z"
}
```

### 5.2 GET /v1/push/public-key

VAPID公開鍵を返す。認証不要。

```json
{ "publicKey": "BEl..." }
```

### 5.3 POST /v1/devices

Push購読を登録する。

Request:

```json
{
  "subscription": {
    "endpoint": "https://push.example/...",
    "expirationTime": null,
    "keys": {
      "p256dh": "base64url...",
      "auth": "base64url..."
    }
  }
}
```

Response `201`:

```json
{
  "deviceId": "a1f0f85e-8da5-4bfb-8fc4-938067ca9984",
  "deviceSecret": "one-time-secret",
  "createdAt": "2026-08-03T09:00:00.000Z"
}
```

`deviceSecret` は再表示しない。IP単位とendpoint単位で登録レートを制限する。

### 5.4 PUT /v1/devices/:deviceId/subscription

Push購読更新。端末認証必須。

Requestは登録時の `subscription` と同形。Response `200`:

```json
{
  "deviceId": "a1f0f85e-8da5-4bfb-8fc4-938067ca9984",
  "status": "active",
  "updatedAt": "2026-08-03T09:30:00.000Z"
}
```

### 5.5 DELETE /v1/devices/:deviceId

購読を無効化し、未配送予約を取消す。端末認証必須。成功は `204`。監査に必要な最小レコードは【想定】30日後に物理削除する。

### 5.6 PUT /v1/reminders/:reminderId

予約を作成または全置換する。端末認証必須。

Request:

```json
{
  "deviceId": "a1f0f85e-8da5-4bfb-8fc4-938067ca9984",
  "scheduledAt": "2026-08-06T09:00:00.000Z",
  "notificationType": "unset_due_review"
}
```

許可値:

- `task_review`
- `deadline_review`
- `unset_due_review`

Response `200` または `201`:

```json
{
  "reminderId": "34f55ed6-ddf9-481d-8b49-5b520683a8d8",
  "status": "pending",
  "scheduledAt": "2026-08-06T09:00:00.000Z",
  "updatedAt": "2026-08-03T09:00:00.000Z"
}
```

禁止フィールド `title`、`body`、`taskId`、`category` を受け取った場合は無視せず `INVALID_REQUEST` とする。これにより誤って本文を送る実装を契約テストで検出する。

### 5.7 DELETE /v1/reminders/:reminderId

予約を取消す。端末認証必須。成功は `204`。すでに配送済みの場合も将来予約は残らないため `204` とする（【想定】）。他端末の予約IDは存在を漏らさず `404`。

## 6. Push payload

```json
{
  "type": "review_due",
  "reminderId": "34f55ed6-ddf9-481d-8b49-5b520683a8d8",
  "url": "/today?reminder=34f55ed6-ddf9-481d-8b49-5b520683a8d8"
}
```

通知表示:

```ts
{
  title: "あとキュー",
  body: "確認したい項目があります",
  tag: "atoqueue-review",
  renotify: false,
  data: { url, reminderId }
}
```

タスク本文や期限日はpayloadへ入れない。Service Workerは通知タップ時に同一オリジンの既存ウィンドウをフォーカスし、なければ新規に開く。

## 7. 配送処理

1. 30秒ごとに `status=pending AND scheduled_at<=now` を最大100件取得する（【想定】）。
2. トランザクション内で `claimed` にし、`claimed_at` を記録する。
3. Web Pushへ送信する。
4. 成功時は `sent`、一時失敗時は `pending` に戻して予定を1分、5分、30分後へ移す。
5. 3回失敗で `failed` とする（【想定】）。
6. Push endpointが404/410なら端末購読を `disabled` にし、対象端末の未配送予約を `failed` にする。
7. 10分以上 `claimed` のままのジョブは起動時に `pending` へ戻す。

配送成功はOS表示を保証しない。アプリは起動時に端末内ルールを再計算し、未処理対象を「今日の確認」に表示する。

## 8. セキュリティ・運用

- VAPID秘密鍵、購読鍵、端末シークレットはログへ出さない。
- SQLiteファイルとバックアップはサーバー側暗号化ストレージへ置く（【想定】）。
- HTTPSを必須とする。
- `POST /devices`: IPあたり10回/時、endpointあたり3回/時（【想定】）。
- その他: 端末あたり60回/分（【想定】）。
- CORS許可元、VAPID subject、鍵、DBパスは環境変数化する。
- DBバックアップは日次、7世代保持（【想定】）。タスク本文がないことを運用手順にも明記する。
- requestId、endpointのハッシュ先頭、結果コード、処理時間だけを構造化ログに残す。

## 9. 環境変数

| 変数                | 必須 | 内容                |
| ------------------- | ---- | ------------------- |
| `PORT`              | 任意 | 既定3000            |
| `DATABASE_PATH`     | 必須 | SQLiteファイル      |
| `ALLOWED_ORIGIN`    | 必須 | PWAオリジン         |
| `VAPID_PUBLIC_KEY`  | 必須 | 公開鍵              |
| `VAPID_PRIVATE_KEY` | 必須 | 秘密鍵              |
| `VAPID_SUBJECT`     | 必須 | `mailto:` またはURL |
| `LOG_LEVEL`         | 任意 | 既定info            |

## 10. 契約テスト

- 予約作成に `title` / `body` / `taskId` を含めると400。
- 同じIdempotency-Keyと同じ内容は同じ結果を返す。
- 同じIdempotency-Keyと異なる内容は409。
- 他端末の予約を参照・取消できない。
- 取消済み予約は配送されない。
- 404/410 Push応答で購読が無効になる。
- 一時失敗は規定間隔で再試行される。
- タスク本文らしい文字列がDB・ログ・Push payloadに現れない。

## 11. 要確認事項

- 【要確認】通知バックエンドの本番配置先と永続ボリューム方式
- 【要確認】端末無操作時の購読情報の保持期間
- 【要確認】APIレート制限の初期値
- 【要確認】通知表示のアプリ名を仮称のまま出してよいか
