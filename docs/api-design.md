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
  "version": "mvp-1.24.0",
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
  "notificationType": "inbox_review",
  "repeatCadence": "weekly"
}
```

許可値:

- `inbox_review`（未整理記録の受信箱リマインド。Pushタップ先は受信箱）
- `task_review`
- `deadline_review`
- `unset_due_review`

Requestの `repeatCadence` は省略時だけ一回限りとし、`null` は受け付けない。指定時は `daily`、`weekly`、`monthly` だけを許可する。Responseの `repeatCadence` は一回限りなら `null` を返す。これは匿名系列の配送後に次回予約へ進めるための値であり、タスク・キャプチャ・メモのローカルIDは受け取らない。`daily` は期限超過タスクの「こまめ」系列、`weekly` は受信箱・メモ・期限超過タスクの週次系列に使える。

端末側は受信箱・メモの全体系列で対応する予約枠が存続する場合、同じ `reminderId` に新しい予定時刻を `PUT` して全置換する。新規未整理の追加で予約数が変わらない場合は、旧予約を `DELETE` してから別IDを作る手順を使わない。系列からなくなった余剰枠だけを `DELETE` する。APIの項目とDB形式は変更しない。

Response `200` または `201`:

```json
{
  "reminderId": "34f55ed6-ddf9-481d-8b49-5b520683a8d8",
  "status": "pending",
  "scheduledAt": "2026-08-06T09:00:00.000Z",
  "repeatCadence": "weekly",
  "updatedAt": "2026-08-03T09:00:00.000Z"
}
```

禁止フィールド `title`、`body`、`taskId`、`captureId`、`category` を受け取った場合は無視せず `INVALID_REQUEST` とする。これにより誤って本文・局所IDを送る実装を契約テストで検出する。

予約PUTの冪等性記録は端末ID・予約ID・`Idempotency-Key`・要求フィンガープリント・予約応答だけを不変に保存する。後続の予約更新は過去の冪等性応答を変更しない。

認証後、過去時刻の検証より先に既存の冪等性記録を照合する。同一要求の再送は予定時刻から5分以上経過していても初回の応答を返し、送信済み・取消済み・次回へ進んだ予約を再び有効にしない。同じキーで異なる内容は `IDEMPOTENCY_CONFLICT`、未登録の過去時刻だけを `INVALID_SCHEDULE` とする。DB形式・送信項目は変更しない。

端末側では、全体系列の `INVALID_SCHEDULE` はその未登録枠だけを修復する。一回限りの過去枠は破棄し、繰り返し枠は元の間隔に沿う次の未来時刻へ進める。全系列を現在時刻で作り直さない。全体系列の `IDEMPOTENCY_CONFLICT` では失敗した操作キーだけを更新し、他の予約を維持する。

### 5.7 DELETE /v1/reminders/:reminderId

予約を取消す。端末認証必須。クエリ文字列に所有端末を明示する `deviceId`（UUID）を必須で指定する。例: `DELETE /v1/reminders/:reminderId?deviceId=<deviceId>`。成功は `204`。すでに配送済みの場合も将来予約は残らないため `204` とする（【想定】）。他端末の予約IDは存在を漏らさず `404`。

## 6. Push payload

```json
{
  "type": "review_due",
  "reminderId": "34f55ed6-ddf9-481d-8b49-5b520683a8d8",
  "url": "/today?reminder=34f55ed6-ddf9-481d-8b49-5b520683a8d8",
  "groupId": "0240ed4ae646d5c0"
}
```

通知表示:

```ts
{
  title: "あとキュー",
  body: "確認したい項目があります",
  tag: `atoqueue-review-${groupId}`,
  renotify: false,
  data: { url, reminderId }
}
```

`groupId` は `notification_type`、NUL区切り、`scheduled_at` のSHA-256先頭16桁とする。同じ通知種別・予定時刻の予約は同じタグへ集約し、異なる種別・時刻は別タグで新しく通知する。移行中は `groupId` のない従来payloadも受理し、固定タグへフォールバックする。タスク本文、メモ本文、期限、カテゴリ、タスクID、キャプチャIDはpayloadへ入れない。Service Workerは通知タップ時に同一オリジンの既存ウィンドウをフォーカスし、なければ新規に開く。

Pushサービスへの送信オプションは `urgency="high"`、`TTL=86400` 秒とする。Service Workerは `vibrate=[200,100,200]` を要求する。これらは配送・注意喚起の要望であり、OSのサイレント／おやすみモード、ブラウザの通知許可、電池制御を回避せず、正確な配送時刻を保証しない。`silent` と `requireInteraction` は指定しない。

## 7. 配送処理

【確定】配送ポーリングは5分ごとに行う。`DEADLINE_DELIVERY_LEAD_SECONDS`（初期値300秒）を先読みして予約をclaimし、ネットワークやOS都合の遅延を見込んで期限前にPush送信を試行する。これは正確な到達時刻の保証ではない。

1. 5分ごとに `status=pending AND scheduled_at<=now` を最大100件取得する。
2. トランザクション内で `claimed` にし、`claimed_at` を記録する。
3. Web Pushへ送信する。
4. 一回限りの成功時は `sent`。`repeatCadence` を持つ成功時は同じ匿名予約を `pending` に戻し、実際の配送時刻ではなく直前の予定時刻を基準に、`daily` は24時間後、`weekly` は7日後、`monthly` はUTC暦月を一つ進めた同日（存在しない日は月末）へ移す。一時失敗時は `pending` に戻して予定を5分、15分、60分後へ移す。
5. 3回失敗で `failed` とする。
6. Push endpointが404/410なら端末購読を `disabled` にし、対象端末の未配送予約を `failed` にする。この場合、繰り返し予約も次回へ進めない。
7. 15分以上 `claimed` のままのジョブは起動時に `pending` へ戻す。

配送成功はOS表示を保証しない。アプリは起動時に端末内ルールを再計算し、未処理対象を「今日の確認」に表示する。

## 8. セキュリティ・運用

- VAPID秘密鍵、購読鍵、端末シークレットはログへ出さない。
- 通知データはOCI VPS上で稼働中のPostgreSQLの専用DB `atoqueue_notify` へ保存する。アプリ接続ロールは `atoqueue_notify_app`、スキーマは既定 `public`（【想定】）とする。
- HTTPSを必須とする。
- `POST /devices`: IPあたり10回/時、endpointあたり3回/時（【想定】）。
- その他: 端末あたり60回/分（【想定】）。
- CORS許可元は `https://atoqueue.sikumilab.com` に固定し、VAPID subject、鍵、PostgreSQL接続URLは環境変数化する。
- VAPID subjectは `mailto:gerupon@gmail.com` とする。秘密鍵、DB接続情報、許可オリジンはVPSの `/etc/atoqueue/notification-api.env` だけに置き、rootだけが読める権限にする。
- OCI Object Storage連携・定期DBバックアップはMVP対象外とする。DB消失時はクライアントが新規端末登録と有効予約の再同期を行う。DBスキーマ変更の直前は必要に応じて管理者が手動で `pg_dump` を取得する。
- `requestId`、購読がある要求だけのendpoint SHA-256先頭12桁、HTTP結果コード、処理時間だけを構造化ログに残す。endpointがない要求ではハッシュ値は未定義とし、本文、URL、購読鍵、Bearer値は記録しない。専用ログは日次圧縮ローテーションで30日保持し、1日10MBを目安とする。
- Fastifyは将来 `127.0.0.1:3030` で待受し、Caddyが `https://api.atoqueue.sikumilab.com` のHTTPS終端とリバースプロキシを担う。実行エントリポイントと待受開始はTask 11の `apps/api/src/start.ts` で実装予定であり、Task 10では追加しない。Cloudflare DNSは最初はDNSのみ（プロキシなし）とする。

## 9. 環境変数

| 変数                | 必須 | 内容                             |
| ------------------- | ---- | -------------------------------- |
| `PORT`              | 任意 | 既定3030                         |
| `DATABASE_URL`      | 必須 | PostgreSQL接続URL                |
| `ALLOWED_ORIGIN`    | 必須 | `https://atoqueue.sikumilab.com` |
| `VAPID_PUBLIC_KEY`  | 必須 | 公開鍵                           |
| `VAPID_PRIVATE_KEY` | 必須 | 秘密鍵                           |
| `VAPID_SUBJECT`     | 必須 | `mailto:gerupon@gmail.com`       |
| `LOG_LEVEL`         | 任意 | 既定info                         |

## 10. 契約テスト

- 予約作成に `title` / `body` / `taskId` を含めると400。
- 同じIdempotency-Keyと同じ内容は同じ結果を返す。
- 同じIdempotency-Keyと異なる内容は409。
- 他端末の予約を参照・取消できない。
- 取消済み予約は配送されない。
- 404/410 Push応答で購読が無効になる。
- 一時失敗は規定間隔で再試行される。
- 通知DB消失後の端末認証失敗は、新規端末登録と有効予約の再同期で回復する。
- タスク本文らしい文字列がDB・ログ・Push payloadに現れない。

## 11. 要確認事項

- 【要確認】端末無操作時の購読情報の保持期間
- 【要確認】APIレート制限の初期値
- 【要確認】通知表示のアプリ名を仮称のまま出してよいか
