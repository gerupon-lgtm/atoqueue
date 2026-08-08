import { useEffect, useState } from "react";
import type { AppRepository } from "../../../../../packages/domain/src";
import { NotificationApi } from "../../infrastructure/notifications/notification-api";
import {
  createBrowserPushAdapter,
  enableNotifications,
  type NotificationSetupErrorReason,
  type NotificationSetupResult,
} from "../../infrastructure/notifications/push-subscription";

export interface NotificationSettingsProps {
  repository: AppRepository;
  setup?: () => Promise<NotificationSetupResult>;
}

/** Settings keeps permission behind a deliberate button press. */
export function NotificationSettings({
  repository,
  setup,
}: NotificationSettingsProps) {
  const [state, setState] = useState<
    NotificationSetupResult["state"] | "stale" | "diagnostic_error"
  >();
  const [errorReason, setErrorReason] =
    useState<NotificationSetupErrorReason>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void repository.load().then((snapshot) => {
      if (!active) return;
      if (
        snapshot.device.pushSubscriptionStatus === "granted" &&
        !snapshot.settings.notificationEnabled
      ) {
        setState(snapshot.device.pushDeviceSecret ? "error" : "stale");
        return;
      }
      setState(
        snapshot.device.pushSubscriptionStatus === "not_requested"
          ? undefined
          : snapshot.device.pushSubscriptionStatus,
      );
    });
    return () => {
      active = false;
    };
  }, [repository]);

  async function configure(): Promise<void> {
    setBusy(true);
    try {
      const result = await (
        setup ??
        (() =>
          enableNotifications({
            repository,
            api: new NotificationApi("https://api.atoqueue.sikumilab.com"),
            browser: createBrowserPushAdapter(),
          }))
      )();
      setState(result.state === "error" ? "diagnostic_error" : result.state);
      setErrorReason(result.state === "error" ? result.reason : undefined);
    } catch {
      setState("error");
      setErrorReason(undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="notification-settings-title">
      <h1 id="notification-settings-title">通知</h1>
      <p>
        通知を使うと、アプリを開いて今日の確認に戻るきっかけを受け取れます。
      </p>
      <p>タスク本文は通知サーバーへ送信しません。</p>
      <button
        disabled={busy || state === "denied"}
        onClick={() => void configure()}
        type="button"
      >
        通知を設定する
      </button>
      {state === "granted" ? <p role="status">通知を設定しました。</p> : null}
      {state === "denied" ? (
        <p role="alert">ブラウザの設定から通知を許可してください。</p>
      ) : null}
      {state === "unavailable" ? (
        <p role="alert">
          このブラウザでは通知を利用できません。アプリを開いて今日の確認を使えます。
        </p>
      ) : null}
      {state === "error" ? (
        <p role="alert">
          通知の設定を完了できませんでした。後でもう一度お試しください。
        </p>
      ) : null}
      {state === "stale" ? (
        <p role="alert">通知を再設定してください。</p>
      ) : null}
      {state === "diagnostic_error" ? (
        <p role="alert">{errorMessage(errorReason)}</p>
      ) : null}
    </section>
  );
}

function errorMessage(
  reason: NotificationSetupErrorReason | undefined,
): string {
  switch (reason) {
    case "subscription":
      return "ブラウザで通知購読を作成できませんでした。ブラウザのサイト設定を確認してから、もう一度お試しください。";
    case "rate_limited":
      return "短時間に通知設定を繰り返したため、しばらく待ってからもう一度お試しください。";
    case "storage":
      return "通知設定をこの端末に保存できませんでした。ブラウザの保存容量とサイト設定を確認してください。";
    default:
      return "通知サービスへの端末登録に失敗しました。時間をおいて、もう一度お試しください。";
  }
}
