import { useEffect, useState } from "react";
import {
  markAsNote,
  markAsUnneeded,
  suggestClassification,
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
  const [error, setError] = useState<string>();

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

  async function classify(captureId: string, type: "note" | "unneeded"): Promise<void> {
    setError(undefined);
    try {
      const snapshot = await repository.load();
      const next =
        type === "note"
          ? markAsNote({ snapshot, captureId, now: now() })
          : markAsUnneeded({ snapshot, captureId, now: now() });
      await repository.save(next);
      await reload();
    } catch {
      setError("整理を保存できませんでした。もう一度お試しください。");
    }
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
              {suggestion === "task" ? <p>タスク候補です</p> : null}
              <div aria-label={`${capture.body} の整理操作`}>
                <button onClick={() => onTaskCandidate?.(capture.id)} type="button">
                  タスクかも
                </button>
                <button onClick={() => void classify(capture.id, "note")} type="button">
                  メモ
                </button>
                <button onClick={() => void classify(capture.id, "unneeded")} type="button">
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
