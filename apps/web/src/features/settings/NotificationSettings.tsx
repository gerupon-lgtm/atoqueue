import { useEffect, useRef, useState } from "react";
import {
  rebuildActiveTaskNotifications,
  rebuildGlobalNotificationSchedules,
  type AppRepository,
  type ReminderFrequency,
} from "../../../../../packages/domain/src";
import { NotificationApi } from "../../infrastructure/notifications/notification-api";
import {
  createBrowserPushAdapter,
  createBrowserPushStateProbe,
  enableNotifications,
  inspectBrowserPushState,
  type BrowserPushState,
  type NotificationSetupErrorReason,
  type NotificationSetupResult,
} from "../../infrastructure/notifications/push-subscription";
import "./NotificationSettings.css";
import { formatLocalDateTime } from "../../presentation/format-local-date-time";
import { formatTimeZone } from "../../presentation/format-time-zone";
import { useDelayedSelectInput } from "../../presentation/use-delayed-select-input";
import {
  digits,
  formatTimeDigits,
  timeFromDigits,
} from "../tasks/DeadlineInputFields";

export interface NotificationSettingsProps {
  repository: AppRepository;
  setup?: () => Promise<NotificationSetupResult>;
  inspectBrowserState?: () => Promise<BrowserPushState>;
  flushNotifications?: () => Promise<unknown>;
}

/** Settings keeps permission behind a deliberate button press. */
export function NotificationSettings({
  repository,
  setup,
  inspectBrowserState,
  flushNotifications,
}: NotificationSettingsProps) {
  const [state, setState] = useState<
    NotificationSetupResult["state"] | "stale" | "diagnostic_error"
  >();
  const [errorReason, setErrorReason] =
    useState<NotificationSetupErrorReason>();
  const [busy, setBusy] = useState(false);
  const [activeOperation, setActiveOperation] = useState<
    "setup" | "timing" | "frequency" | "sync"
  >();
  const [initialDelay, setInitialDelay] = useState("60");
  const [deadlineLead, setDeadlineLead] = useState("60");
  const [defaultDeadlineTime, setDefaultDeadlineTime] = useState("2359");
  const [inboxReminderFrequency, setInboxReminderFrequency] = useState<
    "none" | "gentle" | "prompt"
  >("gentle");
  const [memoReviewFrequency, setMemoReviewFrequency] = useState<
    "none" | "weekly" | "monthly"
  >("weekly");
  const [overdueTaskReminderFrequency, setOverdueTaskReminderFrequency] =
    useState<ReminderFrequency>("gentle");
  const [savedFrequencies, setSavedFrequencies] = useState({
    inbox: "gentle" as "none" | "gentle" | "prompt",
    memo: "weekly" as "none" | "weekly" | "monthly",
    overdue: "gentle" as ReminderFrequency,
  });
  const [syncStatus, setSyncStatus] = useState<"success" | "error">();
  const [syncArea, setSyncArea] = useState<"timing" | "frequency">();
  const [timingFeedback, setTimingFeedback] = useState<
    { type: "success" | "error"; message: string } | undefined
  >();
  const [frequenciesSaved, setFrequenciesSaved] = useState(false);
  const [frequencyError, setFrequencyError] = useState<string>();
  const defaultDeadlineTimePicker = useRef<HTMLInputElement>(null);
  const initialDelayInput = useDelayedSelectInput();
  const defaultDeadlineTimeInput = useDelayedSelectInput();
  const deadlineLeadInput = useDelayedSelectInput();
  const [hasRegisteredDevice, setHasRegisteredDevice] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState(false);
  const [registeredAt, setRegisteredAt] = useState<string>();
  const [timeZone, setTimeZone] = useState<string>();
  useEffect(() => {
    let active = true;
    void repository.load().then(async (snapshot) => {
      if (!active) return;
      const registered = Boolean(
        snapshot.device.pushDeviceId && snapshot.device.pushDeviceSecret,
      );
      setHasRegisteredDevice(registered);
      setRegisteredAt(snapshot.device.registeredAt);
      setTimeZone(snapshot.settings.timeZone);
      setInitialDelay(
        String(snapshot.settings.initialReminderDelayMinutes ?? 60),
      );
      setDeadlineLead(
        String(snapshot.settings.deadlineReminderLeadMinutes ?? 60),
      );
      setDefaultDeadlineTime(
        (snapshot.settings.defaultDeadlineTime ?? "23:59").replace(":", ""),
      );
      setInboxReminderFrequency(snapshot.settings.inboxReminderFrequency);
      setMemoReviewFrequency(snapshot.settings.memoReviewFrequency);
      setOverdueTaskReminderFrequency(
        snapshot.settings.overdueTaskReminderFrequency,
      );
      setSavedFrequencies({
        inbox: snapshot.settings.inboxReminderFrequency,
        memo: snapshot.settings.memoReviewFrequency,
        overdue: snapshot.settings.overdueTaskReminderFrequency,
      });

      if (
        registered &&
        snapshot.device.pushSubscriptionStatus === "granted" &&
        snapshot.settings.notificationEnabled
      ) {
        try {
          const browserState = await (
            inspectBrowserState ??
            (() => inspectBrowserPushState(createBrowserPushStateProbe()))
          )();
          if (!active) return;
          setState(
            browserState === "ready"
              ? "granted"
              : browserState === "denied"
                ? "denied"
                : browserState === "unavailable"
                  ? "unavailable"
                  : "stale",
          );
        } catch {
          if (active) setState("stale");
        }
        return;
      }

      if (snapshot.device.pushSubscriptionStatus === "granted") {
        setState("stale");
      } else {
        setState(
          snapshot.device.pushSubscriptionStatus === "not_requested"
            ? undefined
            : snapshot.device.pushSubscriptionStatus,
        );
      }
    });
    return () => {
      active = false;
    };
  }, [inspectBrowserState, repository]);

  useEffect(() => {
    if (!frequenciesSaved) return;
    const timer = window.setTimeout(() => setFrequenciesSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [frequenciesSaved]);

  async function configure(): Promise<void> {
    setBusy(true);
    setActiveOperation("setup");
    setSetupCompleted(false);
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
      if (result.state === "granted") {
        setSetupCompleted(true);
        const refreshed = await repository.load();
        setHasRegisteredDevice(
          Boolean(
            refreshed.device.pushDeviceId && refreshed.device.pushDeviceSecret,
          ),
        );
        setRegisteredAt(refreshed.device.registeredAt);
        setTimeZone(refreshed.settings.timeZone);
        void flushNotifications?.();
      }
    } catch {
      setState("error");
      setErrorReason(undefined);
    } finally {
      setBusy(false);
      setActiveOperation(undefined);
    }
  }

  async function saveTiming(): Promise<void> {
    setTimingFeedback(undefined);
    const initialReminderDelayMinutes = Number(initialDelay);
    const deadlineReminderLeadMinutes = Number(deadlineLead);
    const parsedDefaultDeadlineTime = timeFromDigits(defaultDeadlineTime);
    if (
      !isReminderMinutes(initialReminderDelayMinutes) ||
      !isReminderMinutes(deadlineReminderLeadMinutes) ||
      !parsedDefaultDeadlineTime
    ) {
      setTimingFeedback({
        type: "error",
        message: "入力内容を確認してください。",
      });
      return;
    }
    setBusy(true);
    setActiveOperation("timing");
    try {
      const snapshot = await repository.load();
      const updated = {
        ...snapshot,
        settings: {
          ...snapshot.settings,
          initialReminderDelayMinutes,
          deadlineReminderLeadMinutes,
          defaultDeadlineTime: parsedDefaultDeadlineTime,
        },
      };
      const savedAt = new Date().toISOString();
      const delivery = rebuildActiveTaskNotifications({
        snapshot: updated,
        now: savedAt,
      });
      await repository.save({ ...updated, ...delivery, savedAt });
      setTimingFeedback({
        type: "success",
        message: "通知タイミングを保存しました。",
      });
      await synchronizeNotifications("timing");
    } catch {
      setTimingFeedback({
        type: "error",
        message:
          "通知タイミングを保存できませんでした。もう一度お試しください。",
      });
    } finally {
      setBusy(false);
      setActiveOperation(undefined);
    }
  }

  async function saveReviewFrequencies(): Promise<void> {
    setBusy(true);
    setActiveOperation("frequency");
    setFrequencyError(undefined);
    try {
      const snapshot = await repository.load();
      const updated = {
        ...snapshot,
        settings: {
          ...snapshot.settings,
          inboxReminderFrequency,
          memoReviewFrequency,
          overdueTaskReminderFrequency,
        },
      };
      const savedAt = new Date().toISOString();
      const taskDelivery = rebuildActiveTaskNotifications({
        snapshot: updated,
        now: savedAt,
      });
      const globalDelivery = rebuildGlobalNotificationSchedules({
        snapshot: { ...updated, ...taskDelivery },
        now: savedAt,
      });
      await repository.save({
        ...updated,
        ...taskDelivery,
        ...globalDelivery,
        savedAt,
      });
      setSavedFrequencies({
        inbox: inboxReminderFrequency,
        memo: memoReviewFrequency,
        overdue: overdueTaskReminderFrequency,
      });
      setFrequenciesSaved(true);
      await synchronizeNotifications("frequency");
    } catch {
      setFrequencyError(
        "確認頻度を保存できませんでした。もう一度お試しください。",
      );
    } finally {
      setBusy(false);
      setActiveOperation(undefined);
    }
  }

  async function synchronizeNotifications(
    area: "timing" | "frequency" = syncArea ?? "frequency",
  ): Promise<void> {
    setSyncArea(area);
    setSyncStatus(undefined);
    try {
      await flushNotifications?.();
      setSyncStatus("success");
    } catch {
      setSyncStatus("error");
    }
  }

  async function retryNotificationSync(): Promise<void> {
    setBusy(true);
    setActiveOperation("sync");
    await synchronizeNotifications();
    setBusy(false);
    setActiveOperation(undefined);
  }

  function clearTimingResult(): void {
    setTimingFeedback(undefined);
    if (syncArea === "timing") {
      setSyncArea(undefined);
      setSyncStatus(undefined);
    }
  }

  function clearFrequencyResult(): void {
    setFrequenciesSaved(false);
    setFrequencyError(undefined);
    if (syncArea === "frequency") {
      setSyncArea(undefined);
      setSyncStatus(undefined);
    }
  }

  const reviewFrequenciesDirty =
    inboxReminderFrequency !== savedFrequencies.inbox ||
    memoReviewFrequency !== savedFrequencies.memo ||
    overdueTaskReminderFrequency !== savedFrequencies.overdue;
  const isConfigured = state === "granted" && hasRegisteredDevice;

  return (
    <section
      className="notification-settings"
      aria-labelledby="notification-settings-title"
    >
      <h1 id="notification-settings-title">通知</h1>
      <p className="notification-settings__intro">
        アプリを開いて「今日の確認」に戻るきっかけを通知します。タスク本文は通知サーバーへ送信しません。
      </p>
      {timeZone ? (
        <p
          aria-label="利用中のタイムゾーン"
          className="notification-settings__time-zone"
        >
          基準: {formatTimeZone(timeZone)}
        </p>
      ) : null}
      <section
        className="notification-settings__timing"
        aria-labelledby="notification-timing-title"
      >
        <h2 id="notification-timing-title">通知タイミング</h2>
        <p className="notification-settings__timing-note">
          通知は忘れ防止の補助機能です。端末の状態や通信環境により通知時刻が前後することがあり、指定時刻の通知は保証されません。
        </p>
        <details className="notification-settings__mechanism">
          <summary>通知の仕組みを見る</summary>
          <div>
            <p>
              通知対象は最大5分ごとに確認します。この端末で保存した記録とタスクだけが対象で、端末間では同期しません。
            </p>
          </div>
        </details>
        <div className="notification-settings__timing-row">
          <label htmlFor="initial-reminder-delay">
            記録の初回通知まで（分）
          </label>
          <div className="notification-settings__number-field">
            <input
              autoComplete="off"
              id="initial-reminder-delay"
              inputMode="numeric"
              maxLength={5}
              onBlur={initialDelayInput.onBlur}
              onChange={(event) => {
                clearTimingResult();
                setInitialDelay(digits(event.currentTarget.value, 5));
              }}
              onFocus={initialDelayInput.onFocus}
              pattern="[0-9]*"
              type="text"
              value={initialDelay}
            />
            <span aria-hidden="true">分後</span>
          </div>
        </div>
        <div className="notification-settings__timing-row">
          <label htmlFor="default-deadline-time">期限の既定時刻</label>
          <div className="notification-settings__time-input">
            <input
              autoComplete="off"
              id="default-deadline-time"
              inputMode="numeric"
              maxLength={5}
              onBlur={defaultDeadlineTimeInput.onBlur}
              onChange={(event) => {
                clearTimingResult();
                setDefaultDeadlineTime(digits(event.currentTarget.value, 4));
              }}
              onFocus={defaultDeadlineTimeInput.onFocus}
              pattern="[0-9:]*"
              placeholder="例: 23:59"
              value={formatTimeDigits(defaultDeadlineTime)}
            />
            <button
              aria-label="時計で日付だけの期限に使う時刻を選ぶ"
              className="notification-settings__picker-button"
              onClick={() => openPicker(defaultDeadlineTimePicker.current)}
              type="button"
            >
              <ClockIcon />
            </button>
            <input
              aria-hidden="true"
              className="notification-settings__native-time-picker"
              onChange={(event) => {
                clearTimingResult();
                setDefaultDeadlineTime(event.target.value.replace(":", ""));
              }}
              ref={defaultDeadlineTimePicker}
              tabIndex={-1}
              type="time"
              value={timeFromDigits(defaultDeadlineTime) ?? ""}
            />
          </div>
          <p>日付だけの期限に使います。</p>
        </div>
        <div className="notification-settings__timing-row">
          <label htmlFor="deadline-reminder-lead">期限前通知（分）</label>
          <div className="notification-settings__number-field">
            <input
              autoComplete="off"
              id="deadline-reminder-lead"
              inputMode="numeric"
              maxLength={5}
              onBlur={deadlineLeadInput.onBlur}
              onChange={(event) => {
                clearTimingResult();
                setDeadlineLead(digits(event.currentTarget.value, 5));
              }}
              onFocus={deadlineLeadInput.onFocus}
              pattern="[0-9]*"
              type="text"
              value={deadlineLead}
            />
            <span aria-hidden="true">分前</span>
          </div>
        </div>
        <button disabled={busy} onClick={() => void saveTiming()} type="button">
          {activeOperation === "timing" ? "保存中…" : "通知タイミングを保存"}
        </button>
        {timingFeedback ? (
          <p
            aria-label="通知タイミングの保存結果"
            role={timingFeedback.type === "success" ? "status" : "alert"}
          >
            {timingFeedback.message}
          </p>
        ) : null}
        {syncArea === "timing" && syncStatus === "success" ? (
          <p role="status">通知への反映も完了しました。</p>
        ) : null}
        {syncArea === "timing" && syncStatus === "error" ? (
          <p role="alert">通知への反映は送信待ちです。</p>
        ) : null}
      </section>
      <section
        className={`notification-settings__review-frequency${reviewFrequenciesDirty ? " is-dirty" : ""}`}
        aria-labelledby="notification-review-frequency-title"
      >
        <h2 id="notification-review-frequency-title">確認頻度</h2>
        <label htmlFor="inbox-reminder-frequency">
          未整理の受信箱の確認頻度
        </label>
        <select
          id="inbox-reminder-frequency"
          value={inboxReminderFrequency}
          onChange={(event) => {
            clearFrequencyResult();
            setInboxReminderFrequency(
              event.target.value as "none" | "gentle" | "prompt",
            );
          }}
        >
          <option value="none">再通知しない</option>
          <option value="gentle">ゆっくり確認する</option>
          <option value="prompt">こまめに確認する</option>
        </select>
        <label htmlFor="overdue-task-reminder-frequency">
          期限超過タスクの再通知
        </label>
        <select
          id="overdue-task-reminder-frequency"
          value={overdueTaskReminderFrequency}
          onChange={(event) => {
            clearFrequencyResult();
            setOverdueTaskReminderFrequency(
              event.target.value as ReminderFrequency,
            );
          }}
        >
          <option value="none">再通知しない</option>
          <option value="gentle">ゆっくり確認する</option>
          <option value="prompt">こまめに確認する</option>
        </select>
        <p className="notification-settings__frequency-note">
          ゆっくりは期限の1・3・7日後から週1回、こまめは4時間後から毎日期限時刻に通知します。
        </p>
        <label htmlFor="memo-review-frequency">メモの見直し頻度</label>
        <select
          id="memo-review-frequency"
          value={memoReviewFrequency}
          onChange={(event) => {
            clearFrequencyResult();
            setMemoReviewFrequency(
              event.target.value as "none" | "weekly" | "monthly",
            );
          }}
        >
          <option value="none">見直し通知なし</option>
          <option value="weekly">週1回</option>
          <option value="monthly">月1回</option>
        </select>
        {reviewFrequenciesDirty ? (
          <p className="notification-settings__unsaved" role="status">
            変更を保存してください
          </p>
        ) : null}
        {frequenciesSaved ? <p role="status">保存しました。</p> : null}
        {frequencyError ? <p role="alert">{frequencyError}</p> : null}
        {syncArea === "frequency" && syncStatus === "success" ? (
          <p role="status">通知の同期が完了しました。</p>
        ) : null}
        {syncArea === "frequency" && syncStatus === "error" ? (
          <>
            <p role="alert">通知の同期に失敗しました。再試行できます。</p>
            <button
              disabled={busy}
              onClick={() => void retryNotificationSync()}
              type="button"
            >
              通知の同期を再試行
            </button>
          </>
        ) : null}
        <button
          disabled={busy || !reviewFrequenciesDirty}
          onClick={() => void saveReviewFrequencies()}
          type="button"
        >
          {activeOperation === "frequency" ? "保存中…" : "確認頻度を保存"}
        </button>
      </section>
      <div className="notification-settings__device-setup">
        <button
          className={isConfigured ? "is-configured" : undefined}
          disabled={busy || state === "denied"}
          onClick={() => void configure()}
          type="button"
        >
          {activeOperation === "setup"
            ? "設定中…"
            : hasRegisteredDevice
              ? "通知を再設定する"
              : "通知を設定する"}
        </button>
        {!isConfigured ? (
          <p className="notification-settings__setup-note">
            通知を受けるには、このボタンを最初に一度押して端末登録を完了する必要があります。
          </p>
        ) : null}
        {setupCompleted ? <p role="status">通知を設定しました。</p> : null}
        {state === "granted" && hasRegisteredDevice ? (
          <>
            <p className="notification-settings__device-status">
              この端末は通知設定済みです。
            </p>
            {registeredAt && timeZone ? (
              <p
                aria-label="通知の端末登録日時"
                className="notification-settings__device-status"
              >
                通知の端末登録日時:{" "}
                {formatLocalDateTime(registeredAt, timeZone)}
              </p>
            ) : null}
          </>
        ) : null}
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
      </div>
      <details className="notification-settings__device-check">
        <summary>スマホで通知が来ないとき</summary>
        <ol>
          <li>
            この画面で「通知を設定する」を押し、端末登録の表示と日時を確認します。
          </li>
          <li>
            Androidの通知履歴に出る「タップすると、このアプリのURLがコピーされます」はChromeのPWA管理通知です。あとキューの予定通知ではありません。予定通知は「あとキュー」「確認したい項目があります」と表示されます。
          </li>
          <li>
            端末の設定で、Chromeまたはホーム画面に追加したあとキューの通知を許可します。
          </li>
          <li>
            省電力モードや集中モードを解除してから、期限付きタスクで確認します。
          </li>
        </ol>
      </details>
    </section>
  );
}

function errorMessage(
  reason: NotificationSetupErrorReason | undefined,
): string {
  switch (reason) {
    case "permission":
      return "通知許可の確認に失敗しました。ブラウザのサイト設定を確認してから、もう一度お試しください。";
    case "public_key":
      return "通知サービスの公開鍵を取得できませんでした。通信状態を確認してから、もう一度お試しください。";
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

function isReminderMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 10_080;
}

function openPicker(input: HTMLInputElement | null): void {
  if (!input) return;
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
      return;
    } catch {
      // Some browsers require a direct user gesture before opening a picker.
    }
  }
  input.click();
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
