# Task 15 デプロイ前レビュー（修正後）

対象: `9cc8f54` の Task 15 成果物と、このレビューで加えた修正。

## P1（修正済み）

1. runtime ユーザー `atoqueue` が release tree を再帰的に所有し、systemd から同 tree への書込みも許可されていた。API が侵害された場合に配置済みコードを永続的に改ざんできた。release は root 所有・runtime 非書込みへ変更し、unit の `ReadWritePaths` を削除した。
2. Actions が予測可能で world-writable な `/tmp` に archive と実行スクリプトを置いていた。別の VPS ユーザーによる置換競合が可能だった。archive は `atoqueue-deploy` 専用 `0700` の incoming directory へだけ送信し、root 所有の固定 wrapper だけを sudo 実行する方式へ変更した。
3. 初回手順が Caddy を検証するだけで設定を reload/start せず、OCI/host firewall の TCP 80/443 到達性確認もなかった。Caddy の有効化・reload、外部到達性確認、3030 非公開確認を手順へ追加した。
4. `atoqueue-deploy` の sudo 最小権限が具体化されておらず、安全な migration 実行を構成できなかった。root 所有 wrapper と `visudo` で検証する wrapper 単体の sudoers 例を追加した。archive 展開と dependency lifecycle は root ではなく `atoqueue-deploy` として実行する。
5. SSH 配置鍵だけで任意 archive を正規リリースのように投入でき、migration が `atoqueue` の秘密環境で実行される余地があった。SSH 鍵とは別の Actions 専用署名鍵で release ID と archive SHA-256 の manifest を署名し、root wrapper が root 所有の公開鍵で署名・digest・release ID を検証してから展開するよう変更した。incoming の検証後置換を防ぐため、wrapper は3ファイルを root 専用 quarantine へ一度だけコピーし、その固定コピーだけを検証・展開する。未署名または不一致の archive は migration 前に拒否する。

## 残存 P2

- GitHub Actions は `@v4` / `@v5` など可変の major tag を使っている。production secrets / Pages OIDC を扱うため、次回のセキュリティ強化で各 action をコミット SHA に pin する。

## 検証

- `node deploy/scripts/verify-deployment-artifacts.mjs` — PASS
- `bash -n deploy/scripts/deploy-release.sh` — PASS
- Prettier（YAML / MJS / Markdown）— PASS
- `pnpm typecheck` — PASS
- `git diff --check` — PASS
- `pnpm lint` は今回と無関係な既存4件で FAIL（`security.ts`、`QuickCapturePage.test.tsx`、`SettingsPage.test.tsx`、`service-worker.ts`）。

## 判定

静的レビューでは P1 は解消済みで、外部配置へ進める。実際の `production` 承認前に、手順にある root wrapper と trusted public key の配置、sudoers 構文検証、OCI/host firewall、Caddy TLS 到達性を環境管理者が実施・記録すること。
