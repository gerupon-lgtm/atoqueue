# 本番公開確認記録（2026-08-08）

## 対象

- PWA: `https://atoqueue.sikumilab.com`
- 通知 API: `https://api.atoqueue.sikumilab.com`
- リリース: `918a498083e1cb030616a9ac29b70f450b287a30`

## 確認済み

| 項目                         | 結果 | 確認方法                                                                         |
| ---------------------------- | ---- | -------------------------------------------------------------------------------- |
| GitHub Actions の手動 Deploy | 成功 | workflow dispatch の完了結果                                                     |
| API 外部 HTTPS               | 成功 | `GET /healthz` が HTTP 200 と `status: "ok"` を返す                              |
| API の CORS                  | 成功 | PWA origin の preflight が HTTP 204、`Access-Control-Allow-Origin` が PWA origin |
| Push 公開鍵                  | 成功 | `GET /v1/push/public-key` が HTTP 200、レスポンスは `publicKey` のみ             |
| PWA 外部 HTTPS               | 成功 | `https://atoqueue.sikumilab.com/` が HTTP 200                                    |
| PWA manifest                 | 成功 | 日本語名、standalone、192/512/maskable icon を確認                               |
| Service Worker 配信          | 成功 | 公開 HTML が登録用アセットを参照                                                 |
| 初期画面                     | 成功 | 記録・受信箱・今日・タスク・設定の主要ナビゲーションと記録フォームを確認         |
| 設定画面                     | 成功 | バックアップ、通知、ローカル保存方針を確認                                       |

## 未実施の端末確認

OS通知の許可と実際のPush受信は、利用者が通知を使う意思を示した端末でだけ実施する。初回表示時に許可ダイアログを自動表示しない設計であるため、次の操作は手動確認として残す。

1. PWA の設定画面で `通知を設定する` を選ぶ。
2. ブラウザの通知許可を与える。
3. 通知対象になるタスクを作成し、通知時刻を待つ。
4. 汎用文の通知が届き、通知から該当の確認画面へ戻れることを確認する。

この確認時も、通知本文や API 通信にタスク本文が含まれないことを維持する。
