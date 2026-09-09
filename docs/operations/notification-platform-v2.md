# 通知共通基盤v2 運用手順

対象: F-013、F-014、F-015、F-019、NF-005、NF-006、NF-014。
本リリースの検証・公開状態は [mvp-1.27.0](releases/mvp-1.27.0.md) を参照。

## 設定

既存の`DATABASE_URL`、`ALLOWED_ORIGIN`、`VAPID_*`はあとキューv1専用として維持する。

| 変数 | 初期値 | 用途 |
| --- | --- | --- |
| `NOTIFICATION_V2_ENABLED` | `false` | `true`のときv2 routeを公開。`true`/`false`以外は起動時エラー |
| `NOTIFICATION_APPLICATIONS_JSON` | `[]` | 管理下の別アプリのRegistry配列 |
| `NODE_ENV` | 未指定 | `development`の場合だけlocalhostのHTTP Originを許可 |

Registry要素は次の全フィールドを持つ。未知フィールド、重複appId・Origin、予約名`atoqueue`、不正キー、非HTTPS Originは起動時に拒否する。

```json
{
  "appId": "sample-app",
  "origins": ["https://sample.example.com"],
  "vapidPublicKey": "アプリ専用の公開鍵",
  "vapidPrivateKey": "アプリ専用の秘密鍵",
  "vapidSubject": "mailto:operator@example.com",
  "notificationKeys": ["review_due"],
  "routeKeys": ["review"]
}
```

これは説明用の要素であり、そのまま起動に使える鍵ではない。実設定はこの要素を配列に入れた一行JSONとして、root管理の`/etc/atoqueue/notification-api.env`に保存する。秘密鍵をリポジトリ、Actionsログ、利用アプリへコピーしない。systemd EnvironmentFileではJSONの二重引用符を維持するため、値全体を単一引用符で囲む。

## API先行配置

1. リリース記録の単体・結合・実PostgreSQL・E2E・型検査・lint・build・独立レビューの完了を確認する。
2. 本番変更の承認を得てから、[DB復旧手順](notification-db-recovery.md)に従い手動dumpと現在のAPIリリースSHAを保存する。
3. 初回配置は新アプリ設定を空にし、`NOTIFICATION_V2_ENABLED=false`を維持する。あとキューの既存VAPID鍵・資格情報を変更しない。
4. `Deploy`の`ref`へ検証したSHA、`target`へ`api`を指定して手動実行し、production environmentの承認を行う。PWA公開はスキップされる。
5. migration 004はdeviceに`app_id DEFAULT 'atoqueue'`、`protocol_version DEFAULT 1`、予約に`route_key NULL`、再試行前の予定時刻を保持する`repeat_anchor_at NULL`とindexを追加する。旧列の削除・変更、端末内schemaVersionの変更は行わない。
6. healthzのAPI版、v1公開鍵の不変、既存端末の予約更新・取消、実機への汎用Push到着を確認する。Push成功ログだけでOS表示成功とは判断しない。
7. v1安定確認後に新アプリの設定を追加し、v2を有効化する。APIを再起動し、当該アプリのOriginから登録・予約・配送・クリック遷移・取消を確認する。

`target=all`は従来どおりPWAとAPIの両方、`target=pwa`はPWAだけを配置する。API先行期間はPWAの版とAPIの版が異なるため、公開中のPWAを未更新と誤診しない。

## v2停止とロールバック

通常のv2停止は`NOTIFICATION_V2_ENABLED=false`として新コードのAPIを再起動する。v2のHTTP受付だけが止まり、v1のHTTP受付と両protocolの既存予約配送は継続する。既存v2予約を引き続き配送するため、Registryの対応アプリ設定は残す。

旧バイナリへのロールバックは別操作である。旧DispatcherはappId・protocolVersionを認識しないため、v2端末がactiveのままでは、別アプリへv1 payloadとあとキュー用鍵を使って送ろうとする。v2が一度も利用されていない初回先行配置なら、追加列を残して従来のrollback手順で戻せる。

v2利用開始後に旧コードへ戻す場合は、管理者がサービス停止後にv2端末とその未配送予約だけを退避・無効化する手順を確認する。v1端末には触れない。この操作はv2通知を止めるため、影響対象アプリを確認してから実施する。通常は新コードを維持してv2受付だけを停止する方が、既存予約とアプリ別鍵の対応を保てる。破壊的down migrationは行わない。

## 別アプリへ渡すもの

- [連携仕様](../integration/notification-platform-v2.md)、共通クライアントREADMEと固定版の配布物。
- API Origin、appId、許可Origin、notificationKey、routeKey。
- VAPID公開鍵はAPIから取得する。VAPID秘密鍵、既存端末のシークレット、Push購読、DB接続情報は渡さない。

## ローカルの実DB検証

空のローカルPostgreSQL DB `atoqueue_v2_test`を用意する。接続先はloopbackだけを許可し、各実行はUUID付きの専用schemaを作成・削除する。

```powershell
pnpm --filter @atoqueue/api build
$env:ATOQUEUE_TEST_DATABASE_URL='postgresql://atoqueue_test@127.0.0.1:55439/atoqueue_v2_test'
node deploy/scripts/verify-notification-platform-postgres.mjs
```

この検証は実SQL、移行、排他claim、HTTP API、偽Pushへのpayloadまでを確認する。ブラウザPushサービス、VAPIDの本番設定、OS表示は別途実機で確認する。
