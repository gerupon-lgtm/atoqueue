# mvp-1.28.0 テンパリスト連携のローカル検証記録

日付: 2026-09-11。対象要件: F-020、F-003、F-016、F-017、NF-004〜NF-006、NF-013。

## 変更内容

- 合成データによる複数Taskの選択・確認・確定・明示起動を実装。固定の `https://tempalist.sikumilab.com/#create=<payload>` へ、schemaVersion 1・kind `checklist-create`・source `atoqueue`・小文字UUID v4とリスト名・Task ID/タイトルを渡す。コメントやCapture本文は含めない。
- 完成URLを8000文字以内に制限。確定内容と開く操作の記録を端末へ保存してから `location.assign` する。同一操作の再試行は保存済みpayload/URL/requestIdを保持し、編集・別リスト確定は新IDを発行する。
- 保存schemaVersionを10から11へ移行。Task/Capture/通知Outbox/reminderMapを変更せず連携領域を更新し、通常保存・通知同期・復元・端末削除との競合をWeb Lock境界で検査する。バックアップには表示履歴だけを含め、直前payload/URLを除外する。
- 一覧・詳細・今日の確認等へ「テンパリスト連携済」を表示。受信・保存成功ではなく、開く操作の受付履歴として説明する。
- 直前の確定内容を読めなかった際の古い再試行表示と、復旧後に残る読込エラーを修正。起動失敗後に同じ確定内容で再試行する画面テストを保持する。
- Web/API/domain/contracts/notification-clientを1.28.0、画面とAPI起動定数をmvp-1.28.0へ統一。通知API、DB、VAPID、Dispatcher、運用設定に機能変更はない。

## 検証条件と結果

Windows / Node.js 24.18.0 / pnpm 10.20.0 / Chromium。分離worktree `task/tempalist-link` で、単体・結合とE2Eを最大5ファイルずつ、1workerで直列実行する。専用ポート4189を使い、既存4173サーバーを停止・再利用しない。

| ゲート | 結果 | 終了コード |
| --- | --- | --- |
| 単体・結合（全5プロジェクト、18バッチ） | 80ファイル・751件成功、skip 0 | 全バッチ0 |
| Chromium E2E（4バッチ） | 17ファイル・55件成功、skip 0 | 最終各バッチ0 |
| ESLint | 全体成功 | 0 |
| 型検査 | 全5ワークスペース成功 | 0 |
| build | 全5ワークスペース成功、contractsを先に生成 | 0 |
| 配置成果物契約検査 | 成功 | 0 |
| 配置スクリプト試験 | 2件成功 | 0 |
| 差分検査 | 空白エラーなし | 0 |

実行コマンドは、`node node_modules/eslint/bin/eslint.js .`、`corepack.cmd pnpm -r --workspace-concurrency=1 typecheck`、`corepack.cmd pnpm -r --workspace-concurrency=1 build`、`node deploy/scripts/verify-deployment-artifacts.mjs`、`node --test deploy/scripts/deploy-release.test.mjs`、`git diff --check`。pnpmの補助PATHには既存の読み取り専用 `dist/tempalist-activation/bin` を使用した。

単体・結合は `node node_modules/vitest/vitest.mjs run --workspace vitest.workspace.ts --project <project> <最大5ファイル> --maxWorkers 1 --minWorkers 1`。APIの95件もメモリ/SQL fixtureによる試験で、今回実PostgreSQLの結合試験・本番DB接続は実施していない。

E2Eは `ATOQUEUE_E2E_PORT=4189` と既存の `PLAYWRIGHT_BROWSERS_PATH` を指定し、`node apps/web/node_modules/@playwright/test/cli.js test --config <config> <最大5ファイル> --workers=1` を実行した。通常設定の新規4件試験は終了コード0。ただしWindowsでpnpm経由のpreviewの終了待ちが残り、その試験が起動したPIDだけを確認して終了した。全件試験は同じ設定のbaseURL/testDirを使い、直接起動した自分のpreviewを管理するローカル補助設定で実行した。既存サーバーの再利用はしていない。

全E2Eの初回第3バッチでは、既存の入力フォーカス試験が保存直後にlocalStorageを読んで失敗した。Web Lockによる非同期保存の完了表示を待つよう試験を修正し、同じ5ファイル18件を再実行して成功した。他の成功済みバッチの再実行は省略し、残り2ファイル2件も成功。初回失敗を最終成功数へ重複加算していない。

警告: Vitest workspace APIとService Workerの `inlineDynamicImports` は非推奨。WebのJS bundleは507.66 kBで500 kB警告が出る。色環境変数の警告とGitのLF/CRLF・利用者global ignore読取警告もある。ゲートの緩和・新しい依存の追加はしていない。

新規E2Eは合成2Taskをseedし、テンパリストへの全外部遷移を `route.fulfill` で試験HTMLへ差し替える。フラグメントを含む `page.url()` を復号して比較し、HTTP request URLからpayloadを取得しない。実際の外部リスト保存や利用者データの送信は行わない。Task・Capture・非空の通知Outbox/reminderMap・deviceを起動前後で完全比較し、戻る・reload・保存済み再試行・編集時の新ID・8000超・確定/起動記録時の容量不足を検査する。

320×640と320×450で横方向のはみ出し、キーボード選択・並べ替え・確定・起動、最下部までスクロールしたときの操作ボタンと固定ナビの非重複を検査した。担当メインエージェントが実画像を確認し、文字の折返し・控えめなラベル・可視フォーカス・ボタンと固定ナビの間隔に問題がないことを確認した。OSソフトキーボードの観測は含まない。

画像（分離worktreeからの相対パス）:

- `dist/task-7-targeted/tempalist-transfer-F-020-p-8d083-ves-edited-content-a-new-ID/tempalist-review-320.png`
- `dist/task-7-targeted/tempalist-transfer-F-020-p-8d083-ves-edited-content-a-new-ID/tempalist-linked-320.png`
- `dist/task-7-targeted-bottom/tempalist-transfer-F-020-p-8d083-ves-edited-content-a-new-ID/tempalist-retry-bottom-320.png`
- `dist/task-7-targeted-bottom/tempalist-transfer-NF-006--5b983-mation-by-keyboard-at-320px/tempalist-keyboard-320x450.png`

全バッチの実コマンド・ファイル一覧・終了コード・ログはローカルの `dist/task-7-gates/{unit,e2e,e2e-retry}/results.json` と同階層のログへ保存。作業報告は `.superpowers/sdd/2026-09-11-tempalist-checklist-link/task-7-report.md`。これらと画像はGit管理外のローカル成果物。

## 完了範囲と公開前に必要な確認

| 範囲 | 状態 |
| --- | --- |
| 送信側ローカル実装・回帰テスト | ローカル自動検証済み（上記ゲート）。実機判定は別 |
| Android / iOSの実機起動先・保存領域 | 未実施。ブラウザのエミュレーションでは代替不可 |
| 正式アイコン | 未提供。現在は文字ラベルで表示 |
| 本番公開・HTTPS試験配置 | 未実施。本作業ではdeploy/push/mergeやAPI再起動を行わない |

本番向け操作はタスク一覧から確定して開くボタンを使う。`/dev/tempalist-link` は開発時だけの固定合成anchor試験で、本番には存在しない。実機では本番向け操作から、Androidの相手PWA起動中／終了時、保存後に普段のホーム画面PWAで同じリストが見えること、同じURL再試行で既存リストを再利用することを確認する。iOSも保存領域と操作数を記録し、成立しなければ本連携のみAndroid限定とする判断が必要。

実機の判定結果は [確認票](../tempalist-link-device-check.md) に記録する。未実施欄は維持し、現在のローカル検証を公開版やOSの受信成功へ読み替えない。
