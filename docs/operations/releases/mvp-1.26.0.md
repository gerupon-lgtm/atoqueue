# mvp-1.26.0 検証記録

## 対象

- 要件: F-001、F-002、NF-001、NF-009
- 記録画面の同期的な起動判定によるマウント直後フォーカス復元
- Web、API、全ワークスペース版: `mvp-1.26.0` / `1.26.0`

## 実装

- 有効な保存済みSnapshotだけをローカル保存アダプタで同期検証し、通知設定が処理済みかをルーター経由で公開UIへ渡す。
- 非同期のSnapshot・下書き読込が未解決でも、処理済み端末は本文入力欄へ一度だけフォーカスし、対応ブラウザへVirtual Keyboard APIの表示を一度だけ要求する。
- 未処理、保存なし、破損または未知版では自動フォーカス・表示要求をしない。非対応・例外時も入力欄のフォーカスを維持する。
- 保存形式、通知API、DB migration、通知文面は変更していない。

## 検証

- RED: `QuickCapturePage` の未解決ロード中テストとローカル保存同期判定テストが、実装前に期待どおり失敗することを確認した。
- GREEN: 対象のQuickCapturePage・LocalStorageRepositoryテストを実行し、追加した回帰ケースを含めて成功した。
- 全ワークスペース単体・結合テスト574件、lint、Web/API/contracts/domainの型検査、全build、GitHub Pages SPA成果物検査が成功した。
- Chromium E2Eは記録画面の保存・再読込と、起動時および画面復帰時のフォーカスを2件とも成功した。通常サンドボックスではChromium起動がEPERMとなるため、ローカル許可環境で同一テストを実行した。

## 受入・配置

- 2026-09-03 08:11 JST、コミット `ba7201eb3920739f27342edb9e11528b20f52bdb` を本番へ配置した。
- GitHub Actions `Deploy` run: https://github.com/gerupon-lgtm/atoqueue/actions/runs/33693653036
- `https://atoqueue.sikumilab.com/` の公開HTMLが新しい `index-3TumLa0g.js` を参照し、同JavaScriptに `mvp-1.26.0` とVirtual Keyboard処理が含まれることを確認した。
- `https://api.atoqueue.sikumilab.com/healthz` が `status: ok`、`version: mvp-1.26.0` を返すことを確認した。
- Pixel実機で、通知設定を処理済みの端末の起動時および他画面から記録画面へ戻った時にOSキーボードが表示されることを公開後に確認する。自動テストは公開UIのフォーカスとVirtual Keyboard API呼出しまでを検証対象とする。
