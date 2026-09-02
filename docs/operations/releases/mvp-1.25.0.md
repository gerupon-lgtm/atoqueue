# mvp-1.25.0 検証記録

## 対象

- 要件: F-001、F-002、NF-001、NF-009
- 変更: 通知設定を処理済みの端末で、起動時または他画面から記録画面へ遷移した時に入力欄へフォーカスし、対応するChromiumブラウザへソフトキーボード表示を要求する
- 維持: 通知設定が未処理で案内を表示する間は自動フォーカスしない。非対応ブラウザやOS側で表示要求が受理されない場合も、入力欄のフォーカスと既存操作を維持する
- 対象外: 保存形式、通知API、DB migration、通知予約・文面

## 自動検証（2026-09-03）

- RED: `QuickCapturePage` の通知設定済みケースへVirtual Keyboard APIの呼出し期待を追加し、修正前は0回で失敗することを確認
- 対象単体・結合: 3ファイル30件成功
- 全単体・結合: 63ファイル569件成功（`--maxWorkers=2`）
- E2E: 51件成功。起動時と受信箱から記録画面へ戻った時の入力フォーカスを含む
- 型検査: contracts、domain、api、webの4ワークスペースで成功
- Lint: 成功
- build: contracts、domain、api、webで成功
- GitHub Pages SPA fallback: 成功
- 独立レビュー: 標準違反なし、仕様漏れなし、スコープ超過なし

通常の全テストとLintを並列実行した最初の確認では、APIテスト2件だけが既定5秒を超えてタイムアウトした。対象2ファイル17件の単独再実行は成功し、その後、ワーカー数を2へ制限した全569件も成功したため、機能失敗ではなく検証時のCPU競合と判断した。

## 実機受入

- Pixel／インストール済みPWAで、通知設定を処理済みの状態からアプリを記録画面で起動し、ソフトキーボードが表示されること
- Pixelで受信箱・今日・タスク・設定のいずれかから「記録」へ移動し、ソフトキーボードが表示されること
- 通知設定を一度も処理していない状態では、通知案内を優先しソフトキーボードを自動表示しないこと

OSとブラウザがソフトキーボードの最終表示を制御するため、自動検証では入力フォーカスと `navigator.virtualKeyboard.show()` の呼出しまでを保証し、表示そのものはPixel実機で確認する。

## 配置

- 対象コミット: `8c850ff11bfe4388fc9f47e2dd231336bb10fd08`
- GitHub Actions: [Run 33688451672](https://github.com/gerupon-lgtm/atoqueue/actions/runs/33688451672)
- 2026-09-03 07:06 JST、品質、GitHub Pages、OCI通知APIの3ジョブがすべて成功した。
- 公開PWA `https://atoqueue.sikumilab.com/` はHTTP 200。配布JS `/assets/index-H8Z4YZUj.js` もHTTP 200で、`mvp-1.25.0`とVirtual Keyboard APIの処理を含むことをキャッシュ回避付きで確認した。
- 通知API `https://api.atoqueue.sikumilab.com/healthz` はHTTP 200相当、`status: ok`、`version: mvp-1.25.0`を返した。
- 同一SHAのpush版CI／Deploy品質Run、PR版CI／Deploy品質Runもすべて成功した。
- Pixelでのソフトキーボード実表示は利用者による実機受入を残す。
