# あとキュー通知基盤の別アプリ再利用調査

- 調査日: 2026-09-09
- 調査対象: `task/atoqueue-mvp` / `75ae86c`（`mvp-1.26.0`）
- 調査方法: リポジトリ内の設計書、契約、実装、テストを一次資料として確認

## 1. 結論

あとキューには通知に使う識別子がありますが、**別アプリを識別する `appId` / `sourceApp` / 通知チャネルはありません**。現在の `deviceId` はPush購読と認証を束ねる匿名端末ID、`reminderId` は通知予約IDです。どちらも「通知先アプリを切り替えるID」ではありません。

したがって、**現在のAPIへ別の識別子を渡すだけで、別アプリの通知として送ることはできません**。同じ `deviceId` / `deviceSecret` で別の `reminderId` を登録した場合、通知は同じPush購読、すなわちあとキュー側のService Workerへ届き、あとキューの固定文面を表示して `/today` または `/inbox` を開きます。別アプリへ切り替わりません。

通知基盤そのものは再利用できます。最小リスクで早いのは「同じ実装を別アプリ用に分離配置する」方法です。一つの通知APIを複数アプリで共有する場合は、少なくともアプリ名前空間、オリジン、購読資格情報、遷移先を分離する改修が必要です。

## 2. 現在の通知フロー

1. 利用者が通知設定を実行すると、PWAは通知許可を取得し、APIのVAPID公開鍵でブラウザのPush購読を作ります（`apps/web/src/infrastructure/notifications/push-subscription.ts:50-86`, `apps/web/src/infrastructure/notifications/push-subscription.ts:195-215`）。
2. PWAは購読情報を `POST /v1/devices` へ送り、サーバー生成の `deviceId` と一度だけ返される `deviceSecret` を端末内へ保存します（`apps/api/src/devices/device-routes.ts:35-42`, `apps/api/src/devices/device-service.ts:14-23`, `apps/web/src/infrastructure/notifications/push-subscription.ts:115-145`）。
3. 端末内のドメインルールが通知時刻を計算し、匿名の予約操作をOutboxへ積みます。OutboxからAPIへ送るのは `deviceId`、`reminderId`、予定時刻、通知種別、任意の繰り返し間隔です（`packages/domain/src/model.ts:123-155`, `apps/web/src/infrastructure/notifications/notification-api.ts:87-112`）。
4. APIは期限到来予約をclaimし、購読endpointへ `review_due` payloadを送ります（`apps/api/src/scheduler/reminder-dispatcher.ts:21-45`）。
5. あとキューのService Workerが汎用文を表示し、通知タップ時に同一オリジンの `/today` または `/inbox` を開きます（`apps/web/src/service-worker.ts:1-5`, `apps/web/src/service-worker.ts:22-42`）。
6. `/today?reminder=...` の `reminderId` は、サーバー照会ではなく端末内 `ReminderMapEntry` からTaskへ解決されます。対応がなければ通常の「今日の確認」になります（`apps/web/src/infrastructure/notifications/reminder-navigation.ts:3-8`, `apps/web/src/features/review/TodayReviewPage.tsx:123-143`）。

## 3. 識別子の役割

| 識別子 | 生成・保存 | 役割 | 別アプリ識別子として使えるか |
| --- | --- | --- | --- |
| `localDeviceId` | PWA端末内のみ | 端末内スナップショットの局所ID | 使えない。通知API契約には含まれない |
| `pushDeviceId` / API上の `deviceId` | `POST /v1/devices` でサーバーがUUIDを生成し、端末内とDBへ保存 | 一つのPush購読を所有・認証する匿名端末ID | 使えない。アプリIDではなく購読所有者ID |
| `pushDeviceSecret` / `deviceSecret` | 端末登録時にランダム生成して一度だけ返却。端末内は平文、サーバーはArgon2idハッシュ | `deviceId` に対するBearer認証 | 流用すべきでない。別アプリは独自資格情報を持つべき |
| `reminderId` | PWAが推測困難なUUIDを生成 | 一件の匿名予約を作成・更新・取消し、Push後に端末内対応を引く | 使えない。通知先アプリではなく予約のID |
| Outboxの `id` | PWAが操作ごとに生成 | `PUT` 等の `Idempotency-Key`。同一操作の再送を一件として扱う | 使えない。アプリIDではなく操作ID |
| `notificationType` | 端末内ルールが4種類から選択 | 通知の用途、クリック先、同時刻通知の集約に利用 | 使えない。任意値やアプリ名を受け付けない |
| `groupId` | APIが `notificationType + NUL + scheduledAt` のハッシュから生成 | 同じ種別・時刻のOS通知を同じタグへ集約 | 使えない。アプリ識別子ではなく表示集約ID |

端末内モデルは `localDeviceId` とPush用の資格情報を明確に分けています（`packages/domain/src/model.ts:15-21`）。`deviceId` と `deviceSecret` のレスポンス契約は `packages/contracts/src/devices.ts:9-19`、Bearer照合は `apps/api/src/devices/device-service.ts:45-50` にあります。

`reminderId` は端末内でだけ `taskId`、`captureId`、`scope` のいずれかと対応付けます。これらのローカル所有者情報はサーバーへ送信しません（`packages/domain/src/model.ts:137-155`, `docs/data-model.md:251-275`）。同じ予約枠の時刻変更では `reminderId` を維持して `PUT` し、新しい `reminderId` は新しい予約になります（`packages/domain/src/notification-queue.ts:234-260`）。

`notificationType` は `inbox_review`、`task_review`、`deadline_review`、`unset_due_review` の4種類に固定されています（`packages/contracts/src/reminders.ts:9-20`）。また、`groupId` は通知種別と予定時刻だけから生成されます（`apps/api/src/scheduler/reminder-dispatcher.ts:63-70`）。

## 4. API認証と端末登録

- `POST /v1/devices` だけは未認証で、Push購読を登録して `deviceId` / `deviceSecret` を取得します（`apps/api/src/devices/device-routes.ts:38-42`）。
- 購読更新と端末無効化にはBearer認証と `Idempotency-Key` が必要です（`apps/api/src/devices/device-routes.ts:24-32`, `apps/api/src/devices/device-routes.ts:44-54`）。
- 通知予約の作成・更新・取消にも、本文中またはクエリ中の `deviceId` と、それに対応するBearerシークレットが必要です（`apps/api/src/reminders/reminder-routes.ts:12-23`, `apps/api/src/reminders/reminder-service.ts:17-42`）。
- サーバー側は `deviceSecret` そのものではなくArgon2idハッシュを保存します（`apps/api/src/devices/device-service.ts:14-23`）。
- 現在の本番設定はCORS許可元を `https://atoqueue.sikumilab.com` に固定し、設定スキーマも別オリジンを拒否します（`apps/api/src/config.ts:3-15`, `apps/api/src/plugins/security.ts:11-13`）。このため、別オリジンのブラウザアプリから現在のAPIをゼロ変更で呼ぶことはできません。

別アプリが通知を利用する場合、あとキューの資格情報を共有するのではなく、そのアプリ自身のService Workerが作ったPush購読を登録し、独自の `deviceId` / `deviceSecret` を取得する必要があります。

## 5. 予約の一意性と衝突

`reminder_jobs.id` はDB全体の主キーであり、`(device_id, reminder_id)` の複合キーではありません。したがって `reminderId` の名前空間は端末別・アプリ別に分離されておらず、全体で一意なUUIDが必要です（`apps/api/src/db/migrations/001_initial.sql:14-34`）。別端末が既存の `reminderId` を再利用すると、所有端末不一致として404になり、既存予約は変更されません（`apps/api/src/reminders/reminder-routes.test.ts:102-113`）。

冪等性にはOutboxの `id` を `Idempotency-Key` として使います（`apps/web/src/infrastructure/notifications/notification-api.ts:99-110`）。同じ端末・同じキー・同じ要求は前回結果を再生し、同じキーで内容が違えば409です（`apps/api/src/reminders/reminder-repository.ts:122-145`, `apps/api/src/reminders/reminder-routes.test.ts:116-128`）。これは通信再試行の重複防止であり、アプリ間を分離する仕組みではありません。

## 6. 通知本文と送信データの制約

通知APIはタスク管理APIではなく、保持情報を匿名端末、Push購読、匿名予約、配送状態に限定しています（`docs/api-design.md:3-9`, `docs/data-model.md:23-35`）。予約要求のZod契約は `.strict()` で、送れる値は `deviceId`、`scheduledAt`、`notificationType`、任意の `repeatCadence` だけです（`packages/contracts/src/reminders.ts:13-20`）。

`title`、`body`、`taskId`、`category` 等を加えると400になります。契約テストでも秘密文字列をレスポンスへ漏らさず拒否することを確認しています（`apps/api/src/reminders/reminder-routes.test.ts:131-137`）。

OS通知の表示文は通知APIから送らず、Service Worker内で次に固定されています（`apps/web/src/service-worker.ts:1-5`, `apps/web/src/service-worker.ts:22-34`）。

```text
あとキュー
確認したい項目があります
```

この制約はプライバシー上重要です。共通化後も、タスク本文や外部アプリの個人情報を通知APIへ送る設計には変えないほうが安全です。

## 7. 通知クリック時の遷移

Dispatcherは `inbox_review` だけを `/inbox`、それ以外を `/today` に固定し、`?reminder=<reminderId>` を付けます（`apps/api/src/scheduler/reminder-dispatcher.ts:29-41`）。Service Workerは次の条件を全て満たすURLだけを受理します。

- 同一オリジンの相対URL
- パスが `/today` または `/inbox`
- クエリが `reminder` 一つだけ
- クエリ値とpayloadのUUIDが一致

根拠は `apps/web/src/service-worker.ts:37-42` と `apps/web/src/service-worker.ts:63-76` です。不正または別形式なら `/today` へフォールバックします。既存の同一オリジン・同一パスのウィンドウがあればフォーカスし、なければ新しく開きます（`apps/web/src/service-worker.test.ts:72-107`）。

そのため、`reminderId` を別アプリ側のIDへ替えても、別アプリURLは開きません。あとキュー端末内に対応表がなければ、通常の「今日の確認」全体を開くだけです。

## 8. 「IDだけ変更」の具体的な結果

| 試し方 | 現在の結果 |
| --- | --- |
| 任意の `deviceId` を作って予約する | 登録済み端末でないため404、またはBearer不一致で401 |
| あとキューの `deviceId` / `deviceSecret` と新しい `reminderId` を使う | あとキューのPush購読へ配送され、あとキューのService Workerが表示・遷移を処理する |
| `reminderId` に別アプリのタスクIDを入れる | UUID以外は400。UUIDでもサーバー上は匿名予約IDでしかなく、端末内対応表がなければTaskへ解決されない |
| `notificationType` に別アプリ名を入れる | 許可された4値以外は400 |
| `title`、`body`、任意URLを予約APIへ追加する | strict契約により400 |
| 別オリジンから現在のAPIを呼ぶ | 本番CORS設定により拒否 |

## 9. 再利用方法

### 9.1 推奨: 別アプリ用に同じ基盤を分離配置する

早く、安全に再利用するなら、通知API、予約リポジトリ、Dispatcher、Outboxの考え方を流用しつつ、別アプリ用に次を分離します。

- 別アプリ独自のPush購読と `deviceId` / `deviceSecret`
- 別アプリのオリジン
- 別アプリのService Worker、汎用通知文、クリック先
- 別のDBまたは少なくとも別スキーマ
- 別のVAPID資格情報と運用設定

この方法なら現行あとキューの契約・予約・障害影響を変えず、予約IDのアプリ名前空間追加も不要です。再利用候補は、共有契約（`packages/contracts/src`）、ブラウザAPIアダプター（`apps/web/src/infrastructure/notifications/notification-api.ts`）、Outbox同期、APIのdevice/reminder層、Dispatcherです。一方、通知時刻計算と `ReminderMapEntry` はあとキューのTask/Captureモデルに結合しているため、別アプリのドメインに合わせた実装が必要です。

### 9.2 一つの通知APIを複数アプリで共有する

共有サービスにする場合の最小分離案は次です。

1. サーバー管理の `appId` を導入し、端末登録時に許可済みアプリを確定する。
2. CORSを単一固定オリジンから、`appId` と対応する許可オリジンの一覧へ変更する。
3. `device_subscriptions`、`reminder_jobs`、冪等性テーブルの所有境界へ `app_id` を追加する。
4. 予約の一意性と検索条件を `app_id` を含む形へ変更する。特に現在のグローバルな `reminder_jobs.id` 主キーを見直す。
5. `notificationType` をアプリ共通の抽象種別またはアプリ別許可値へ整理する。
6. サーバーが固定URLを生成する代わりに、登録済みの安全な `routeKey` をアプリ別パスへ解決する。任意の外部URLは受け付けない。
7. 各アプリが独自Service Workerで、自アプリの汎用文と安全な遷移先を表示する。
8. rate limit、ログ、無効化、配送失敗を `appId` 単位でも観測できるようにする。

`appId` はクライアントが自由入力する文字列ではなく、サーバー側の静的登録または管理済み設定から解決するのが安全です。また、Push payloadへアプリ名や本文を入れる必要はありません。どの購読へ送るかは端末登録に紐づく `appId` でサーバーが判断できます。

## 10. 推奨判断

現段階では、あとキュー本番APIへ別アプリの予約を直接混在させるより、まず別アプリ用の分離配置で通知フローを再利用するのが安全です。別アプリが増えて運用重複が明確になった時点で、`appId` を持つ共通通知サービスへ統合する方が、現在利用中のあとキューに対するデグレ、資格情報共有、予約衝突を避けられます。

要点は次の二つです。

- 現在あるIDをそのまま流用するのではなく、**別アプリが独自Push購読と独自端末資格情報を持つ**。
- 共通APIにするなら、ID差し替えではなく、**アプリ所有境界をデータ・認証・CORS・遷移に追加する**。
