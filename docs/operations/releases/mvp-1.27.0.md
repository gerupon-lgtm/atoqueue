# mvp-1.27.0 検証記録

状態: ローカル検証・独立レビュー完了、APIのみ本番配置済み。v2受付は無効、PWAはmvp-1.26.0のまま。OS上の実通知表示は未確認。

## 対象

- F-013、F-014、F-015、F-019、NF-004〜NF-007、NF-012〜NF-014。
- 通知共通基盤v2、既存あとキューv1との並行稼働、別アプリ向け共通クライアント。
- 実装計画: `docs/superpowers/plans/2026-09-09-notification-platform-v2.md`。

## 開始時の確認

- 開始コミット: `9deb2b2`。既存タスクブランチで作業継続。
- Node.js `24.18.0`。PATH上のpnpmは`11.19.0`、プロジェクト指定は`10.20.0`。検証時は実行したランナーを明記する。
- `corepack pnpm --version`で指定版`10.20.0`が利用できることを確認。作業用ディレクトリ内だけにCorepack shimを生成し、以後の依存整備・統合検証は同版を先頭PATHで使用する。OS全体のpnpm設定は変更しない。
- 変更前: `node node_modules/vitest/vitest.mjs run --workspace vitest.workspace.ts --project contracts --project api --maxWorkers 1 --minWorkers 1` → 16ファイル94件成功、終了コード0（48.58秒）。

## DB検証環境

- 本番DBを利用せず、EDB公式のPostgreSQL `17.11-3` Windows ZIPから検証専用プロセスを起動する。[公式配布ページ](https://www.enterprisedb.com/download-postgresql-binaries)。
- バイナリパスに日本語が含まれるとinitdbがUTF-8変換に失敗したため、英数字の一時ディレクトリで初期化した。
- listenは`127.0.0.1:55439`、DB名は`atoqueue_v2_test`。Windowsサービス登録なし。最終検証後に`pg_ctl -w stop`で停止し、`server stopped`（終了コード0）を確認済み。
- `deploy/scripts/verify-notification-platform-postgres.mjs` はローカルの上記DBだけを受理し、実行ごとに新しい専用schemaを作成してfinallyで削除する。既存schemaや本番データを変更しない。

## 品質ゲート

Node.js 24.18.0 / pnpm 10.20.0、同一ホストで検証を直列実行。

- `pnpm lint` → 終了コード0。
- `pnpm -r --workspace-concurrency=1 typecheck` → 5パッケージ成功、終了コード0。
- `pnpm test --maxWorkers 1 --minWorkers 1` → 69ファイル635件成功、終了コード0（207.34秒）。
- PWA E2E: `pnpm --filter @atoqueue/web test:e2e --workers=1` → 51件成功、終了コード0。Chromiumは作業用ディレクトリへ配置。Windowsのテスト後処理がpreview終了待ちになったため、コマンドラインで今回の専用プロセス2件だけと確認したうえで停止し、Playwrightの最終成功出力を確認した（5.8分、後処理待ちを含む）。
- 共通クライアント`7f363ca`: 公開境界48件成功。RED→GREEN、型検査・build・scoped lintはすべて確認済み。
- `pnpm -r --workspace-concurrency=1 build` → 5パッケージ成功、終了コード0。PWAのGitHub Pages SPA fallback検査も成功。
- `node deploy/scripts/verify-notification-platform-postgres.mjs` → build後の実成果物で5群成功、終了コード0。
- `node deploy/scripts/verify-deployment-artifacts.mjs` → 終了コード0。
- `node --test deploy/scripts/deploy-release.test.mjs` → 2件成功、終了コード0。
- `prettier --check .github deploy/scripts/*.mjs docs/operations/deployment-health-startup.md` → 終了コード0。
- `pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts` → 終了コード0。既存node_modules全体の再作成は行わず、新クライアントの依存だけを既存workspaceへリンクして検証。別の空consumerでは下記の通常installを確認した。

## 配布物の確認

- `pnpm -C packages/contracts pack --pack-destination <絶対出力先>`とclientの同コマンドで`dist/notification-platform-v2/`へ1.27.0の両tarballを作成。clientのworkspace依存が固定版`1.27.0`へ変換されたことを確認。
- 空のconsumerを同出力先内に用意し、両tarballとcontractsへのローカルoverrideを指定した`pnpm install --ignore-workspace --offline --ignore-scripts` → 終了コード0。npmへの公開なし。
- consumerから公開exportをimportし、HTTPと安全なSW表示を実行 → 成功、終了コード0。
- consumerのDOMブラウザ例と実`ServiceWorkerGlobalScope`例を、TypeScriptで別々に`--noEmit --strict --module NodeNext --moduleResolution NodeNext`型検査 → 両方終了コード0。
- [利用手順](../../../packages/notification-client/README.md)を同封資料として利用する。

## 途中のレビューと検証

- バックエンド初回実装`8f71e98`: 契約/API 19ファイル101件成功。実PostgreSQL17の専用schemaで移行・所有者分離・再送・排他claim・protocol別payload・取消を確認し、4群成功（終了コード0）。
- 独立レビューで、実EC鍵の検証不足、再試行後に次回予定がずれる経路、app別配送ログ不足を指摘。修正と再検証の完了まではリリース可能と扱わない。
- 再試行前の予定時刻を保持するnullable列`repeat_anchor_at`を追加する設計差分を、設計・データモデル・運用手順へ反映。端末内schemaVersionと通知の通信項目は維持する。
- バックエンド修正`3e54041`: 契約/API 21ファイル107件成功。独立再レビューで上記3点の解消を確認。実PostgreSQL検証はdaily/weekly/monthlyの再試行後の予定時刻・集約ID維持も含め5群成功（終了コード0）。
- クライアント`7f363ca`の独立レビュー: 仕様・品質Approved、Critical/Importantなし。既存Vitest workspace非推奨警告のみ軽微指摘。
- 最終全体レビュー`9deb2b2..e09135f`: Criticalなし、Important 1件（v1 VAPID起動時検証の欠落）、軽微2件（ECDHテスト鍵の最小長、既存Vitest警告）。前2点を最終修正対象とする。

## 最終修正後の確認

- `1e217ec`: v1鍵をDB接続前とsender構築時に検証し、process-global設定を使わず不正な鍵でhealthyになる経路を解消。v2と同じ純粋P-256鍵対検証を共用。従来のmailto/https subjectを維持し、例外へ鍵値を含めない。
- 4箇所のECDH fixtureを32byte左埋めへ統一し、確率的なテスト失敗を除去。
- 起動境界のREDは2件の実アサーション失敗で確認。修正後は契約/API 22ファイル109件、変更ファイルlint、API型検査成功（終了コード0）。
- 親による全体再実行: `pnpm test --maxWorkers 1 --minWorkers 1` → **70ファイル637件成功、終了コード0**（170.46秒）。
- 親による修正後の全workspace lint・型検査・build、実PostgreSQL5群、配置成果物検査、配置補助テスト2件、対象Prettier、独立consumer smokeはすべて終了コード0。
- PWA E2Eは上記51件成功。最終修正はAPIの鍵検証とfixtureのみで、E2E実行後にWeb・共有通信契約の変更はない。
- 限定再レビュー`e09135f..1e217ec`: 起動時検証と全4fixtureの修正を確認、修正起因のCritical/Importantなし。未解消のリリース阻害指摘なし。

## 判断・継続課題

- 既存のタスク専用ブランチで継続し、開始時から存在する無関係のファイルを保持した。別ブランチが必要だった場合の見直しコストは変更の移送。
- retry前の予定時刻保持にはnullableな`repeat_anchor_at`列を追加した。端末schemaと通信項目は維持。見直し時は移行と繰り返し試験を再検証する。
- 既存Vitest workspace形式とPWA build内部の`inlineDynamicImports`の非推奨警告は現行ゲートの失敗ではない。前者はレビュー指摘としてVitest更新時へ持ち越す。誤判断時はテスト設定移行と再検証が必要。

## 本番配置と公開後検証（2026-09-09）

- 利用者の承認を受け、検証済み`ee3992432a2cf5ac83d2a5c850cd17006d0415b8`を`task/atoqueue-mvp`へ通常pushした。
- [CI run 34353354394](https://github.com/gerupon-lgtm/atoqueue/actions/runs/34353354394)成功。GitHub上でもfrozen install、lint、型検査、全テスト、build、実PostgreSQL検証が成功。
- 配置前のAPIは`mvp-1.26.0`、旧リリースは`ba7201eb3920739f27342edb9e11528b20f52bdb`。既存DBは5端末・641予約。
- 21:50:39 JSTにVPS内`/var/backups/atoqueue/atoqueue_notify-pre-v2-20260909T125039Z.dump`へ手動バックアップを作成。125,954 bytes、root所有・0600、`pg_restore --list`成功。内容をGit/Actions/チャットへ取り出していない。root専用ディレクトリへの出力方法をDB復旧手順へ反映。
- [Deploy run 34353512525](https://github.com/gerupon-lgtm/atoqueue/actions/runs/34353512525)を、上記SHA・`target=api`で実行。品質ゲートとAPI配置が成功し、**21:54:17 JSTにAPI配置完了**。PWA公開ジョブはskipped。
- 配置時点のGitHub `production` environmentに保護ルールは設定されていなかった。今回の利用者承認に従って既存workflowを使用し、環境保護設定自体は変更していない。
- 公開HTTPSの`/healthz`は`status: ok`、`version: mvp-1.27.0`。systemdはactive、`current`は上記SHAを指す。
- migration後、元の5端末・641予約を確認。全既存端末が`atoqueue/protocolVersion=1`で、追加4列とapp用indexが存在する。
- v2関連環境設定は未追加、service unitはリポジトリのものとSHA-256一致（drop-inなし）。既定の`NOTIFICATION_V2_ENABLED=false` / Registry `[]`を維持し、v2公開鍵endpointは404。
- v1公開鍵のSHA-256は配置前後で`40B5C80C24EFF003892084F1115EABCF1BA8BB322C309B8FE8370476A9B43E27`のまま。鍵や既存端末資格情報を再生成・置換していない。
- 公開PWAは配置前後とも`/assets/index-3TumLa0g.js`を参照し、mvp-1.26.0のまま。
- 専用の匿名テスト端末だけでv1登録→48時間後の予約作成→同一操作再送→49時間後へ更新→購読更新→取消2回→端末無効化を確認。全操作が期待status/strict responseで成功。資格情報は実行中メモリだけで扱い、実機へのPushは送っていない。テスト端末と取消済み予約の匿名履歴が各1行残るが、既存利用者の行は操作していない。
- 配置後の起動・Dispatcherの固定エラーログは0件。
- 後始末のDB集計で専用テスト端末は`disabled`が1件、専用テスト端末のpending/claimed予約は0件と確認した。

## 残る確認

- 実機での既存v1通知到着・OS表示・タップ遷移は利用者による確認が必要。API成功や偽Push試験では完了扱いにしない。
- 新アプリのv2有効化は今回の承認範囲外。appId・Origin・専用VAPID・許可キーを決定してから、別途有効化と実Push検証を行う。
