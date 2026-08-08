# 実機 Push スモークテスト

## 目的

本番の PWA で、通知許可・購読登録・API・Web Push・通知クリック後の安全な画面遷移を確認する。

- 対象 PWA: `https://atoqueue.sikumilab.com`
- 対象 API: `https://api.atoqueue.sikumilab.com`
- タスク本文、期限、カテゴリ、操作履歴は送らない。
- ブラウザの保存済み端末秘密を表示、コピー、送信先への記録のいずれもしない。

これは手元の実機ブラウザでのみ実行する確認手順である。通常利用では不要であり、定期運用には使わない。

## 設定画面への直接アクセス

GitHub Pages は静的サイトのため、`/settings` のような直接URLには通常のサーバールートがない。Webビルドは `index.html` と同一内容の `404.html` を同梱し、GitHub Pages が返すフォールバック画面から React Router が `https://atoqueue.sikumilab.com/settings` を表示する。

このため、ブラウザ上で設定画面が表示されることを確認する。HTTPステータス自体は GitHub Pages の仕様により `404` でもよく、既定のGitHub 404画面ではなくPWAの設定画面が描画されることを合格条件とする。

## 事前条件

1. 通知を受信したい実機の Chrome または Edge で PWA を開く。
2. `設定` 画面で `通知を設定する` を押し、`通知を設定しました。` と表示されている。
3. 開発者ツールの Console を開く。Windows の Chrome / Edge では `F12`、続けて `Console` タブを選ぶ。

## 匿名テスト通知を1件だけ予約する

Console に次のコードをそのまま貼り付けて実行する。Chrome が貼り付け保護を表示した場合は、その画面の案内に従って貼り付けを許可してから実行する。

```js
void (async () => {
  const snapshot = JSON.parse(
    localStorage.getItem("atoqueue:data:v1") ?? "null",
  );
  const deviceId = snapshot?.device?.pushDeviceId;
  const deviceSecret = snapshot?.device?.pushDeviceSecret;
  if (!deviceId || !deviceSecret) {
    throw new Error("このブラウザでは通知の設定が完了していません。");
  }

  const reminderId = crypto.randomUUID();
  const response = await fetch(
    `https://api.atoqueue.sikumilab.com/v1/reminders/${reminderId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deviceSecret}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        deviceId,
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
        notificationType: "task_review",
      }),
    },
  );
  if (!response.ok)
    throw new Error(`テスト通知の予約に失敗しました: HTTP ${response.status}`);
  console.info("匿名テスト通知を予約しました。最大6分待ってください。");
})();
```

`deviceSecret` を `console.log` してはならない。上のコードは秘密値を HTTP の Authorization ヘッダーへ渡すだけで、Console に出力しない。

## 通知設定が失敗したときの表示

通知設定の失敗時、画面は端末秘密やPush subscriptionを表示せず、次のいずれかを案内する。

| 画面の案内                         | 意味                                 | 利用者が行うこと                               |
| ---------------------------------- | ------------------------------------ | ---------------------------------------------- |
| ブラウザで通知購読を作成できない   | ブラウザ／OSのPush購読段階で停止した | サイトの通知許可とブラウザのPush対応を確認する |
| 短時間に通知設定を繰り返した       | APIの端末登録回数制限に達した        | しばらく待ってから再試行する                   |
| 通知サービスへの端末登録に失敗した | API登録または通信が失敗した          | API healthを確認し、時間をおいて再試行する     |
| 通知設定をこの端末に保存できない   | localStorage保存が失敗した           | ブラウザの保存容量とサイト設定を確認する       |

## 合格条件

1. Console に `匿名テスト通知を予約しました。最大6分待ってください。` と表示される。
2. 最大6分以内に、タスク本文を含まない汎用の通知が届く。
3. 通知を押すと PWA の `今日` 画面が開く。

このテストの `reminderId` はローカルタスクに紐づけない。そのため、クリック後に特定タスクを開かず `今日` 画面へ安全に戻ることが正しい結果である。

## 失敗時に記録するもの

次だけを共有する。端末秘密、Push subscription、localStorage 全文、タスク本文は共有しない。

- 実行日時と端末種別・OS・ブラウザ名/版
- Console に出た HTTP ステータスまたはエラー文
- 通知が届いたか、クリック後にどの画面が開いたか
- API の状態確認結果: `https://api.atoqueue.sikumilab.com/healthz`

通知は最大5分ごとの配送ポーリングで扱うため、正確な時刻配送は保証しない。通知が届かない場合も、PWA を開いたときの `今日` の再計算が主たるリマインド経路である。
