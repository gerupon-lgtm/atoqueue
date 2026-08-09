import { useEffect, useRef, useState } from "react";
import {
  markAsNote,
  markAsUnneeded,
  markNoteAsUnneeded,
  suggestClassification,
  updateCaptureBody,
  type AppRepository,
  type Capture,
} from "../../../../../packages/domain/src";
import "./InboxPage.css";

export interface InboxPageProps {
  repository: AppRepository;
  now?: () => string;
  onTaskCandidate?: (captureId: string) => void;
}

export function InboxPage({
  repository,
  now = () => new Date().toISOString(),
  onTaskCandidate,
}: InboxPageProps) {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [tab, setTab] = useState<"unclassified" | "note">("unclassified");
  const [timeZone, setTimeZone] = useState("Asia/Tokyo");
  const [bodyDrafts, setBodyDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [isMutating, setIsMutating] = useState(false);
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingMutations = useRef(0);

  async function reload(): Promise<void> {
    const snapshot = await repository.load();
    setTimeZone(snapshot.settings.timeZone);
    setCaptures(snapshot.captures);
  }

  useEffect(() => {
    void reload().catch(() =>
      setError("受信箱を読み込めませんでした。もう一度お試しください。"),
    );
  }, [repository]);

  function enqueueMutation(operation: () => Promise<void>): void {
    pendingMutations.current += 1;
    setIsMutating(true);
    const mutation = mutationQueue.current.then(operation);
    mutationQueue.current = mutation.catch(() => undefined);
    void mutation
      .catch(() =>
        setError("整理を保存できませんでした。もう一度お試しください。"),
      )
      .finally(() => {
        pendingMutations.current -= 1;
        if (pendingMutations.current === 0) setIsMutating(false);
      });
  }

  function classify(
    captureId: string,
    type: "note" | "unneeded",
    source: "unclassified" | "note" = "unclassified",
  ): void {
    setError(undefined);
    enqueueMutation(async () => {
      const snapshot = await repository.load();
      const next =
        type === "note"
          ? markAsNote({ snapshot, captureId, now: now() })
          : source === "note"
            ? markNoteAsUnneeded({ snapshot, captureId, now: now() })
            : markAsUnneeded({ snapshot, captureId, now: now() });
      await repository.save(next);
      await reload();
    });
  }

  function saveBody(captureId: string, body: string): void {
    setError(undefined);
    enqueueMutation(async () => {
      const next = updateCaptureBody(
        await repository.load(),
        captureId,
        body,
        now(),
      );
      await repository.save(next);
      setBodyDrafts((drafts) => {
        const remaining = { ...drafts };
        delete remaining[captureId];
        return remaining;
      });
      await reload();
    });
  }

  const visibleCaptures = captures
    .filter((capture) => capture.classification === tab)
    .sort((left, right) =>
      tab === "note"
        ? left.createdAt.localeCompare(right.createdAt)
        : right.createdAt.localeCompare(left.createdAt),
    );

  return (
    <section aria-labelledby="inbox-title">
      <h1 id="inbox-title">受信箱</h1>
      <div className="inbox-tabs" role="tablist" aria-label="受信箱の表示">
        <button
          aria-selected={tab === "unclassified"}
          className="inbox-tabs__tab"
          onClick={() => setTab("unclassified")}
          role="tab"
          type="button"
        >
          未整理
        </button>
        <button
          aria-selected={tab === "note"}
          className="inbox-tabs__tab"
          onClick={() => setTab("note")}
          role="tab"
          type="button"
        >
          メモ
        </button>
      </div>
      {visibleCaptures.length === 0 ? (
        <p>
          {tab === "note" ? "メモはありません。" : "未整理の記録はありません。"}
        </p>
      ) : null}
      {visibleCaptures.length > 0 ? (
        <ul>
          {visibleCaptures.map((capture) => {
            const suggestion = suggestClassification(capture.body);
            return (
              <li key={capture.id}>
                <p>{capture.body}</p>
                <time dateTime={capture.createdAt}>
                  登録: {formatCaptureCreatedAt(capture.createdAt, timeZone)}
                </time>
                <label htmlFor={`capture-body-${capture.id}`}>本文を編集</label>
                <textarea
                  id={`capture-body-${capture.id}`}
                  onChange={(event) =>
                    setBodyDrafts((drafts) => ({
                      ...drafts,
                      [capture.id]: event.target.value,
                    }))
                  }
                  readOnly={isMutating}
                  value={bodyDrafts[capture.id] ?? capture.body}
                />
                <button
                  disabled={isMutating}
                  onClick={() =>
                    void saveBody(
                      capture.id,
                      bodyDrafts[capture.id] ?? capture.body,
                    )
                  }
                  type="button"
                  aria-label={`${capture.body}の本文を保存`}
                >
                  本文を保存
                </button>
                {tab === "unclassified" && suggestion === "task" ? (
                  <p>タスク候補です</p>
                ) : null}
                <div
                  className="inbox-item__actions inbox-item__classification-actions"
                  aria-label={`${capture.body} の整理操作`}
                >
                  <button
                    disabled={isMutating}
                    onClick={() => onTaskCandidate?.(capture.id)}
                    type="button"
                  >
                    {tab === "note" ? "タスクにする" : "タスクかも"}
                  </button>
                  {tab === "unclassified" ? (
                    <button
                      disabled={isMutating}
                      onClick={() => classify(capture.id, "note")}
                      type="button"
                    >
                      メモ
                    </button>
                  ) : null}
                  <button
                    disabled={isMutating}
                    onClick={() => classify(capture.id, "unneeded", tab)}
                    type="button"
                  >
                    不要
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function formatCaptureCreatedAt(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}
