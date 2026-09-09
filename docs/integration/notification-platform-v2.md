# 通知共通基盤 v2 連携仕様・実装ガイド

- 対象: 管理者が管理する別ブラウザアプリのフロントエンド・バックエンド開発担当
- API version: `v2`
- 基準日: 2026-09-09
- 状態: v2 API・共通クライアント実装済み、ローカル品質ゲート・独立レビュー完了。本番未配置

## 1. この資料の使い方

この文書だけで、別アプリから通知共通基盤へ端末を登録し、匿名通知を予約・更新・取消し、Service Workerで安全に表示できることを目的とする。

別アプリの開発担当へ最初に渡す資料は本書である。共通基盤の内部構成や移行を扱う担当者には、追加で[`通知共通基盤 v2 基本設計`](../superpowers/specs/2026-09-09-notification-platform-design.md)を渡す。

## 2. 共通基盤が行うこと・行わないこと

### 2.1 行うこと

- ブラウザのPush購読を匿名端末として登録する
- 通知予定を作成、時刻変更、取消する
- 通信再送を冪等に処理する
- 期限到来した予約をWeb Pushへ配送する
- 一時エラーを再試行する
- 失効したPush購読を無効化する
- アプリごとの通知を`appId`で分離する

### 2.2 行わないこと

- アプリのタスク、メモ、利用者アカウントを保存する
- 通知時刻を業務ルールから計算する
- 通知タイトル、本文、任意URLを受け取る
- OSが指定時刻どおり表示することを保証する
- アプリ間で端末資格情報を共有する

## 3. 連携開始前に受け取る情報

共通基盤管理者から次の値を受け取る。

| 値 | 例 | 秘密情報 |
| --- | --- | --- |
| API Origin | `https://api.atoqueue.sikumilab.com` | いいえ |
| `appId` | `sample-app` | いいえ |
| 登録済みOrigin | `https://sample.example.com` | いいえ |
| 許可済み`notificationKey` | `review_due` | いいえ |
| 許可済み`routeKey` | `review` | いいえ |

VAPID公開鍵はAPIから取得する。VAPID private key、あとキューまたは別アプリの`deviceSecret`、DB接続情報を受け取る必要はない。

## 4. 識別子

| 名前 | 生成者 | 寿命 | 用途 |
| --- | --- | --- | --- |
| `appId` | 共通基盤管理者 | アプリ存続中は固定 | アプリ名前空間 |
| `deviceId` | 共通基盤 | Push購読を無効化するまで | アプリ内の匿名端末 |
| `deviceSecret` | 共通基盤 | `deviceId`と同じ | 端末操作のBearer認証。登録時に一度だけ返る |
| `reminderId` | 別アプリ | 論理通知枠が存在する間 | 予約の作成・置換・取消 |
| `Idempotency-Key` | 別アプリ | 一つの送信操作と再試行の間 | 応答消失時の重複処理防止 |
| `notificationKey` | 両者の設定 | 契約で固定 | 通知の種類と表示文の選択 |
| `routeKey` | 両者の設定 | 契約で固定 | 通知タップ後のアプリ内遷移先選択 |

### 4.1 ID生成規則

- `reminderId`と`Idempotency-Key`は`crypto.randomUUID()`で生成する。
- 同じ論理通知枠の時刻変更では`reminderId`を変えない。
- 別の論理通知枠には別の`reminderId`を使う。
- 一つのHTTP操作を再送するときは同じ`Idempotency-Key`を使う。
- 内容を変更した新しいHTTP操作には新しい`Idempotency-Key`を使う。

## 5. 共通HTTP仕様

- Base URL: 共通基盤管理者から受け取ったAPI Origin
- Content-Type: bodyがある場合は`application/json`
- 日時: ISO 8601 UTC。必ず`Z`で終える
- Request body上限: 16 KiB
- Schema: 記載フィールド以外を拒否するstrict schema
- 認証: 公開鍵取得・端末登録以外は`Authorization: Bearer <deviceSecret>`
- 冪等性: 指定endpointでは`Idempotency-Key: <UUID>`
- CORS: 登録済みOriginとpathの`appId`が一致する場合だけ許可。`v1`はあとキューOriginだけを許可

## 6. エラー形式

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

`details`は省略される場合がある。ログや問い合わせには`requestId`を使い、Push endpointや`deviceSecret`を記録しない。

| HTTP | code | クライアントの扱い |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | requestを修正するまで再送しない |
| 400 | `INVALID_SCHEDULE` | 未来の有効な予定へ再計算する |
| 401 | `DEVICE_UNAUTHORIZED` | 資格情報を破棄し、利用者操作または修復フローで再登録する |
| 403 | `APP_ORIGIN_FORBIDDEN` | Originと`appId`設定を確認する。自動再送しない |
| 404 | `APP_NOT_FOUND` | `appId`設定を確認する。自動再送しない |
| 404 | `DEVICE_NOT_FOUND` | 資格情報を破棄し、再登録する |
| 404 | `REMINDER_NOT_FOUND` | 他端末・他アプリのIDを疑い、予約状態を再構築する |
| 409 | `IDEMPOTENCY_CONFLICT` | 同じキーに別requestを使っている。新しい操作キーで再実行する |
| 413 | `PAYLOAD_TOO_LARGE` | requestを縮小する。業務データを追加しない |
| 429 | `RATE_LIMITED` | `Retry-After`秒以上待って同じ操作を再送する |
| 500 | `INTERNAL_ERROR` | 指数的に待って同じ操作を再送する |
| 503 | `PUSH_UNAVAILABLE` | 指数的に待って同じ操作を再送する |

## 7. Endpoint仕様

以下の例では`appId=sample-app`を使う。

### 7.1 VAPID公開鍵取得

```http
GET /v2/apps/sample-app/push/public-key
Origin: https://sample.example.com
```

成功: `200 OK`

```json
{ "publicKey": "BASE64URL_VAPID_PUBLIC_KEY" }
```

公開鍵は`PushManager.subscribe()`の`applicationServerKey`へ渡す。

### 7.2 端末登録

```http
POST /v2/apps/sample-app/devices
Origin: https://sample.example.com
Content-Type: application/json
```

```json
{
  "subscription": {
    "endpoint": "https://push.example/subscription",
    "expirationTime": null,
    "keys": {
      "p256dh": "BASE64URL_P256DH",
      "auth": "BASE64URL_AUTH"
    }
  }
}
```

成功: `201 Created`

```json
{
  "appId": "sample-app",
  "deviceId": "a1f0f85e-8da5-4bfb-8fc4-938067ca9984",
  "deviceSecret": "ONE_TIME_SECRET",
  "protocolVersion": 2,
  "createdAt": "2026-09-09T09:00:00.000Z"
}
```

`deviceSecret`は再取得できない。`deviceId`と一緒に端末内へ保存する。

### 7.3 Push購読更新

ブラウザが再購読してendpointまたは鍵が変わった場合に使う。

```http
PUT /v2/apps/sample-app/devices/{deviceId}/subscription
Origin: https://sample.example.com
Authorization: Bearer {deviceSecret}
Idempotency-Key: {operationUuid}
Content-Type: application/json
```

bodyは端末登録と同じ`subscription`形式。成功は`200 OK`。

```json
{
  "appId": "sample-app",
  "deviceId": "a1f0f85e-8da5-4bfb-8fc4-938067ca9984",
  "status": "active",
  "updatedAt": "2026-09-09T09:30:00.000Z"
}
```

### 7.4 端末無効化

```http
DELETE /v2/apps/sample-app/devices/{deviceId}
Origin: https://sample.example.com
Authorization: Bearer {deviceSecret}
Idempotency-Key: {operationUuid}
```

成功: `204 No Content`。その端末の未配送予約も取消される。成功後にブラウザのPush購読を解除し、端末内資格情報を削除する。

### 7.5 通知予約の作成・全置換

```http
PUT /v2/apps/sample-app/reminders/{reminderId}
Origin: https://sample.example.com
Authorization: Bearer {deviceSecret}
Idempotency-Key: {operationUuid}
Content-Type: application/json
```

```json
{
  "deviceId": "a1f0f85e-8da5-4bfb-8fc4-938067ca9984",
  "scheduledAt": "2026-09-10T03:00:00.000Z",
  "notificationKey": "review_due",
  "routeKey": "review",
  "repeatCadence": "daily"
}
```

`repeatCadence`は省略可能。許可値は`daily`、`weekly`、`monthly`。

- 新規作成: `201 Created`
- 既存予約の置換: `200 OK`

```json
{
  "reminderId": "0997f1d8-90b4-4b18-8b7d-b9bb07925564",
  "status": "pending",
  "scheduledAt": "2026-09-10T03:00:00.000Z",
  "repeatCadence": "daily",
  "updatedAt": "2026-09-09T09:35:00.000Z"
}
```

同じ`reminderId`の`PUT`は全置換であり、省略した`repeatCadence`は解除される。

### 7.6 通知予約の取消

```http
DELETE /v2/apps/sample-app/reminders/{reminderId}?deviceId={deviceId}
Origin: https://sample.example.com
Authorization: Bearer {deviceSecret}
```

成功: `204 No Content`。同じ取消の再送も`204`とする。他端末または他アプリが所有する予約には`404`を返す。

## 8. Push payload仕様

```ts
interface NotificationPushPayloadV2 {
  version: 2;
  appId: string;
  type: "reminder_due";
  reminderId: string;
  notificationKey: string;
  routeKey: string;
  groupId: string; // 16文字の小文字16進数
}
```

例:

```json
{
  "version": 2,
  "appId": "sample-app",
  "type": "reminder_due",
  "reminderId": "0997f1d8-90b4-4b18-8b7d-b9bb07925564",
  "notificationKey": "review_due",
  "routeKey": "review",
  "groupId": "0123456789abcdef"
}
```

payloadには通知文、任意URL、業務データを含めない。

## 9. Service Worker実装

各アプリは表示文と遷移先をローカルの固定表で管理する。

```ts
const APP_ID = "sample-app";

const notificationMap = {
  review_due: {
    title: "サンプルアプリ",
    body: "確認したい項目があります",
    tagPrefix: "sample-app-review",
  },
} as const;

const routeMap = {
  review: "/review",
} as const;
```

Push受信時は次を順に検証する。

1. JSON objectで、許可されたフィールドだけを持つ
2. `version === 2`
3. `appId === APP_ID`
4. `type === "reminder_due"`
5. `reminderId`がUUID
6. `notificationKey`が`notificationMap`に存在する
7. `routeKey`が`routeMap`に存在する
8. `groupId`が16文字の小文字16進数

正常時は、固定表の文面を`showNotification()`へ渡す。通知dataには`reminderId`と`routeKey`だけを保存する。tagは`${tagPrefix}-${groupId}`とし、同じ種類・同じ予定時刻の匿名通知だけを集約する。

通知タップ時は`routeMap[routeKey]`へ`?reminder=<reminderId>`を付ける。同一Originの同じpathが開いていればfocusし、なければ`clients.openWindow()`する。payloadから受け取った文字列をURLとして直接開いてはならない。

不正payloadでは業務内容を表示せず、固定の汎用文とアプリ既定画面を使う。

## 10. フロントエンド実装フロー

### 10.1 初回通知設定

1. Web Push対応を機能検出する。
2. 利用者が「通知を設定する」等を押した時だけ通知許可を要求する。
3. Service Workerのreadyを待つ。
4. v2 APIからVAPID公開鍵を取得する。
5. `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`を実行する。
6. Push購読を端末登録APIへ送る。
7. `appId`、`deviceId`、`deviceSecret`、`protocolVersion`、`createdAt`を端末内へ保存する。
8. 現在の業務状態から必要な匿名予約を計算してOutboxへ積む。
9. OutboxをAPIへ同期する。

許可取得・購読・登録・端末内保存のどこかが失敗した場合、通知有効として扱わない。業務データは変更しない。

### 10.2 通知予定の変更

1. 業務状態を先に端末内へ保存する。
2. 望ましい通知予定を再計算する。
3. 既存の論理通知枠には既存`reminderId`を割り当てる。
4. 作成・更新・取消をOutboxへ保存する。
5. UI操作を完了させる。
6. Outbox同期は非同期で継続する。

API応答を待つために保存ボタンや画面全体を長時間無効化しない。

### 10.3 起動時・オンライン復帰時

1. 通知設定が有効か確認する。
2. Notification permissionとPush購読の有無を確認する。
3. 保存済み資格情報と購読が揃っていれば、既存予約をむやみに作り直さない。
4. 業務状態に必要な端末内予約対応が欠けている場合だけ補完する。
5. 保存済みOutboxを再送する。
6. 401/404で端末が失効している場合は資格情報を破棄し、利用者へ再設定を案内する。

起動するたびに新しい`reminderId`を発行すると重複通知になるため禁止する。

## 11. 端末内モデルの最小例

```ts
interface NotificationDeviceState {
  appId: string;
  deviceId: string;
  deviceSecret: string;
  protocolVersion: 2;
  registeredAt: string;
}

interface ReminderMapping {
  reminderId: string;
  localOwnerType: string;
  localOwnerId: string;
  slotKey: string;
  notificationKey: string;
  routeKey: string;
  scheduledAt: string;
}

interface NotificationOutboxItem {
  id: string; // Idempotency-Key
  operation: "upsert" | "cancel";
  reminderId: string;
  scheduledAt?: string;
  notificationKey?: string;
  routeKey?: string;
  repeatCadence?: "daily" | "weekly" | "monthly";
  attemptCount: number;
  nextAttemptAt: string;
}
```

`localOwnerId`等は端末内だけに保存し、API requestへ含めない。

## 12. Outboxと再試行

- API送信前にOutboxへ永続化する。
- 成功responseを検証してから該当Outboxを削除する。
- 通信断、500、503は同じ`Idempotency-Key`で再送する。
- 429は`Retry-After`を尊重する。
- 400、403、409、413は自動再送しない。原因を記録し、安全な修復処理へ回す。
- 同じ予約に新しい変更が発生した場合、未送信の古いupsertを新しい予定へ置き換えられるが、送信中操作のキーを別内容へ流用しない。
- 取消が必要になった予約は、業務状態から消えても取消成功まで端末内対応を保持する。

## 13. Backend仕様

共通基盤は次の層を分離する。

| 層 | 責務 |
| --- | --- |
| Application Registry | `appId`、Origin、VAPID鍵、許可キーの解決 |
| v1 Adapter | 現行あとキュー契約を`atoqueue/protocolVersion=1`へ変換 |
| v2 Adapter | app名前空間付きrequestのstrict検証 |
| Device Service | 匿名端末登録、Bearer認証、購読更新、無効化 |
| Reminder Service | 予約upsert、取消、所有者・予定時刻検証 |
| Repository | PostgreSQL transaction、冪等操作、排他的claim |
| Dispatcher | 期限到来配送、payload version選択、再試行、失効処理 |
| Push Client Registry | app別VAPID資格情報でWeb Pushを送信 |

`device_subscriptions`へ`app_id`と`protocol_version`、`reminder_jobs`へ`route_key`とnullableな`repeat_anchor_at`を追加する。後者は一時失敗の再試行で繰り返し予定時刻がずれないための内部値であり、通信項目には追加しない。既存行は`atoqueue/protocolVersion=1`として移行し、あとキューのpayloadを変えない。

設定・migration・API先行配置・ロールバックの具体手順は[運用手順](../operations/notification-platform-v2.md)を参照する。

## 14. アプリ追加手順

1. 永続的な`appId`を決める。
2. 本番・検証用Originを決める。
3. アプリ専用VAPID鍵を生成し、秘密値を共通基盤のsecret設定へ保存する。
4. `notificationKey`と汎用表示文の対応を決める。
5. `routeKey`と安全なアプリ内pathの対応を決める。
6. Application Registryへ設定を追加する。
7. 別アプリへAPI Origin、`appId`、許可キーだけを渡す。
8. 別アプリで本書のフロントエンド・Service Workerを実装する。
9. 検証Originで端末登録、予約、配送、タップ遷移、取消を確認する。
10. 本番Originを有効化する。

この手順で追加できる範囲では、共通APIのendpointやDB schemaをアプリごとに変更しない。

## 15. 受入テスト

### 15.1 フロントエンド

- 通知許可を利用者操作なしで要求しない
- API不通でも業務データを保存できる
- 同じ論理通知枠の更新で`reminderId`を維持する
- 応答消失後の再送で同じ`Idempotency-Key`を使う
- 起動時修復で正常な予約を重複作成しない
- 端末資格情報と業務データをAPI payloadへ混在させない

### 15.2 Service Worker

- 正常なv2 payloadを表示できる
- appId不一致、未知キー、不正UUID、余分なフィールドを拒否する
- payload中の文字列を任意URLとして開かない
- 同じgroupIdだけを同じtagへ集約する
- 同一Originの既存画面をfocusし、なければ安全なpathを開く

### 15.3 共通基盤

- 未登録appと不許可Originを拒否する
- app間でdevice、secret、reminderを操作できない
- private fieldをstrict schemaで拒否し、ログへ残さない
- v1のrequest、response、Push payloadが変更されない
- 既存DB行が`atoqueue/protocolVersion=1`で配送される
- v2がapp別VAPID鍵とv2 payloadで配送される
- 一時失敗の再試行、404/410購読失効、繰り返し予約が既存どおり動く

## 16. 別アプリへ渡すもの

### 16.1 必須

1. 本書 `docs/integration/notification-platform-v2.md`
2. [共通クライアントREADME](../../packages/notification-client/README.md)
3. 同じ固定版の`@atoqueue/notification-client`と依存`@atoqueue/contracts`の両tarball、または同一workspaceの固定commit
4. API Origin、`appId`、許可済みOrigin、`notificationKey`、`routeKey`

1.27.0のローカル配布物は`dist/notification-platform-v2/`へ作成する。両パッケージはnpm未公開であり、クライアントだけのレジストリインストールはできない。READMEのローカルtarball手順を使う。

### 16.2 共通基盤も変更する担当へ追加

1. `docs/superpowers/specs/2026-09-09-notification-platform-design.md`
2. 更新後の`docs/api-design.md`
3. 更新後の`docs/data-model.md`
4. 共通基盤のテスト・配置手順

### 16.3 渡してはいけないもの

- VAPID private key
- `deviceSecret`の実値
- Push endpointや購読鍵の実値
- DB接続情報
- あとキューの端末内バックアップ

## 17. あとキューとの差分

別アプリは通知時刻計算、業務状態、通知表示文、遷移先だけを独自実装する。端末登録、匿名予約、Outbox、冪等再送、起動時修復、Dispatcher再試行という基本構造はあとキューに倣う。

あとキューは当面`v1`と既存Service Workerを使い続ける。別アプリが`v2`を使い始めても、あとキューの端末資格情報、VAPID鍵、予約、payloadは変更されない。
