import { useEffect, useRef, useState } from "react";
import {
  markAsNote,
  markAsUnneeded,
  suggestClassification,
  updateCaptureBody,
  type AppRepository,
  type Capture,
} from "../../../../../packages/domain/src";

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
  const [bodyDrafts, setBodyDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [isMutating, setIsMutating] = useState(false);
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingMutations = useRef(0);

  async function reload(): Promise<void> {
    const snapshot = await repository.load();
    setCaptures(
      snapshot.captures
        .filter((capture) => capture.classification === "unclassified")
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    );
  }

  useEffect(() => {
    void reload().catch(() => setError("受信箱を読み込めませんでした。もう一度お試しください。"));
  }, [repository]);

  function enqueueMutation(operation: () => Promise<void>): void {
    pendingMutations.current += 1;
    setIsMutating(true);
    const mutation = mutationQueue.current.then(operation);
    mutationQueue.current = mutation.catch(() => undefined);
    void mutation
      .catch(() => setError("整理を保存できませんでした。もう一度お試しください。"))
      .finally(() => {
        pendingMutations.current -= 1;
        if (pendingMutations.current === 0) setIsMutating(false);
      });
  }

  function classify(captureId: string, type: "note" | "unneeded"): void {
    setError(undefined);
    enqueueMutation(async () => {
      const snapshot = await repository.load();
      const next =
        type === "note"
          ? markAsNote({ snapshot, captureId, now: now() })
          : markAsUnneeded({ snapshot, captureId, now: now() });
      await repository.save(next);
      await reload();
    });
  }

  function saveBody(captureId: string, body: string): void {
    setError(undefined);
    enqueueMutation(async () => {
      const next = updateCaptureBody(await repository.load(), captureId, body, now());
      await repository.save(next);
      setBodyDrafts((drafts) => {
        const { [captureId]: _discarded, ...remaining } = drafts;
        return remaining;
      });
      await reload();
    });
  }

  return (
    <section aria-labelledby="inbox-title">
      <h1 id="inbox-title">受信箱</h1>
      {captures.length === 0 ? <p>未整理の記録はありません。</p> : null}
      <ul>
        {captures.map((capture) => {
          const suggestion = suggestClassification(capture.body);
          return (
            <li key={capture.id}>
              <p>{capture.body}</p>
              <label htmlFor={`capture-body-${capture.id}`}>本文を編集</label>
              <textarea
                id={`capture-body-${capture.id}`}
                onChange={(event) =>
                  setBodyDrafts((drafts) => ({ ...drafts, [capture.id]: event.target.value }))
                }
                readOnly={isMutating}
                value={bodyDrafts[capture.id] ?? capture.body}
              />
              <button
                disabled={isMutating}
                onClick={() => void saveBody(capture.id, bodyDrafts[capture.id] ?? capture.body)}
                type="button"
                aria-label={`${capture.body}の本文を保存`}
              >
                本文を保存
              </button>
              {suggestion === "task" ? <p>タスク候補です</p> : null}
              <div aria-label={`${capture.body} の整理操作`}>
                <button disabled={isMutating} onClick={() => onTaskCandidate?.(capture.id)} type="button">
                  タスクかも
                </button>
                <button disabled={isMutating} onClick={() => classify(capture.id, "note")} type="button">
                  メモ
                </button>
                <button disabled={isMutating} onClick={() => classify(capture.id, "unneeded")} type="button">
                  不要
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
