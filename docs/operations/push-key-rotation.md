# VAPID 鍵ローテーション

VAPID 鍵は Push 配送の送信者鍵であり、`VAPID_PRIVATE_KEY` を Git、コンテナ image、Actions output、ログへ置かない。値は root 所有 `0600` の `/etc/atoqueue/notification-api.env` だけで管理する。

VAPID 鍵を交換すると、既存の Push subscription は無効になるか、再登録が必要になる。通知 DB に旧 subscription を残しても、配送継続は保証されない。ローテーションは利用者のタスクデータを移す作業ではない。

## 実施手順

1. 影響範囲、実施時刻、利用者向け案内を決める。Push は正確な配送を保証しないため、通知が届かない間もアプリを開いて今日の確認を使えることを案内する。
2. 安全な管理端末または VPS の `atoqueue-deploy` ユーザーで新しい VAPID 鍵ペアを生成する。VPSでは、既存サービスの host Node.js を使わず、専用 runtime を先頭にした `PATH` と同ユーザーのホームディレクトリで次を実行する。秘密鍵を端末のシェル履歴、リポジトリ、チケット、ログへ貼り付けない。

   ```bash
   sudo -u atoqueue-deploy -H sh -c '
     cd /home/atoqueue-deploy
     PATH=/opt/atoqueue/runtime/node/bin:/usr/bin:/bin
     export PATH
     exec /opt/atoqueue/runtime/node/bin/corepack pnpm@10.20.0 dlx web-push@3.6.7 generate-vapid-keys
   '
   ```

3. `/etc/atoqueue/notification-api.env` の `VAPID_PUBLIC_KEY` と `VAPID_PRIVATE_KEY` を同一ペアへ更新し、権限が root:root / `0600` のままであることを確認する。
4. `sudo systemctl restart atoqueue-notification-api.service` を実行し、`curl --fail --silent --show-error https://api.atoqueue.sikumilab.com/healthz` が成功することを確認する。
5. 管理者端末 1 台で通知を再設定し、汎用通知とクリック遷移を確認する。旧 subscription の 404/410 は dispatcher が無効化する。

## 利用者向け回復状態

VAPID ローテーション後、端末では 401/`DEVICE_NOT_FOUND`、購読更新失敗、または通知未着を「通知を再設定してください」と表示する。クライアントは旧 `pushDeviceId` と `pushDeviceSecret` を消し、通知を無効状態に戻す。利用者は設定画面の `通知を設定する` を押して許可と購読をやり直す。

再登録後、端末内に残る active task の匿名 reminder outbox を再送する。タスク本文は通知 API・Push payload・運用ログへ送らない。許可拒否や非対応ブラウザでは、設定画面がブラウザ設定またはアプリ内の今日の確認への案内を表示する。

## 記録

鍵値は記録せず、実施時刻、実施者、旧 subscription の無効化数、再登録確認端末数、health check、利用者向け案内、未解決の通知不達だけを運用記録に残す。
