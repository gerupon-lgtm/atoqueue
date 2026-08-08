# API 起動待機とデプロイ確認

通知 API の初回起動では、PostgreSQL 接続、スキーマ確認、モジュール読込を終えてから `127.0.0.1:3030` の待受を開始する。この間、サービスプロセスが `active (running)` でも `/healthz` はまだ接続できないことがある。

`/usr/local/libexec/atoqueue-deploy-release` は、起動直後に1回だけ確認して失敗扱いにしてはならない。`/usr/local/libexec/atoqueue-wait-for-health.mjs` を専用 Node.js 24 runtime で実行し、2秒間隔・最大60回（約2分）で loopback の `/healthz` が HTTP 200 になるまで待つ。

初回セットアップ時、またはこの運用スクリプトを更新する場合は、両方を root 所有で配置する。

```bash
sudo install -D -o root -g root -m 0750 \
  deploy/scripts/deploy-release.sh \
  /usr/local/libexec/atoqueue-deploy-release
sudo install -D -o root -g root -m 0644 \
  deploy/scripts/wait-for-health.mjs \
  /usr/local/libexec/atoqueue-wait-for-health.mjs
```

手動確認は、起動後に次で行う。

```bash
sudo systemctl is-active atoqueue-notification-api.service
curl --fail --silent --show-error http://127.0.0.1:3030/healthz
curl --fail --silent --show-error https://api.atoqueue.sikumilab.com/healthz
```
