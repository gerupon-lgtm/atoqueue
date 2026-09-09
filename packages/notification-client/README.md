# @atoqueue/notification-client

通知共通基盤v2向けTypeScriptクライアント（1.27.0）。対応要件: F-013、F-014、F-015、F-019、NF-004〜NF-007、NF-013、NF-014。

通信仕様は [連携ガイド](../../docs/integration/notification-platform-v2.md) が正典です。あとキューの既存v1 Web通知へは導入していません。

## インストール・配布

このパッケージと依存する `@atoqueue/contracts` はprivate workspace packageです。npmレジストリには公開していません。同一pnpm workspaceなら利用側へ次を追加します。

```json
{ "dependencies": { "@atoqueue/notification-client": "workspace:*" } }
```

別リポジトリへ渡す場合は両方をビルドしてローカルtarballを作り、**両方を同時に**インストールします。Node.js 24、pnpm 10.20.0を使用します。

```sh
pnpm --filter @atoqueue/contracts build
pnpm --filter @atoqueue/notification-client build
pnpm -C packages/contracts pack --pack-destination ../../dist/notification-platform-v2
pnpm -C packages/notification-client pack --pack-destination ../../dist/notification-platform-v2
# 利用側リポジトリ（実際に渡したパスへ置換）
pnpm add ./vendor/atoqueue-contracts-1.27.0.tgz ./vendor/atoqueue-notification-client-1.27.0.tgz
```

pack時に `workspace:*` は `1.27.0` へ変換されます。クライアントtarballだけではprivate依存を取得できません。環境が同時追加したローカル依存を推移依存へ解決しない場合は、利用側 `pnpm.overrides` の `@atoqueue/contracts` をそのtarballの `file:./vendor/atoqueue-contracts-1.27.0.tgz` へ設定してください。Zodは通常の依存として必要です。配布物をブラウザ／Service Worker用バンドラーで取り込みます。

## 全6API操作

```ts
import { createNotificationClient, NotificationClientError } from "@atoqueue/notification-client";

const api = createNotificationClient({
  apiOrigin: "https://api.example.com",
  appId: "sample-app",
  // fetch: fetchImplementation, // テスト等で任意に注入可能
});

const { publicKey } = await api.getPublicKey();
// 利用者操作を起点に許可取得・PushManager.subscribeを呼出側で行う。
// publicKeyはapplicationServerKeyへ変換して利用する。
const registered = await api.registerDevice({ subscription });
// registeredを端末内へ保存する。登録secretは一度だけ返る。
const credentials = { deviceId: registered.deviceId, deviceSecret: registered.deviceSecret };

await api.updateSubscription(credentials, { subscription: renewedSubscription }, crypto.randomUUID());
const reminderId = crypto.randomUUID(); // 同じ論理枠の変更でもこのIDを保持する
const operationId = crypto.randomUUID(); // Outboxへ先行保存し、再送時も同じ値
await api.upsertReminder(credentials, reminderId, {
  deviceId: credentials.deviceId,
  scheduledAt: "2026-10-01T03:00:00.000Z",
  notificationKey: "review_due",
  routeKey: "review",
  repeatCadence: "daily", // 省略すると繰り返しを解除
}, operationId);
await api.cancelReminder(credentials, reminderId);
await api.disableDevice(credentials, crypto.randomUUID());
// 無効化成功後に購読解除と端末内資格情報削除を呼出側で行う。
```

API Originはpath/query/認証情報を含まないHTTPS Origin（開発用localhostのHTTPも可）です。ブラウザがOriginを送るため、Originヘッダを呼出側で指定しません。Cookieを送らず、リダイレクトも拒否します。全requestと成功responseをstrict検証し、appId・対象IDが一致しない成功応答を拒否します。予約応答の予定時刻は冪等再送後の進行済み繰り返し枠を表すことがあるため、送信予定時刻との一致を要求しません。

## Outboxと失敗時の責務

クライアントは永続化、自動再送、通知許可要求、Push購読、業務時刻計算を行いません。呼出側が業務状態とOutboxを先に端末内保存し、UI操作完了後に非同期送信します。Promiseが正常完了した操作だけOutboxから除去します。成功応答が消失した場合も保存済みの同じreminderId・操作キー・requestを再送してください。登録は冪等APIではないため、登録応答の消失を通常の予約再送と同一視しないでください。

```ts
try {
  await sendSavedOutboxItem();
} catch (error) {
  if (error instanceof NotificationClientError) {
    // kind: validation | protocol | network | http
    // retryable: network、HTTP 429、HTTP 5xxのみtrue
    // status/code/requestId: HTTP応答から取得可能な場合のみ
    // retryAfterSeconds: Retry-Afterの秒数（HTTP-dateも残り秒へ変換）
    // error.retryableを参考に、指数バックオフとRetry-Afterを呼出側で適用
    // error.requestId以外の資格情報・購読情報・生レスポンスをログへ残さない
  }
}
```

400/403/409/413は修正まで自動再送しません。401や `DEVICE_NOT_FOUND` は資格情報を破棄して再設定へ、`REMINDER_NOT_FOUND` は予約対応の再構築へ、`APP_NOT_FOUND` は設定確認へ進めます。protocolエラーは不正な成功応答のため、Outboxを保持しAPI/版の整合を調査します。HTTPエラー本文が不正ならcode/requestIdを公開せずHTTP statusで分類します。サーバーのmessage/detailsやネットワーク例外はエラーへ転記しません。

## Service Worker

```ts
import { createServiceWorkerHelpers } from "@atoqueue/notification-client";

const helper = createServiceWorkerHelpers({
  appId: "sample-app",
  origin: self.location.origin,
  defaultPath: "/",
  notifications: {
    review_due: { title: "サンプルアプリ", body: "確認したい項目があります", tagPrefix: "sample-review" },
  },
  routes: { review: "/review" },
});

self.addEventListener("push", (event) => {
  // text()なら壊れたJSONもヘルパー内で安全に処理できる。
  const display = helper.notification(event.data?.text());
  event.waitUntil(self.registration.showNotification(display.title, display.options));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(helper.openNotification(event.notification.data, self.clients));
});
```

固定表はアプリのコード内で定義し、外部入力から作らないでください。継承プロパティはキーとして受理しません。正常payloadでは固定文・groupId単位のtag・`{reminderId, routeKey}`だけのdataを生成します。既存の同一Origin・同じpathnameの画面へfocusし、なければ安全なURLをopenWindowします（既存画面のqueryは書き換えません）。不正payloadは「通知」「アプリを開いて確認してください。」と既定画面へフォールバックします。固定表の遷移先も検証し、`//host`、バックスラッシュ、外部URLを拒否します。`parsePayload`、`notification`、`resolveClick`はDOMやブラウザAPIを呼ばない純粋関数です。
