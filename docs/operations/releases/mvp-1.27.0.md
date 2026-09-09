# mvp-1.27.0 検証記録

状態: 実装・検証中。本番未配置。

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
- listenは`127.0.0.1:55439`、DB名は`atoqueue_v2_test`。Windowsサービス登録なし。検証終了後に停止する。
- `deploy/scripts/verify-notification-platform-postgres.mjs` はローカルの上記DBだけを受理し、実行ごとに新しい専用schemaを作成してfinallyで削除する。既存schemaや本番データを変更しない。

## 品質ゲート

Node.js 24.18.0 / pnpm 10.20.0、同一ホストで検証を直列実行。

- `pnpm lint` → 終了コード0。
- `pnpm -r --workspace-concurrency=1 typecheck` → 5パッケージ成功、終了コード0。
- `pnpm test --maxWorkers 1 --minWorkers 1` → 69ファイル635件成功、終了コード0（207.34秒）。
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
- クライアント`7f363ca`の独立レビュー: 仕様・品質Approved、Critical/Importantなし。既存Vitest workspace非推奨警告のみ軽微指摘。最終全体レビューは別途実施する。
- PWA E2E: `pnpm --filter @atoqueue/web test:e2e --workers=1` → 51件成功、終了コード0。Chromiumは作業用ディレクトリへ配置。Windowsのテスト後処理がpreview終了待ちになったため、コマンドラインで今回の専用プロセス2件だけと確認したうえで停止し、Playwrightの最終成功出力を確認した（5.8分、後処理待ちを含む）。

## 公開前に必要な確認

全品質ゲート通過後、API先行配置と本番DB migrationの実行について利用者へ確認する。既存v1の実機通知と新アプリの実Push配送は本番または専用検証Originでの確認対象であり、ローカルの偽Pushテストでは完了扱いにしない。
