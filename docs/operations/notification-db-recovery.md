# 通知 DB の復旧

通知サーバーの PostgreSQL は、端末内タスクの正本ではない。保存対象は匿名端末 ID、購読、予約 ID、予定時刻、通知種別、配送状態だけであり、タスク本文・メモ・カテゴリ・期限の意味・操作履歴は保存しない。

OCI Object Storage 連携と定期通知 DB バックアップは MVP の対象外である。従って DB 障害時に失われうるのは Push 用の匿名サーバー状態であり、PWA のローカルデータと「今日の確認」は失わない。

## migration 前の任意手動バックアップ

スキーマ変更があるリリースの直前に、VPS 管理者が実行する。出力は root のみが読める場所へ保管し、バックアップを Git や Actions artifact に置かない。

```bash
sudo install -d -o root -g root -m 0700 /var/backups/atoqueue
sudo -u postgres pg_dump --format=custom --file /var/backups/atoqueue/atoqueue_notify-$(date +%F-%H%M%S).dump atoqueue_notify
sudo chmod 0600 /var/backups/atoqueue/atoqueue_notify-*.dump
sudo -u postgres pg_restore --list /var/backups/atoqueue/atoqueue_notify-YYYY-MM-DD-HHMMSS.dump
```

復元が必要なら、必ず API を止めた上で別名 DB への `pg_restore` 検証を先に行う。既存 DB を上書きする復元は、障害対応責任者の判断でのみ実行する。

## DB 消失後の復旧フロー

1. `https://api.atoqueue.sikumilab.com/healthz` が 200 以外、または PostgreSQL 障害であることを確認する。PWA のローカルデータを消去しない。
2. `atoqueue_notify` と `atoqueue_notify_app` を復旧または作り直し、`/etc/atoqueue/notification-api.env` の `DATABASE_URL` がこの DB/role を指すことを確認する。
3. [配置手順](deployment.md) に従って API を配置し、migration、systemd 再起動、`/healthz` 200 を確認する。空の DB は migration で通知用テーブルだけを再作成する。
4. 各利用者は PWA を開く。既存の匿名端末資格情報による outbox 再送は 401 または `DEVICE_NOT_FOUND` になり、クライアントは古い `pushDeviceId`、`pushDeviceSecret`、登録日時を端末内から除去し、通知設定を未有効状態へ戻す。
5. 利用者は設定画面で `通知を設定する` を明示操作する。新規端末登録後、残っている active task の匿名 reminder outbox を再送する。失敗した通知をサーバーから復元しようとしない。
6. 各端末で汎用通知のテスト、通知クリックから今日の確認へ戻る動作、active task のローカル状態が残っていることを確認する。

復旧中も通知は遅延または不達になりうる。利用者には「アプリを開いて今日の確認を使える」「通知を再設定する」を案内し、OS 通知を唯一のリマインド手段として扱わない。

## 復旧完了の記録

以下を障害記録へ残す。タスク本文、Push endpoint、鍵、Bearer 値は記録しない。

- 障害検知・復旧開始・`/healthz` 200 の時刻
- 対象 DB と role が `atoqueue_notify` / `atoqueue_notify_app` であること
- systemd 再起動結果と pending job が PostgreSQL に保存されていること
- 再登録・active reminder 再同期を確認した端末数
- 通知不達または利用者への案内内容
