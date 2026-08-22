import { useEffect, useRef, useState } from "react";
import {
  deleteUnneededCapture,
  deleteUnneededCaptures,
  getUnneededCaptureSource,
  listCaptures,
  markAsNote,
  markAsUnneeded,
  markNoteAsUnneeded,
  restoreUnneededCapture,
  restoreUnneededCaptures,
  suggestClassification,
  updateCaptureBody,
  type AppRepository,
  type AppSnapshot,
  type Capture,
  type CaptureHistoryTab,
} from "../../../../../packages/domain/src";
import "./InboxPage.css";

export interface InboxPageProps {
  repository: AppRepository;
  now?: () => string;
  onTaskCandidate?: (captureId: string) => void;
  sync?: () => Promise<unknown>;
}

export function InboxPage({
  repository,
  now = () => new Date().toISOString(),
  onTaskCandidate,
  sync,
}: InboxPageProps) {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [tab, setTab] = useState<CaptureHistoryTab>("unclassified");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bodyDrafts, setBodyDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [isMutating, setIsMutating] = useState(false);
  const [savingBodyId, setSavingBodyId] = useState<string>();
  const [savedBodyId, setSavedBodyId] = useState<string>();
  const [bodyErrorId, setBodyErrorId] = useState<string>();
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingMutations = useRef(0);

  async function reload(): Promise<void> {
    setSnapshot(await repository.load());
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
    setFeedback(undefined);
    setSavedBodyId(undefined);
    setBodyErrorId(undefined);
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
      void synchronize(
        type === "unneeded" ? "不要にしました。" : "メモにしました。",
        type === "unneeded"
          ? "不要にしました。通知の取消は送信待ちです。"
          : "メモにしました。通知の更新は送信待ちです。",
      );
    });
  }

  function restore(captureId: string): void {
    setError(undefined);
    setFeedback(undefined);
    enqueueMutation(async () => {
      const next = restoreUnneededCapture({
        snapshot: await repository.load(),
        captureId,
        now: now(),
      });
      await repository.save(next);
      await reload();
      void synchronize(
        "未整理に戻しました。",
        "未整理に戻しました。通知の更新は送信待ちです。",
      );
    });
  }

  function remove(captureId: string): void {
    if (!window.confirm("この記録を完全に削除しますか？")) return;
    setError(undefined);
    setFeedback(undefined);
    enqueueMutation(async () => {
      const next = deleteUnneededCapture({
        snapshot: await repository.load(),
        captureId,
        now: now(),
      });
      await repository.save(next);
      await reload();
      void synchronize(
        "完全に削除しました。",
        "完全に削除しました。通知の取消は送信待ちです。",
      );
    });
  }

  function changeTab(nextTab: CaptureHistoryTab): void {
    setTab(nextTab);
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelected(captureId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(captureId)) next.delete(captureId);
      else next.add(captureId);
      return next;
    });
  }

  function selectAll(captureIds: readonly string[]): void {
    setSelectedIds(new Set(captureIds));
  }

  function cancelSelection(): void {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function restoreSelected(): void {
    const captureIds = [...selectedIds];
    if (
      captureIds.length === 0 ||
      !window.confirm(
        `選択した${captureIds.length}件を未整理に戻しますか？`,
      )
    ) {
      return;
    }
    setError(undefined);
    setFeedback(undefined);
    enqueueMutation(async () => {
      const next = restoreUnneededCaptures({
        snapshot: await repository.load(),
        captureIds,
        now: now(),
      });
      await repository.save(next);
      await reload();
      cancelSelection();
      void synchronize(
        `${captureIds.length}件を未整理に戻しました。`,
        `${captureIds.length}件を未整理に戻しました。通知の更新は送信待ちです。`,
      );
    });
  }

  function removeSelected(): void {
    const captureIds = [...selectedIds];
    if (
      captureIds.length === 0 ||
      !window.confirm(
        `選択した${captureIds.length}件を完全に削除しますか？この操作は元に戻せません。`,
      )
    ) {
      return;
    }
    setError(undefined);
    setFeedback(undefined);
    enqueueMutation(async () => {
      const next = deleteUnneededCaptures({
        snapshot: await repository.load(),
        captureIds,
        now: now(),
      });
      await repository.save(next);
      await reload();
      cancelSelection();
      void synchronize(
        `${captureIds.length}件を完全に削除しました。`,
        `${captureIds.length}件を完全に削除しました。通知の取消は送信待ちです。`,
      );
    });
  }

  async function synchronize(success: string, pending: string): Promise<void> {
    if (!sync) {
      setFeedback(success);
      return;
    }
    try {
      await sync();
      setFeedback(success);
    } catch {
      setFeedback(pending);
    }
  }

  function saveBody(captureId: string, body: string): void {
    setError(undefined);
    setSavedBodyId(undefined);
    setBodyErrorId(undefined);
    setSavingBodyId(captureId);
    enqueueMutation(async () => {
      try {
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
        setSavedBodyId(captureId);
      } catch {
        setBodyErrorId(captureId);
      } finally {
        setSavingBodyId(undefined);
      }
    });
  }

  const captures = snapshot?.captures ?? [];
  const timeZone = snapshot?.settings.timeZone ?? "Asia/Tokyo";
  const visibleCaptures = listCaptures(captures, tab);
  const tabCounts = {
    unclassified: captures.filter(
      ({ classification }) => classification === "unclassified",
    ).length,
    note: captures.filter(({ classification }) => classification === "note")
      .length,
    unneeded: captures.filter(
      ({ classification }) => classification === "unneeded",
    ).length,
  };

  return (
    <section aria-labelledby="inbox-title">
      <h1 id="inbox-title">受信箱</h1>
      <div className="inbox-tabs" role="tablist" aria-label="受信箱の表示">
        {(
          [
            ["unclassified", "未整理"],
            ["note", "メモ"],
            ["unneeded", "不要"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={tab === value}
            className="inbox-tabs__tab"
            key={value}
            onClick={() => changeTab(value)}
            role="tab"
            type="button"
          >
            <span>{label}</span>
            <span className="inbox-tabs__count">{tabCounts[value]}件</span>
          </button>
        ))}
      </div>
      {tab === "unneeded" && visibleCaptures.length > 0 ? (
        selectionMode ? (
          <section
            aria-label="不要記録の一括操作"
            className="inbox-selection"
          >
            <div className="inbox-selection__summary">
              <button
                disabled={isMutating}
                onClick={() =>
                  selectAll(visibleCaptures.map(({ id }) => id))
                }
                type="button"
              >
                すべて選択
              </button>
              <button
                disabled={isMutating || selectedIds.size === 0}
                onClick={() => setSelectedIds(new Set())}
                type="button"
              >
                選択解除
              </button>
              <span aria-live="polite">{selectedIds.size}件選択中</span>
            </div>
            <div className="inbox-selection__actions">
              <button
                aria-label="選択した記録を未整理に戻す"
                disabled={isMutating || selectedIds.size === 0}
                onClick={restoreSelected}
                type="button"
              >
                未整理に戻す
              </button>
              <button
                aria-label="選択した記録を完全削除"
                className="inbox-item__delete"
                disabled={isMutating || selectedIds.size === 0}
                onClick={removeSelected}
                type="button"
              >
                完全削除
              </button>
            </div>
            <button
              className="inbox-selection__cancel"
              disabled={isMutating}
              onClick={cancelSelection}
              type="button"
            >
              キャンセル
            </button>
          </section>
        ) : (
          <div className="inbox-selection__start">
            <button
              disabled={isMutating}
              onClick={() => setSelectionMode(true)}
              type="button"
            >
              選択
            </button>
          </div>
        )
      ) : null}
      {visibleCaptures.length === 0 ? <p>{emptyMessage(tab)}</p> : null}
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
                <span className="inbox-item__classification">
                  状態: {classificationLabel(capture.classification)}
                </span>
                {capture.classification === "unneeded" ? (
                  <>
                    <span className="inbox-item__origin">
                      {snapshot &&
                      getUnneededCaptureSource(snapshot, capture.id) === "note"
                        ? "メモから"
                        : "未整理から"}
                    </span>
                    {selectionMode ? (
                      <label className="inbox-item__selection">
                        <input
                          aria-label={`${capture.body}を選択`}
                          checked={selectedIds.has(capture.id)}
                          disabled={isMutating}
                          onChange={() => toggleSelected(capture.id)}
                          type="checkbox"
                        />
                        選択
                      </label>
                    ) : (
                      <div
                        aria-label={`${capture.body} の不要記録操作`}
                        className="inbox-item__actions inbox-item__unneeded-actions"
                      >
                        <button
                          disabled={isMutating}
                          onClick={() => restore(capture.id)}
                          type="button"
                        >
                          未整理に戻す
                        </button>
                        <button
                          className="inbox-item__delete"
                          disabled={isMutating}
                          onClick={() => remove(capture.id)}
                          type="button"
                        >
                          完全削除
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <label htmlFor={`capture-body-${capture.id}`}>
                      本文を編集
                    </label>
                    <textarea
                      id={`capture-body-${capture.id}`}
                      onChange={(event) => {
                        setSavedBodyId(undefined);
                        setBodyErrorId(undefined);
                        setBodyDrafts((drafts) => ({
                          ...drafts,
                          [capture.id]: event.target.value,
                        }));
                      }}
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
                      {savingBodyId === capture.id ? "保存中…" : "本文を保存"}
                    </button>
                    {savedBodyId === capture.id ? (
                      <p
                        aria-label={`${capture.body}の保存結果`}
                        className="inbox-item__feedback"
                        role="status"
                      >
                        本文を保存しました。
                      </p>
                    ) : null}
                    {bodyErrorId === capture.id ? (
                      <p
                        aria-label={`${bodyDrafts[capture.id] ?? capture.body}の保存結果`}
                        className="inbox-item__feedback"
                        role="alert"
                      >
                        本文を保存できませんでした。もう一度お試しください。
                      </p>
                    ) : null}
                    {capture.classification === "unclassified" &&
                    suggestion === "task" ? (
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
                        {capture.classification === "note"
                          ? "タスクにする"
                          : "タスクかも"}
                      </button>
                      {capture.classification === "unclassified" ? (
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
                        onClick={() =>
                          classify(
                            capture.id,
                            "unneeded",
                            capture.classification === "note"
                              ? "note"
                              : "unclassified",
                          )
                        }
                        type="button"
                      >
                        不要
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {feedback ? <p role="status">{feedback}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function emptyMessage(tab: CaptureHistoryTab): string {
  switch (tab) {
    case "note":
      return "メモはありません。";
    case "unneeded":
      return "不要にした記録はありません。";
    default:
      return "未整理の記録はありません。";
  }
}

function classificationLabel(
  classification: Capture["classification"],
): string {
  switch (classification) {
    case "task":
      return "タスク化済み";
    case "note":
      return "メモ";
    case "unneeded":
      return "不要";
    default:
      return "未整理";
  }
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
