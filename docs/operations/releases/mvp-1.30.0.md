# mvp-1.30.0 テンパリスト連携説明の省スペース化

対象: F-020 / NF-008 / NF-009。2026-09-12。利用者の追加承認を受けてPWA 1.30.0を本番公開済み。通知API・本番DBは変更しない。

## 承認済み仕様

- 一覧の入口は正式アイコン＋「テンパリストへ」と、隣のⓘの1行。初期表示で長い説明を置かない。
- 説明はⓘを押した時だけ重ねて表示し、一覧・カードを下へ押し出さない。「テンパリストとの連携」「選んだタスクをテンパリストのチェックリストにします。」を表示。
- iOSのみ「iPhone・iPadの場合」「あとキューとテンパリストを同じブラウザで開いてください。ホーム画面版とはデータが別です。」を追加する。
- iOSホーム画面版では主ボタンを無効にし、「ブラウザから利用できます」を短く表示。ⓘは有効。既存のサービス側制限を維持。
- 直前の確定内容がある時だけ、下に「直前の連携を確認」を下線付きの小さなテキスト操作として置く。ページ内の状態変更なのでbutton要素を使い、タップ領域44pxを保つ。iOSホーム画面版では非表示。
- 説明は閉じる・Escape・外側タップ・フォーカスが外へ移った時に閉じる。明示的な閉じる操作はⓘへフォーカスを戻す。非モーダルであり背景操作やTab移動を拘束しない。
- 確認画面・直前の連携画面も同じⓘでiOS説明を開ける。URLにタスク名が含まれる注意と元タスク・通知が残る注意は常時表示を維持。
- 選択モード・右端連携済表示・送信契約・schema 11・通知API・DBは変更しない。複数画面の操作変更として1.30.0へ更新。

## 検証

- テスト先行で「説明を必要時だけ開く」「iOS無効ボタンの隣でも説明を開く」の2件が失敗することを確認。
- 実装後、一覧16件成功。確認画面は新しいⓘのTab順を期待に含め、関連2ファイル22件成功。
- 型検査で追加RTLテストのPlaywright専用オプション `exact` を検出し、削除後に全5ワークスペースが成功。
- 広い画面の上下配置に対するレビュー指摘1件を受け、1024pxを含む実寸検査を追加。fixtureに直前の確定内容を設定してから修正前の横並びを再現し、親を縦配置へ修正した。
- 最後にⓘを主操作へ隣接させた際、320px幅で説明枠の右端344pxを検出。入口行の幅をviewport内へ制限し、関連10E2Eを再実行して成功。初回失敗を成功結果として扱わず、最終全件検証を別フォルダへ残す。

## Standardsレビュー

初回1件（広幅で再確認が横に並ぶ）、修正後0件。保存・HTTP・通知の境界、44px操作領域、非モーダル説明の終了とフォーカス復元、版更新を確認。

## Specレビュー

指摘0件。承認された短い入口・ⓘ・条件付き再確認・iOS短文・共通説明に対応。実OSのPWA捕捉・保存領域の検証ではない。

## 最終品質ゲート

- 単体・結合: 全80ファイル757件成功。最大5ファイル・1worker・18バッチ。`node dist/run-tempalist-layout-gates.mjs unit tempalist-compact-gates`、各終了0。
- E2E: 全17ファイル61件成功。最終実行は4バッチ・再試行なし・各終了0。`node dist/run-tempalist-layout-gates.mjs e2e tempalist-compact-final-gates`。専用4192 previewを使用し、外部API/テンパリスト通信は試験用応答へ置換する。
- 320/390/414/1024pxで主操作とⓘの同じ行、再確認の下配置、説明による一覧の位置変化なし、説明枠の横はみ出しなしを測定。Escape・Tab離脱を確認。iOS模擬320×450の説明枠も画面内へ収め、長い内容は枠内スクロールとする。
- 主担当が390pxの通常・説明表示、iOS模擬320pxの説明を目視。連携済バッジは従来の右端位置を維持。
- 全5ワークスペース型検査・build、全体ESLint、配置成果物契約検査、配置補助2テストを実施。最終Web bundleは `index-CGsnnsP1.js`、512.40 kB。既存の500kB警告とService Worker/Vitest非推奨警告は継続。実PostgreSQL・CI・本番配置は実施しない。
- ログと終了コードはGit管理外 `dist/tempalist-compact-gates/unit`、`dist/tempalist-compact-final-gates/e2e`。初回E2Eの失敗は `dist/tempalist-compact-gates/e2e`。最終ビルドは `dist/tempalist-compact-web-build-final.log`。
- 画面画像は最終E2E `batch-3/tempalist-transfer-F-020-c-bef27-om-actions-at-mobile-widths/{entry,help}-390.png`。ブラウザ模擬は実機のPWA起動先・保存領域の保証ではない。

## 承認後の本番公開（2026-09-12）

- 利用者のデプロイ依頼に従い、既存 `task/atoqueue-mvp` へpushし、SHA `0aa7cbb6aea8d9bb9b952cc98c6294fcb9042b79` を `target=pwa` で公開した。mainへのマージは行わない。
- [Deploy run 34663683573](https://github.com/gerupon-lgtm/atoqueue/actions/runs/34663683573) 成功。品質チェック・CI専用PostgreSQL検証・GitHub Pages公開成功、API配置はskip。push/PRのCIも成功。本番DBへの接続・移行は行っていない。
- 配置前のWeb再ビルド、配置成果物契約検査、配置補助2件はすべて成功。前回の全体検証から実装ソースの変更なし。
- 公開先: <https://atoqueue.sikumilab.com/>。2026-09-12 01:09 UTCに公開後の確認完了。
- 配信JS `/assets/index-CGsnnsP1.js` のSHA-256は `f5139214ac7ad9f1bd40670b953d493e1131bc9481c137fe73c980ba06f7e0bb`。JS・CSSともローカルbuildと一致し、Service Workerが新版JSを参照していることを確認。DEV試験画面は含まない。
- 新規隔離Chromium（390×844、合成2Task）で設定の1.30.0表示、ⓘでの説明開閉、説明を開いても絞り込み位置不変、再確認操作の下配置・枠なし表示・保存済み内容表示を確認。22pxチェック・右端バッジ・下部固定操作とナビの非重複・確認画面への遷移も成功。
- Android standalone、iOS通常ブラウザ、iOS standaloneの模擬3条件が終了0。iOSにはⓘ内の保存領域の説明を表示し、ホーム画面版は主操作無効＋短文、再確認なし。画像を主担当が目視確認。実OSや利用者の保存領域での実機試験ではない。
- ブラウザ試験では本アプリ以外への通信を遮断し、テンパリストへの確定・実起動・保存は行っていない。通知APIの別途read-only `/healthz` はHTTP 200、`status=ok`、`version=mvp-1.27.0`。
- Git管理外証跡: `dist/deploy-130-verify.mjs`、`dist/deploy-130-result.json`、`dist/deploy-130-build.log`、`dist/deploy-130-entry-android-standalone.png`、`dist/deploy-130-help-ios-browser.png`。既存の未コミット3文書・未追跡ファイルはそのまま保持し、公開に含めない。
