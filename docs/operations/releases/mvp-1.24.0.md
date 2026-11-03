# mvp-1.24.0 検証記録

確認日: 2026-09-01

対象要件: F-002、F-003、F-014、F-018、NF-003、NF-004、NF-005、NF-010

## 原因と修正

- Pixel、通知許可、送信上限が今回の原因ではない。利用者が追加した新規記録は1件であり、レート制限を原因とする前提は採用しない。
- `mvp-1.23.0`では、新規未整理を保存して受信箱系列の起点が変わると、同期済み4予約を `DELETE` する操作を先に4件、別IDで再登録する `PUT` を後に4件作っていた。
- クイック入力の通知同期は保存後に非同期で進むため、アプリのバックグラウンド化や通信中断が取消後・再登録前に起きると、旧初回予約だけが取消され、新しい初回予約がサーバーに存在しない状態が残った。起動時補完も端末内の対応情報が残っているため、欠損と判定できなかった。
- 対応する全体系列の予約IDを維持し、同じIDへの `PUT` で予定時刻を更新する。予約数が変わらない新規追加では取消を作らず、系列からなくなった余剰枠だけを取消す。これにより最初のHTTP要求で最新の初回予約がサーバーへ反映される。
- 保存schemaVersion、通知API項目、DB migration、通知文面、通知頻度は変更しない。タスク本文・記録本文・局所IDを通知バックエンドへ送らない。

## TDD記録

- RED: 実APIとクイック入力相当の `createCapture` 経路を使い、既存系列がある状態で1件だけ新規投稿し、最初のHTTP要求後に同期を中断すると、最新の初回予約がサーバーに存在せず失敗することを確認した。
- GREEN: 対応する予約IDを維持した更新へ変更後、同じ中断条件でも最初のHTTP要求で最新初回予約が `pending` になり、対象テストが成功した。
- 関連回帰: Domain・Webの5ファイル71件が成功。新規初回の後ろ倒し、初回通知済み後の追加、無変更系列保持、Outbox再送も維持した。

## 検証

- 全単体・結合: 63ファイル569件成功。
- Playwright E2E: Chromium 50件成功。初回は実行環境のChromium起動制限 `spawn EPERM` で開始できなかったため、同じ成果物・同じ50件をブラウザ起動権限付きで再実行した。
- ESLint、全ワークスペース型検査、全ワークスペースビルド: 成功。
- Prettier（CI対象）と配置成果物契約検査: 成功。

## 公開状況

- 配置コミット: `d58946a3d699db38a8a36ecfa8e3ac6d528cb00b`。
- push後の [CI Run 33520067935](https://github.com/gerupon-lgtm/atoqueue/actions/runs/33520067935) とDeploy品質確認 Run `33520067954` は成功。
- [本番デプロイ Run 33520266123](https://github.com/gerupon-lgtm/atoqueue/actions/runs/33520266123) は、品質確認、PWA公開、OCI通知API配置の全ジョブが成功。
- 2026-09-01 23:37 JST、公開PWAはHTTP 200。公開JS `/assets/index-CZZ1li1s.js` はHTTP 200で、ローカル検証済みbuildと同じ成果物名、`mvp-1.24.0` と通知系列処理を含む。
- 通知API `https://api.atoqueue.sikumilab.com/healthz` はHTTP 200、`status: ok`、`version: mvp-1.24.0`。
- GitHub CLIは `gerupon-lgtm` としてOS keyringへ再認証し、`gh auth setup-git`でGit HTTPS認証へ連携した。token scopeは `repo` / `workflow` を含む。
