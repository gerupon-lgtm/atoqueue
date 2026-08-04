# 本番配置手順

対象は GitHub Pages の PWA `https://atoqueue.sikumilab.com` と、OCI VPS の通知 API `https://api.atoqueue.sikumilab.com` である。API は Caddy の TLS 終端の内側で、`127.0.0.1:3030` にだけ待受する。通知用 PostgreSQL は `atoqueue_notify`、アプリ接続ロールは `atoqueue_notify_app` を使う。コンテナ、ローカル DB ボリューム、VAPID 鍵をリポジトリや Actions 出力へ置かない。

## 初回の管理者作業

以下は本リポジトリでは実行しない、環境管理者が一度だけ行う作業である。

1. Cloudflare で `atoqueue.sikumilab.com` を GitHub Pages、`api.atoqueue.sikumilab.com` を OCI VPS の A/AAAA レコードへ向け、両方を **DNS only** にする。GitHub Pages の Custom domain を `atoqueue.sikumilab.com` に設定し、HTTPS 強制を有効にする。
2. GitHub の `production` environment を作り、required reviewers を設定する。Repository secrets に `DEPLOY_HOST`、専用鍵の `DEPLOY_SSH_PRIVATE_KEY`、検証済みホスト鍵だけを含む `DEPLOY_SSH_KNOWN_HOSTS` を登録する。鍵は `atoqueue-deploy` 専用で、他用途と共有しない。
3. VPS に Node.js 24、Corepack、pnpm 10、PostgreSQL client、Caddy を導入する。`atoqueue` をログイン不可の実行ユーザー、`atoqueue-deploy` を配置専用ユーザーとして作成する。

```bash
sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin --user-group atoqueue
sudo useradd --create-home --shell /bin/bash atoqueue-deploy
sudo -u postgres createuser --no-createdb --no-createrole --no-superuser --pwprompt atoqueue_notify_app
sudo -u postgres createdb --owner=atoqueue_notify_app atoqueue_notify
sudo install -d -o atoqueue-deploy -g atoqueue-deploy -m 0755 /opt/atoqueue/releases
```

4. root 所有・`0600` の `/etc/atoqueue/notification-api.env` を作る。値は秘密管理から投入し、画面共有・シェル履歴・GitHub Actions のログへ出さない。

```dotenv
PORT=3030
DATABASE_URL=postgresql://atoqueue_notify_app:REDACTED@localhost:5432/atoqueue_notify
ALLOWED_ORIGIN=https://atoqueue.sikumilab.com
VAPID_PUBLIC_KEY=REDACTED
VAPID_PRIVATE_KEY=REDACTED
VAPID_SUBJECT=mailto:gerupon@gmail.com
LOG_LEVEL=info
```

```bash
sudo install -o root -g root -m 0600 /dev/null /etc/atoqueue/notification-api.env
sudoedit /etc/atoqueue/notification-api.env
```

5. Caddy と systemd の成果物を配置し、Caddy 設定の構文検査を通す。Caddy の主設定から `/etc/caddy/conf.d/*.caddyfile` を import することを確認する。

```bash
sudo install -D -o root -g root -m 0644 deploy/caddy/atoqueue-api.caddyfile /etc/caddy/conf.d/atoqueue-api.caddyfile
sudo install -D -o root -g root -m 0644 deploy/systemd/atoqueue-notification-api.service /etc/systemd/system/atoqueue-notification-api.service
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable caddy atoqueue-notification-api.service
```

`atoqueue-deploy` には、`deploy/scripts/deploy-release.sh` が使う `/opt/atoqueue/releases` の symlink 切替、`atoqueue-notification-api.service` の restart/stop、リリースディレクトリの所有権変更、環境ファイルを読む `atoqueue` ユーザーの transient migration unit だけを sudo 許可する。任意コマンドの sudo を許可しない。実際の sudoers ルールは VPS の OS パスに合わせて管理者がレビューする。

## リリース前の確認

ローカルまたは CI で次を実行する。最初の二つは Web/API のビルドを明示的に確認する。

```powershell
pnpm install --frozen-lockfile
pnpm --filter @atoqueue/web build
pnpm --filter @atoqueue/api build
node deploy/scripts/verify-deployment-artifacts.mjs
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

DB スキーマを変更するリリースでは、先に [通知 DB 復旧手順](notification-db-recovery.md) の手動 `pg_dump` を取得する。

## GitHub Actions での本番配置

1. `Deploy` workflow を `Run workflow` から実行し、対象のコミット SHA または `main` を入力する。
2. `production` environment の承認者が承認する。承認されるまで PWA と API は配置されない。
3. `Test and build` が Node 24 で lint、型検査、テスト、Web/API build、配置成果物の静的検査を完了することを確認する。
4. `Publish PWA to GitHub Pages` は `apps/web/dist` に CNAME を含めて公開する。`Deploy notification API to OCI VPS` は専用 SSH 鍵で `atoqueue-deploy` に接続し、アーカイブを `/tmp` に送る。

VPS 上の `deploy-release.sh` は、リリース用ディレクトリへ依存関係を production mode で入れる。migration は `systemd-run` の一時 unit として `atoqueue` ユーザーで実行し、systemd だけが root 所有の環境ファイルを読むため、配置ユーザーは DB 接続情報・VAPID 鍵を読めない。続いて `current` symlink を切替え、systemd を再起動し、loopback の `/healthz` が 200 になることを確認する。migration、再起動、health check のいずれかが失敗すると、前リリースを `current` に戻して再起動する。

## VPS での確認・ログ確認

```bash
curl --fail --silent --show-error https://api.atoqueue.sikumilab.com/healthz
sudo systemctl status atoqueue-notification-api.service --no-pager
sudo journalctl -u atoqueue-notification-api.service --since '30 minutes ago' --no-pager
sudo journalctl -u caddy --since '30 minutes ago' --no-pager
readlink -f /opt/atoqueue/releases/current
```

期待値は `/healthz` が HTTP 200 と JSON の `status: "ok"` を返すこと、systemd が `active (running)` であること、ログにタスク本文・メモ本文・Push 購読鍵・Bearer 値・VAPID 秘密鍵がないことである。外部からの TLS 確認は Caddy を通す HTTPS URL だけで行い、`127.0.0.1:3030` を公開しない。

## 手動ロールバック

自動ロールバックに失敗した場合だけ、既知の正常リリースへ戻す。DB migration の取り消しは自動化しないため、互換性がない変更は事前 dump からの復旧判断を管理者が行う。

```bash
sudo ls -1 /opt/atoqueue/releases
sudo ln -sfn /opt/atoqueue/releases/PREVIOUS_COMMIT_SHA /opt/atoqueue/releases/current
sudo systemctl restart atoqueue-notification-api.service
curl --fail --silent --show-error http://127.0.0.1:3030/healthz
curl --fail --silent --show-error https://api.atoqueue.sikumilab.com/healthz
```

## 本番後の実機確認

承認済みの本番 URL で Caddy HTTPS、`/healthz`、systemd 再起動後の health、保留中通知ジョブが PostgreSQL に残ることを確認する。ブラウザ別の確認は [browser-verification.md](browser-verification.md)、7 日間の利用確認は [pilot checklist](../pilot/7-day-checklist.md) に記録する。公開 staging は MVP では作らない。
