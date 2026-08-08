# 本番配置手順

対象は GitHub Pages の PWA `https://atoqueue.sikumilab.com` と、OCI VPS の通知 API `https://api.atoqueue.sikumilab.com` である。API は Caddy の TLS 終端の内側で、`127.0.0.1:3030` にだけ待受する。通知用 PostgreSQL は `atoqueue_notify`、アプリ接続ロールは `atoqueue_notify_app` を使う。コンテナ、ローカル DB ボリューム、VAPID 鍵をリポジトリや Actions 出力へ置かない。

## 初回の管理者作業

以下は本リポジトリでは実行しない、環境管理者が一度だけ行う作業である。

1. Cloudflare で `atoqueue.sikumilab.com` を GitHub Pages、`api.atoqueue.sikumilab.com` を OCI VPS の A/AAAA レコードへ向け、両方を **DNS only** にする。GitHub Pages の Custom domain を `atoqueue.sikumilab.com` に設定し、HTTPS 強制を有効にする。
2. GitHub の `production` environment を作り、required reviewers を設定する。Repository secrets に `DEPLOY_HOST`、専用鍵の `DEPLOY_SSH_PRIVATE_KEY`、検証済みホスト鍵だけを含む `DEPLOY_SSH_KNOWN_HOSTS`、release manifest 専用の `DEPLOY_ARTIFACT_SIGNING_PRIVATE_KEY` を登録する。署名鍵は SSH 配置鍵とは別ペアにし、Actions 以外から読めない。いずれの秘密鍵も他用途と共有しない。
3. 既存サービスの `/usr/bin/node` は変更しない。あとキュー専用に、root 所有の `/opt/atoqueue/runtime/node/bin/node` へ固定版 Node.js 24 を配置する。`atoqueue` をログイン不可の実行ユーザー、`atoqueue-deploy` を配置専用ユーザーとして作成する。OCI の Security List または Network Security Group と VPS の host firewall では、インターネットからの TCP `80/tcp` と `443/tcp` を Caddy 用に許可し、`3030/tcp` は許可しない。DNS only の A/AAAA レコードが VPS の到達可能なアドレスだけを指すことも、この時点で確認する。

```bash
sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin --user-group atoqueue
sudo useradd --create-home --shell /bin/bash atoqueue-deploy
sudo -u postgres createuser --no-createdb --no-createrole --no-superuser --pwprompt atoqueue_notify_app
sudo -u postgres createdb --owner=atoqueue_notify_app atoqueue_notify
sudo install -d -o root -g root -m 0755 /opt/atoqueue/releases
sudo install -D -o root -g root -m 0750 deploy/scripts/install-atoqueue-node-runtime.sh /usr/local/libexec/atoqueue-install-node-runtime
sudo /usr/local/libexec/atoqueue-install-node-runtime
sudo -u atoqueue /opt/atoqueue/runtime/node/bin/node --version
```

この runtime installer は Linux x86_64 用の Node.js `24.18.0` を公式配布物の SHA-256 と照合して配置する。`/usr/bin/node`（このVPSでは既存サービス用の Node.js 20）とグローバルの Corepack は変更も参照もしない。Node.js 24の更新時は、installer のバージョンと SHA-256 を公式リリースに合わせて更新し、静的配置検査を通してから root 管理者が再配置する。

4. root 所有・`0600` の `/etc/atoqueue/notification-api.env` を作る。値は秘密管理から投入し、画面共有・シェル履歴・GitHub Actions のログへ出さない。

VAPID 鍵を VPS で生成する場合は、既存のホストNode.jsではなく専用 runtime を先頭にした `PATH` と、`atoqueue-deploy` が読める作業ディレクトリを使う。

```bash
sudo -u atoqueue-deploy -H sh -c '
  cd /home/atoqueue-deploy
  PATH=/opt/atoqueue/runtime/node/bin:/usr/bin:/bin
  export PATH
  exec /opt/atoqueue/runtime/node/bin/corepack pnpm@10.20.0 dlx web-push@3.6.7 generate-vapid-keys
'
```

表示される鍵値はこの端末でだけ控え、チャット・チケット・リポジトリ・ログへ貼り付けない。

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
sudo systemctl enable --now caddy
sudo systemctl reload caddy
sudo systemctl enable atoqueue-notification-api.service
sudo ss -ltnp '( sport = :80 or sport = :443 )'
```

OCI の Security List / Network Security Group と host firewall の設定内容に TCP `80/tcp` / `443/tcp` 許可、`3030/tcp` 非許可を記録する。VPS 外の管理端末から次を実行し、`80` と `443` が timeout ではなく Caddy の HTTP 応答を返し、`3030` は接続できないことを確認する（初回で API 未配置なら HTTPS は `502` でもよい）。

```bash
curl --head --connect-timeout 10 http://api.atoqueue.sikumilab.com
curl --head --connect-timeout 10 https://api.atoqueue.sikumilab.com
nc -zvw 5 api.atoqueue.sikumilab.com 3030 && exit 1 || true
```

6. 配置用の受信ディレクトリ、root 専用 quarantine、root 所有の activation wrapper を作る。受信ディレクトリは `atoqueue-deploy` だけが読書きでき、wrapper と quarantine は配置ユーザーが変更できない。Actions は wrapper をアップロードも実行もせず、incoming へ release archive、署名済み manifest、署名だけを置く。wrapper は3ファイルを root 専用 quarantine へ一度だけコピーし、その固定コピーだけを署名検証・展開し、成功・失敗のどちらでも incoming を削除する。

```bash
sudo install -d -o atoqueue-deploy -g atoqueue-deploy -m 0700 /var/lib/atoqueue-deploy/incoming
sudo install -d -o root -g root -m 0700 /var/lib/atoqueue-deploy/quarantine
sudo install -D -o root -g root -m 0750 deploy/scripts/deploy-release.sh /usr/local/libexec/atoqueue-deploy-release
sudo install -D -o root -g root -m 0644 /dev/null /etc/atoqueue/deployment-allowed-signers
sudoedit /etc/atoqueue/deployment-allowed-signers
sudo visudo -f /etc/sudoers.d/atoqueue-deploy
```

安全な管理端末で manifest 専用の Ed25519 鍵ペアを作り、private key だけを `DEPLOY_ARTIFACT_SIGNING_PRIVATE_KEY` として登録する。公開鍵は root 所有の `/etc/atoqueue/deployment-allowed-signers` へ次の形式で保存する。private key、archive、manifest、署名の値をリポジトリやログへ置かない。

```bash
ssh-keygen -t ed25519 -f atoqueue-artifact-signing -C github-actions
# /etc/atoqueue/deployment-allowed-signers に次の1行を保存する
github-actions ssh-ed25519 PUBLIC_KEY_MATERIAL
```

`/etc/sudoers.d/atoqueue-deploy` には次だけを記載する。wrapper は archive の完全なパスと40文字の小文字 SHAを再検証し、Actions の別署名鍵による manifest（release ID と archive SHA-256）を `ssh-keygen -Y verify` で検証してから、root での展開・symlink切替・systemd再起動と、`atoqueue` 権限の migration を行う。`systemctl`、`systemd-run`、`chown`、任意 shell の sudo 権限を `atoqueue-deploy` へ直接与えない。

```sudoers
Cmnd_Alias ATOQUEUE_ACTIVATE = /usr/local/libexec/atoqueue-deploy-release /var/lib/atoqueue-deploy/incoming/atoqueue-api-release-*.tar.gz *
atoqueue-deploy ALL=(root) NOPASSWD: ATOQUEUE_ACTIVATE
```

保存後に必ず `sudo visudo -cf /etc/sudoers.d/atoqueue-deploy` を実行する。`deploy-release.sh` を変更したリリースは、別途 root 管理者が内容と mode `0750` / owner `root:root`、allowed signers file の owner `root:root` / mode `0644` をレビューして wrapper を再配置する。runtime の `atoqueue` は release tree を読取り・実行するだけで、書込み権限を持たない。

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
4. `Publish PWA to GitHub Pages` は `apps/web/dist` に CNAME を含めて公開する。`Deploy notification API to OCI VPS` は専用 SSH 鍵で `atoqueue-deploy` に接続し、private incoming directory へ archive、release ID と SHA-256 を含む manifest、その署名を送る。root wrapper は別の Actions 署名鍵で manifest を検証するため、SSH 配置鍵だけでは任意コードを migration として実行できない。

VPS 上の `deploy-release.sh` は、専用 runtime に同梱された Corepack だけを使ってリリース用ディレクトリへ依存関係を production mode で入れる。migration は `systemd-run` の一時 unit として `atoqueue` ユーザーおよび専用 Node.js 24 で実行し、systemd だけが root 所有の環境ファイルを読むため、配置ユーザーは DB 接続情報・VAPID 鍵を読めない。続いて `current` symlink を切替え、systemd を再起動し、loopback の `/healthz` が 200 になることを確認する。migration、再起動、health check のいずれかが失敗すると、前リリースを `current` に戻して再起動する。

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
