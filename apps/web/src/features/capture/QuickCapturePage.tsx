import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  completeOnboarding,
  createCapture,
  type AppRepository,
  type AppSnapshot,
} from "../../../../../packages/domain/src";
import { APP_VERSION } from "../../app-version";
import type { NotificationSetupResult } from "../../infrastructure/notifications/push-subscription";
import "./QuickCapturePage.css";

const SUCCESS_MESSAGE = "保存しました。いまの作業に戻って大丈夫です";
const FAILURE_MESSAGE =
  "端末に保存できませんでした。空き容量を確認して再試行してください";
const LENGTH_MESSAGE = "280文字以内で入力してください";

export interface QuickCapturePageProps {
  repository: AppRepository;
  now?: () => string;
  createId?: () => string;
  onNotificationChanged?: () => Promise<unknown>;
  setupNotifications?: () => Promise<NotificationSetupResult>;
  shouldAutofocusCapture?: () => boolean;
}

export function QuickCapturePage({
  repository,
  now = () => new Date().toISOString(),
  createId = defaultCreateId,
  onNotificationChanged,
  setupNotifications,
  shouldAutofocusCapture,
}: QuickCapturePageProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasRequestedInitialFocus = useRef(false);
  const lastPersistedDraft = useRef<string | undefined>(undefined);
  const draftGeneration = useRef(0);
  const draftWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingDraftClear = useRef<string | undefined>(undefined);
  const preferenceSaveInProgress = useRef(false);
  const [body, setBody] = useState("");
  const [unclassifiedCount, setUnclassifiedCount] = useState(0);
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadedSnapshot, setLoadedSnapshot] = useState<AppSnapshot>();
  const [enterSavesCapture, setEnterSavesCapture] = useState(true);
  const [isSavingEnterPreference, setIsSavingEnterPreference] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showNotificationSetup, setShowNotificationSetup] = useState(false);
  const [isConfiguringNotifications, setIsConfiguringNotifications] =
    useState(false);

  function focusCaptureInputOnce(): void {
    if (hasRequestedInitialFocus.current) return;
    hasRequestedInitialFocus.current = true;
    focusCaptureInput(inputRef.current);
  }

  useEffect(() => {
    if (shouldAutofocusCapture?.()) focusCaptureInputOnce();
  }, [shouldAutofocusCapture]);

  useEffect(() => {
    let isCurrent = true;

    void Promise.all([repository.load(), repository.loadDraft()])
      .then(async ([snapshot, draft]) => {
        if (!isCurrent) return;
        setLoadedSnapshot(snapshot);
        setEnterSavesCapture(snapshot.settings.enterSavesCapture);
        if (snapshot.device.pushSubscriptionStatus !== "not_requested") {
          focusCaptureInputOnce();
        }
        setUnclassifiedCount(
          snapshot.captures.filter(
            (capture) => capture.classification === "unclassified",
          ).length,
        );
        setShowOnboarding(!snapshot.settings.onboardingCompletedAt);
        setShowNotificationSetup(
          Boolean(
            setupNotifications &&
            snapshot.device.pushSubscriptionStatus === "not_requested",
          ),
        );

        if (!draft) {
          lastPersistedDraft.current = "";
          setBody("");
          return;
        }

        lastPersistedDraft.current = draft;
        setBody((current) => current || draft);

        if (!isResolvedDraft(snapshot, draft)) return;

        pendingDraftClear.current = draft;
        try {
          await repository.clearDraft();
          if (!isCurrent) return;
          pendingDraftClear.current = undefined;
          lastPersistedDraft.current = "";
          setBody("");
        } catch {
          if (isCurrent) setError(FAILURE_MESSAGE);
        }
      })
      .catch(() => {
        if (isCurrent) setError(FAILURE_MESSAGE);
      })
      .finally(() => {
        if (isCurrent) setIsDraftLoaded(true);
      });

    return () => {
      isCurrent = false;
    };
  }, [repository]);

  useEffect(() => {
    if (!isDraftLoaded || lastPersistedDraft.current === body) return;

    let isCurrent = true;
    const generation = draftGeneration.current;
    const timer = window.setTimeout(() => {
      const write = draftWriteQueue.current.then(async () => {
        if (generation !== draftGeneration.current) return;
        await repository.saveDraft(body);
        if (generation === draftGeneration.current) {
          lastPersistedDraft.current = body;
        }
      });
      draftWriteQueue.current = write.catch(() => {
        if (isCurrent) setError(FAILURE_MESSAGE);
      });
    }, 300);

    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
    };
  }, [body, isDraftLoaded, repository]);

  async function saveCapture(): Promise<void> {
    if (
      body.trim().length === 0 ||
      body.trim().length > 280 ||
      isSaving ||
      preferenceSaveInProgress.current
    )
      return;

    setIsSaving(true);
    setMessage(undefined);
    setError(undefined);

    try {
      if (pendingDraftClear.current === body) {
        await repository.clearDraft();
        pendingDraftClear.current = undefined;
        lastPersistedDraft.current = "";
        setBody("");
        setMessage(SUCCESS_MESSAGE);
        return;
      }

      pendingDraftClear.current = undefined;

      draftGeneration.current += 1;
      await draftWriteQueue.current;
      const next = createCapture(
        await repository.load(),
        body,
        now(),
        createId(),
      );
      await repository.save(next);
      setLoadedSnapshot(next);
      setUnclassifiedCount(
        next.captures.filter(
          (capture) => capture.classification === "unclassified",
        ).length,
      );
      void onNotificationChanged?.();
      pendingDraftClear.current = body;
      await repository.clearDraft();
      pendingDraftClear.current = undefined;
      lastPersistedDraft.current = "";
      setBody("");
      setMessage(SUCCESS_MESSAGE);
    } catch {
      setError(FAILURE_MESSAGE);
    } finally {
      setIsSaving(false);
    }
  }

  const isTooLong = body.trim().length > 280;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void saveCapture();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.altKey &&
      (enterSavesCapture || event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      void saveCapture();
    }
  }

  async function saveEnterSavesCapture(nextValue: boolean): Promise<void> {
    if (preferenceSaveInProgress.current || !loadedSnapshot) return;

    const previousValue = enterSavesCapture;
    preferenceSaveInProgress.current = true;
    setEnterSavesCapture(nextValue);
    setIsSavingEnterPreference(true);
    try {
      const currentSnapshot = await repository.load();
      const nextSnapshot: AppSnapshot = {
        ...currentSnapshot,
        settings: {
          ...currentSnapshot.settings,
          enterSavesCapture: nextValue,
        },
      };
      await repository.save(nextSnapshot);
      setLoadedSnapshot(nextSnapshot);
    } catch {
      setEnterSavesCapture(previousValue);
      setError(FAILURE_MESSAGE);
    } finally {
      preferenceSaveInProgress.current = false;
      setIsSavingEnterPreference(false);
    }
  }

  async function dismissOnboarding(): Promise<void> {
    try {
      const nextSnapshot = completeOnboarding(await repository.load(), now());
      await repository.save(nextSnapshot);
      setLoadedSnapshot(nextSnapshot);
      setShowOnboarding(false);
    } catch {
      setError(FAILURE_MESSAGE);
    }
  }

  async function configureNotifications(): Promise<void> {
    if (!setupNotifications || isConfiguringNotifications) return;

    setIsConfiguringNotifications(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await setupNotifications();
      const nextSnapshot = await repository.load();
      setLoadedSnapshot(nextSnapshot);
      setEnterSavesCapture(nextSnapshot.settings.enterSavesCapture);
      setShowNotificationSetup(false);
      if (result.state === "granted") {
        void onNotificationChanged?.();
        setMessage("通知を設定しました。");
      } else if (result.state === "denied") {
        setError("ブラウザの設定から通知を許可してください。");
      } else if (result.state === "unavailable") {
        setError("このブラウザでは通知を利用できません。");
      } else {
        setError(
          "通知を設定できませんでした。設定からもう一度お試しください。",
        );
      }
    } catch {
      setShowNotificationSetup(false);
      setError("通知を設定できませんでした。設定からもう一度お試しください。");
    } finally {
      setIsConfiguringNotifications(false);
    }
  }

  return (
    <section className="quick-capture" aria-labelledby="quick-capture-title">
      <h1 id="quick-capture-title">あとで思い出したいことは？</h1>
      {showOnboarding ? (
        <section
          className="quick-capture__onboarding"
          aria-labelledby="onboarding-title"
        >
          <h2 id="onboarding-title">はじめに</h2>
          <ol>
            <li>通知のタイミングは設定で変えられます。</li>
            <li>端末の通知は、設定画面の「通知を設定する」から許可します。</li>
            <li>記録は受信箱でタスクにできます。</li>
          </ol>
          <button onClick={() => void dismissOnboarding()} type="button">
            はじめる
          </button>
        </section>
      ) : null}
      {showNotificationSetup ? (
        <section
          className="quick-capture__notification-setup"
          aria-labelledby="capture-notification-setup-title"
        >
          <h2 id="capture-notification-setup-title">通知を設定する</h2>
          <p>記録したことを後で思い出すために、この端末の通知を設定します。</p>
          <button
            disabled={isConfiguringNotifications}
            onClick={() => void configureNotifications()}
            type="button"
          >
            通知を設定する
          </button>
        </section>
      ) : null}
      <p className="quick-capture__summary">受信箱の未整理: {unclassifiedCount}件</p>
      <form className="quick-capture__form" onSubmit={handleSubmit}>
        <label htmlFor="quick-capture-body">思いついたこと</label>
        <textarea
          autoComplete="off"
          id="quick-capture-body"
          onChange={(event) => {
            draftGeneration.current += 1;
            setBody(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          ref={inputRef}
          rows={3}
          maxLength={280}
          readOnly={isSaving || isSavingEnterPreference}
          value={body}
        />
        <div className="quick-capture__actions">
          <button
            disabled={
              body.trim().length === 0 ||
              isTooLong ||
              isSaving ||
              isSavingEnterPreference
            }
            type="submit"
          >
            保存して戻る
          </button>
          <div className="quick-capture__option-stack">
            <label className="quick-capture__enter-save">
              <input
                checked={enterSavesCapture}
                disabled={isSaving || isSavingEnterPreference || !loadedSnapshot}
                onChange={(event) => {
                  void saveEnterSavesCapture(event.target.checked);
                }}
                type="checkbox"
              />
              改行で登録
            </label>
            <p className="quick-capture__version">
              バージョン {APP_VERSION}
            </p>
          </div>
        </div>
      </form>
      {message ? <p role="status">{message}</p> : null}
      {isTooLong ? <p role="alert">{LENGTH_MESSAGE}</p> : null}
      {!isTooLong && error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function defaultCreateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `capture-${Date.now()}`;
}

type NavigatorWithVirtualKeyboard = Navigator & {
  virtualKeyboard?: {
    show: () => void;
  };
};

function focusCaptureInput(input: HTMLTextAreaElement | null) {
  if (!input) return;

  input.focus();
  if (document.activeElement !== input) return;

  try {
    (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard?.show();
  } catch {
    // The browser and OS retain final control over the software keyboard.
  }
}

function isResolvedDraft(
  snapshot: Awaited<ReturnType<AppRepository["load"]>>,
  draft: string,
): boolean {
  const body = draft.trim();
  return snapshot.captures.some(
    (capture) =>
      capture.body === body &&
      capture.classification === "unclassified" &&
      capture.createdAt === snapshot.savedAt &&
      capture.updatedAt === snapshot.savedAt,
  );
}
