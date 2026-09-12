# mvp-1.29.0 選択UI・iOS連携制限

日付: 2026-09-12。対象要件: F-020、F-016、NF-008、NF-009、NF-013。
状態: 2026-09-12に利用者承認のうえPWA 1.29.0を本番公開済み。通知API再配置は行っていない。

## 承認内容

- B案の下部固定操作欄、選択中だけ折りたたむ絞り込み。
- 各カードは左にチェック＋選択、右に正式アイコン＋連携済。追加のバッジ行を設けず、縦サイズを抑える。通常一覧ではタイトル行右端へ配置。
- iOS/iPadOSホーム画面版は連携のみ停止（保存済み再試行も含む）。通常ブラウザ内は両アプリを同じブラウザで使う案内を出す。保存先の自動統合・移行なし。
- 元Task、保存schema 11、起動URL schema 1、通知APIと運用設定は変更しない。
- 提供された `C:/Users/user/Documents/NEテンパリスト/assets/icon.svg` を内容変更なしで `apps/web/src/assets/tempalist-icon.svg` へ収録。バンドル内SVGとして配信し、外部取得しない。

## 検証経過

- 単体テストを先行追加し、4件が意図どおり失敗（iOS制限、折りたたみ、正式アイコン）。修正後の再検証を行う。
- 公開済み1.28.0のローカル成果物で、追加ブラウザ試験がチェック欄幅242pxとiOSホーム画面版の起動有効を検出した。初回は元作業領域の古い成果物でfixtureの読込に失敗したため、既知の1.28.0成果物へ切り替えて再現を確認した。
- 修正後の関連単体28件が成功。既存E2Eの旧テキスト「テンパリスト連携済」検索は、共通の読み上げ名「テンパリストへ開く操作済み」で検査するよう更新した。ラベルが短くなったことによる初回失敗を隠さず、その後の全件実行で再確認した。

## 全体品質ゲート

Windows / Node.js 24.18.0 / pnpm 10.20.0 / Chromium。最大5ファイルずつ、1workerでバッチ実行。

| 項目 | 結果 |
| --- | --- |
| 単体・結合 | 全80ファイル755件、18バッチ成功・各終了0 |
| E2E | 全17ファイル61件、4バッチ成功・各終了0、全件実行の再試行・skipなし |
| 型検査 | 全5ワークスペース成功 |
| build | 全5ワークスペース成功 |
| ESLint | 全体成功 |
| 配置成果物契約検査 | 成功 |
| 配置補助テスト | 2件成功 |
| git diff --check | 対象差分に空白エラーなし |

全件コマンドはGit管理外の `node dist/run-tempalist-layout-gates.mjs unit` と `node dist/run-tempalist-layout-gates.mjs e2e`。展開したコマンド、ファイル名、件数、終了コード、所要時間は `dist/tempalist-layout-gates/{unit,e2e}/results.json` と同階層ログに記録。E2Eは既存サーバーを再利用せず、自分で起動した4191番previewへ接続し、外部テンパリスト/APIを試験用応答に置き換えた。利用者データと実受信側の保存は使っていない。

静的検査等: `corepack.cmd pnpm -r --workspace-concurrency=1 typecheck`、同 `build`、`node node_modules/eslint/bin/eslint.js .`、`node deploy/scripts/verify-deployment-artifacts.mjs`、`node --test deploy/scripts/deploy-release.test.mjs`。Web bundle 510.89 kBの既存サイズ警告、Vitest workspace / Service Worker inlineDynamicImportsの非推奨警告は継続。品質ゲートを緩和していない。実PostgreSQL試験と本番DB接続は今回行っていない。

## 表示・起動環境の確認

- 8件の合成Taskで320/390/414px幅を確認。チェック22px以下の意図に対し実装22px、ラベル44px以上、文字とチェックの中心位置、バッジ右端と選択行の中心位置を実測した。
- 1行タイトル・期限未設定の試験カードを190px以下に収めた。長文は切り捨てず自然に折り返す。アイコンのための専用行は増やさない。
- 100px以上の実スクロールでも下部操作欄の位置が固定され、2ボタンが同じ高さで、末尾カードの下端が操作欄より上までスクロールできることを確認。320×450でもナビに重ならず、確認画面へ進むと先頭見出しへフォーカスが移る。
- 390pxの選択済み画面を主担当が目視確認。画像は `dist/tempalist-layout-gates/e2e/batch-3/tempalist-transfer-F-020-c-bef27-om-actions-at-mobile-widths/selection-390.png`（Git管理外）。
- iPhone standalone、MacIntelとして識別されるiPad standalone、iPhone fullscreenの模擬環境で連携を停止。iPhoneブラウザ・Android standaloneの模擬環境では確定・起動が成功。iOSでの保存済み再試行の拒否も単体で確認し、拒否時はTask・連携記録を変更せず遷移しない。

## Standardsレビュー

指摘0件。既存のローカル保存・通知境界、CSS優先順位、起動制限の分離、版更新に問題は見つからなかった。

## Specレビュー

指摘0件。B案の操作欄、C案に近い右端バッジ配置、コンパクトな選択行、iOS制限とAndroid維持が承認内容に対応している。両レビューは読み取り専用で実施し、主担当がテストと画像確認を担当した。

## 実機の境界

Androidでの連携成功とiOS通常ブラウザ内での保存維持は利用者報告。自動試験でのnavigator/display-mode模擬は実OSによるPWA捕捉や保存領域の実機証跡ではない。修正版公開後に実機再確認が必要。

## 承認後の本番公開（2026-09-12）

- 利用者が送信先・32ファイルのコミット送信・Web限定更新を明示承認。`task/atoqueue-mvp` をpushし、既存Deploy workflowを `target=pwa` で実行。mainへのマージや通知API配置はしない。
- 配置SHA: `833966eabdc4b490f088e70ca39dab4f0baf5546`。公開先: <https://atoqueue.sikumilab.com/>。
- [Deploy run 34660764640](https://github.com/gerupon-lgtm/atoqueue/actions/runs/34660764640) は成功。品質ゲート、CI専用PostgreSQL検証、Pages公開の各step成功、API配置はskip。push/PRのCIも成功。ログ一括取得は権限エラーのため、Actionsのジョブ・step結果で確認し、CIのテスト件数は推定していない。
- 配置前にWeb build・配置成果物契約検査・配置補助2テストを再実行し成功。ソースや依存関係は前回の全体検証から変更なし。
- 公開JS `/assets/index-Bj7IqemR.js` のSHA-256は `66f6db07a0d9f984ef67fd20e16945d15a245ad484af0416ed98fbe2f598152a`。ローカルbuildと完全一致。版数1.29.0、DEV試験画面の除外を確認。
- 2026-09-12 00:18 UTC、新規隔離Chromiumで合成2Taskを使い、設定の版表示、選択チェック22px、2件の正式SVGバッジ右端揃え、下部操作欄とナビの非重複、確認画面への遷移を確認。Android standalone・iOS通常ブラウザは利用可能、iOS standaloneは無効＋説明表示。UA/standaloneの模擬であり実OS検証ではない。
- ブラウザ内試験は本アプリ以外への通信を遮断し、テンパリストへの確定・実起動・保存は行わない。利用者の保存領域も使わない。公開画像を主担当が目視確認した。
- 補助検証の初回は待機が続き停止。依存探索を無効にして再実行後、版表示の検索場所・折りたたみ展開を修正し、最終3シナリオが終了0。これらは検証スクリプトの修正であり公開コードは変更なし。
- `/healthz` はHTTP 200、`status=ok`、`version=mvp-1.27.0`。通知API・本番DB・VAPID・v2設定は変更していない。
- ローカル証跡（Git管理外）: `dist/deploy-129-verify.mjs`、`dist/deploy-129-result.json`、`dist/deploy-129-android-standalone.png`、`dist/deploy-129-ios-browser.png`。既存未コミット3文書・未追跡ファイルは公開コミットへ含めず保持。
