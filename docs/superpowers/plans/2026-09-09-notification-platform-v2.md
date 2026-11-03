# 通知共通基盤v2 実装計画

正典: `../specs/2026-09-09-notification-platform-design.md` と `../../integration/notification-platform-v2.md`。
対象要件: F-013、F-014、F-015、F-019、NF-004〜NF-007、NF-012〜NF-014。

## Global Constraints

- v1のURL、request、response、Push payload、既存資格情報を維持する。
- あとキューWebの通知実装と端末保存schemaVersionは変更しない。
- v2はappIdとOrigin、端末・予約所有者、通知キー・遷移キーを検証する。
- 本文・任意URL・業務ID・未知フィールドを拒否し、ログにも残さない。
- DB変更は追加的migration。既存行をatoqueue/protocolVersion=1として扱う。
- v2無効化時もv1 APIと配送を継続する。
- リリース版はmvp-1.27.0 / 1.27.0。公開と本番DB変更は確認を得てから行う。
- テストは同一ホストで直列実行し、終了コードを記録する。

## Task 1: 契約・共通API・後方互換移行・配送

担当範囲: packages/contracts、apps/api。

承認済み設計の全バックエンド要件を実装する。Registryの厳密検証、アプリ別CORSとレート制限、v2全6エンドポイント、Argon2id認証、app間分離、予約更新・取消・冪等性、追加的migration、protocol別payloadとアプリ別VAPID、失敗の隔離、匿名ログ、設定によるv2無効化を含む。既存内部層を再利用し、v1契約テストは維持する。

先に契約・API・migration・配送境界の失敗テストを書き、REDを記録してから実装する。正常・不正Origin・他app端末と予約・秘密値漏えい・再送・繰返し・設定不備・v1不変を観測する。DB既存行の移行と新規v2行の読書きを検証する。全体テスト実行は親と調整し、対象テストと型検査を実行する。

## Task 2: 共通TypeScriptクライアントとService Worker補助関数

担当範囲: packages/notification-client、vitest.workspace.ts、pnpm-lock.yaml。

Task 1の公開契約を使い、全6API操作、送受信strict検証、HTTP/通信エラー分類、Retry-Afterを公開する。API OriginとappIdを設定し、資格情報やOutboxの永続化・通知許可要求は呼出側の責務とする。Service Workerのpayload parserと固定通知表・安全な相対pathへの解決、既存同一Origin/pathへのfocusまたはopenWindowの補助関数を用意する。不正payloadは安全な固定の汎用表示と既定画面へフォールバックする。

公開境界テストのRED→GREENとビルドを記録する。READMEへインストール・全API操作・Outbox責務・Service Worker使用例を掲載する。業務データを送らず、既存apps/web通知実装へ導入しない。

## Task 3: 統合・版更新・運用資料・リリース前検証

全ワークスペースの版を1.27.0、表示/API版をmvp-1.27.0へ更新する。基本設計サマリ、requirements、data-model、api-design、tasks、元MVP計画、連携仕様へ実装状態を反映し、設定例・API先行配置・新アプリ追加・v2停止・旧コードrollbackの制限を運用手順へ書く。

単体・結合・E2E・lint・型検査・全build・既存配置成果物検査を行い、独立レビューの指摘を解消する。`docs/operations/releases/mvp-1.27.0.md`にコマンド、終了コード、件数、未実施の本番検証を記録する。v1通知の本番確認が必要なAPI配置の直前に、具体的な変更と手順を提示して利用者へ確認する。
