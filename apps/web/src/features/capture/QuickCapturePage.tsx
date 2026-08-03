import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  createCapture,
  type AppRepository,
} from "../../../../../packages/domain/src";
import "./QuickCapturePage.css";

const SUCCESS_MESSAGE = "保存しました。いまの作業に戻って大丈夫です";
const FAILURE_MESSAGE = "端末に保存できませんでした。空き容量を確認して再試行してください";
const LENGTH_MESSAGE = "280文字以内で入力してください";

export interface QuickCapturePageProps {
  repository: AppRepository;
  now?: () => string;
  createId?: () => string;
}

export function QuickCapturePage({
  repository,
  now = () => new Date().toISOString(),
  createId = defaultCreateId,
}: QuickCapturePageProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastPersistedDraft = useRef<string | undefined>(undefined);
  const draftGeneration = useRef(0);
  const pendingDraftClear = useRef(false);
  const [body, setBody] = useState("");
  const [unclassifiedCount, setUnclassifiedCount] = useState(0);
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let isCurrent = true;

    void repository
      .loadDraft()
      .then((draft) => {
        if (!isCurrent) return;
        lastPersistedDraft.current = draft;
        setBody((current) => current || draft);
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
    let isCurrent = true;

    void repository
      .load()
      .then((snapshot) => {
        if (!isCurrent) return;
        setUnclassifiedCount(
          snapshot.captures.filter(
            (capture) => capture.classification === "unclassified",
          ).length,
        );
      })
      .catch(() => {
        if (isCurrent) setError(FAILURE_MESSAGE);
      });

    return () => {
      isCurrent = false;
    };
  }, [repository]);

  useEffect(() => {
    if (!isDraftLoaded || lastPersistedDraft.current === body) return;

    const generation = draftGeneration.current;
    const timer = window.setTimeout(() => {
      void repository
        .saveDraft(body)
        .then(async () => {
          if (generation !== draftGeneration.current) {
            await repository.clearDraft();
            return;
          }
          lastPersistedDraft.current = body;
        })
        .catch(() => setError(FAILURE_MESSAGE));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [body, isDraftLoaded, repository]);

  async function saveCapture(): Promise<void> {
    if (body.trim().length === 0 || body.trim().length > 280 || isSaving) return;

    setIsSaving(true);
    setMessage(undefined);
    setError(undefined);

    try {
      if (pendingDraftClear.current) {
        await repository.clearDraft();
        pendingDraftClear.current = false;
        lastPersistedDraft.current = "";
        setBody("");
        setMessage(SUCCESS_MESSAGE);
        return;
      }

      draftGeneration.current += 1;
      const next = createCapture(await repository.load(), body, now(), createId());
      await repository.save(next);
      pendingDraftClear.current = true;
      await repository.clearDraft();
      pendingDraftClear.current = false;
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
    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      void saveCapture();
    }
  }

  return (
    <section className="quick-capture" aria-labelledby="quick-capture-title">
      <h1 id="quick-capture-title">あとで思い出したいことは？</h1>
      <p>受信箱の未整理: {unclassifiedCount}件</p>
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
          readOnly={isSaving}
          value={body}
        />
        <button
          disabled={body.trim().length === 0 || isTooLong || isSaving}
          type="submit"
        >
          保存して戻る
        </button>
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
