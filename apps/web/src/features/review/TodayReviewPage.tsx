import { useEffect, useState } from "react";
import {
  answerReview,
  calculateNeglectLevel,
  choosePrompt,
  currentReviewTask,
  findNextUnansweredReviewIndex,
  goToNextTask,
  goToPreviousTask,
  isTaskOverdue,
  refreshReviewSession,
  resolveDueChoice,
  startReviewSession,
  type AppRepository,
  type AppSnapshot,
  type ReviewAnswer,
  type ReviewCalendar,
  type ReviewSession,
} from "../../../../../packages/domain/src";
import { createReviewCalendar } from "../../infrastructure/review-calendar/review-calendar";
import { ReviewActionSheet } from "./ReviewActionSheet";
import {
  createReviewPresentation,
  latestSessionAnswer,
} from "./review-presentation";
import { resolveReminderTaskId } from "../../infrastructure/notifications/reminder-navigation";
import { taskCategoryDisplayLabel } from "../tasks/task-category-options";
import { OverdueIndicator } from "../../presentation/OverdueIndicator";
import { useDisplayTime } from "../../presentation/use-task-snapshot";
import "./TodayReviewPage.css";

export interface TodayReviewPageProps {
  repository: AppRepository;
  now?: () => string;
  calendar?: ReviewCalendar;
  createId?: () => string;
  onFinished?: () => void;
  /** Anonymous ID supplied by a generic push link; resolved only from loaded local state. */
  preferredReminderId?: string;
  sync?: () => Promise<unknown>;
}

const currentTime = () => new Date().toISOString();

export function TodayReviewPage({
  repository,
  now = currentTime,
  calendar,
  createId = defaultCreateId,
  onFinished,
  preferredReminderId,
  sync,
}: TodayReviewPageProps) {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [session, setSession] = useState<ReviewSession>();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const reviewCalendar = calendar;
  const displayTime = useDisplayTime(now);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await repository.load();
        const selectedCalendar =
          reviewCalendar ?? createReviewCalendar(loaded.settings.timeZone);
        const timestamp = now();
        const localDate = selectedCalendar.today(timestamp);
        const unfinished = [...loaded.reviewSessions]
          .reverse()
          .find(
            (candidate) =>
              !candidate.completedAt && candidate.localDate === localDate,
          );
        if (unfinished && unfinished.orderedTaskIds.length > 0) {
          const refreshed = refreshReviewSession({
            session: unfinished,
            now: timestamp,
            calendar: selectedCalendar,
            tasks: loaded.tasks,
          });
          const currentTaskId =
            refreshed.orderedTaskIds[refreshed.currentIndex];
          const currentTask = loaded.tasks.find(
            (candidate) => candidate.id === currentTaskId,
          );
          const resumeIndex =
            currentTask?.status === "active"
              ? refreshed.currentIndex
              : findNextUnansweredReviewIndex(
                  refreshed,
                  loaded.tasks,
                  refreshed.currentIndex,
                );
          if (resumeIndex < refreshed.orderedTaskIds.length) {
            const resumed =
              resumeIndex === refreshed.currentIndex
                ? refreshed
                : {
                    ...refreshed,
                    currentIndex: resumeIndex,
                    updatedAt: timestamp,
                  };
            const next =
              resumed === unfinished
                ? loaded
                : {
                    ...loaded,
                    reviewSessions: loaded.reviewSessions.map((candidate) =>
                      candidate.id === unfinished.id ? resumed : candidate,
                    ),
                    savedAt: timestamp,
                  };
            if (next !== loaded) await repository.save(next);
            if (active) {
              setSnapshot(next);
              setSession(resumed);
            }
            return;
          }
        }
        const started = startReviewSession({
          sessionId: createId(),
          now: timestamp,
          calendar: selectedCalendar,
          tasks: loaded.tasks,
        });
        const preferredTaskId = resolveReminderTaskId(
          loaded,
          preferredReminderId ?? null,
        );
        const prioritized = preferredTaskId
          ? {
              ...started,
              orderedTaskIds: [
                preferredTaskId,
                ...started.orderedTaskIds.filter(
                  (taskId) => taskId !== preferredTaskId,
                ),
              ],
            }
          : started;
        const completedSessions = unfinished
          ? loaded.reviewSessions.map((candidate) =>
              candidate.id === unfinished.id
                ? { ...candidate, completedAt: timestamp, updatedAt: timestamp }
                : candidate,
            )
          : loaded.reviewSessions;
        const next = {
          ...loaded,
          reviewSessions: [...completedSessions, prioritized],
          savedAt: timestamp,
        };
        await repository.save(next);
        if (active) {
          setSnapshot(next);
          setSession(prioritized);
        }
      } catch {
        if (active)
          setError(
            "今日の確認を読み込めませんでした。もう一度お試しください。",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [createId, now, preferredReminderId, repository, reviewCalendar]);

  async function answer(
    answerType: ReviewAnswer,
    date?: string,
  ): Promise<void> {
    if (!snapshot || !session || isSaving) return;
    setIsSaving(true);
    setError(undefined);
    try {
      const timestamp = now();
      const selectedCalendar =
        reviewCalendar ?? createReviewCalendar(snapshot.settings.timeZone);
      const due = date
        ? resolveDueChoice({
            choice: { type: "custom", date },
            now: timestamp,
            calendar: selectedCalendar,
            weeklyReviewDay: snapshot.settings.weeklyReviewDay,
          })
        : undefined;
      const next = answerReview({
        snapshot,
        sessionId: session.id,
        answer: answerType,
        now: timestamp,
        calendar: selectedCalendar,
        due,
      });
      await repository.save(next);
      void sync?.();
      const updated = next.reviewSessions.find(
        (candidate) => candidate.id === session.id,
      )!;
      setSnapshot(next);
      setSession(updated);
      if (updated.completedAt) onFinished?.();
    } catch {
      setError("タスクを更新できませんでした。もう一度お試しください。");
    } finally {
      setIsSaving(false);
    }
  }

  async function previous(): Promise<void> {
    if (!snapshot || !session || session.currentIndex === 0 || isSaving) return;
    setIsSaving(true);
    try {
      const updated = goToPreviousTask(session, now());
      const next = {
        ...snapshot,
        reviewSessions: snapshot.reviewSessions.map((candidate) =>
          candidate.id === session.id ? updated : candidate,
        ),
        savedAt: now(),
      };
      await repository.save(next);
      setSnapshot(next);
      setSession(updated);
    } catch {
      setError("前のタスクへ戻れませんでした。もう一度お試しください。");
    } finally {
      setIsSaving(false);
    }
  }

  async function nextTask(): Promise<void> {
    if (!snapshot || !session || session.orderedTaskIds.length < 2 || isSaving)
      return;
    setIsSaving(true);
    try {
      const timestamp = now();
      const updated = goToNextTask(session, snapshot.tasks, timestamp);
      const next = {
        ...snapshot,
        reviewSessions: snapshot.reviewSessions.map((candidate) =>
          candidate.id === session.id ? updated : candidate,
        ),
        savedAt: timestamp,
      };
      await repository.save(next);
      setSnapshot(next);
      setSession(updated);
    } catch {
      setError("次のタスクへ進めませんでした。もう一度お試しください。");
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !snapshot) return <p role="alert">{error}</p>;
  if (!snapshot || !session) return <p>読み込んでいます…</p>;

  const selectedCalendar =
    reviewCalendar ?? createReviewCalendar(snapshot.settings.timeZone);
  const task = currentReviewTask({ session, tasks: snapshot.tasks });
  if (!task) {
    return (
      <section aria-labelledby="today-review-title">
        <header className="reviewHeader" data-testid="review-header">
          <h1 className="reviewHeader__title" id="today-review-title">
            今日の確認
          </h1>
        </header>
        <p>
          今日確認するものはありません。記録したことは受信箱やタスク一覧からいつでも見直せます
        </p>
      </section>
    );
  }

  const level = calculateNeglectLevel({
    ...task,
    now: displayTime,
    calendar: selectedCalendar,
  });
  const presentation = createReviewPresentation({
    task,
    now: displayTime,
    calendar: selectedCalendar,
    timeZone: snapshot.settings.timeZone,
  });
  const priorAnswer = latestSessionAnswer({
    actionEventIds: session.actionEventIds,
    events: snapshot.actionHistory,
    taskId: task.id,
    now: now(),
    calendar: selectedCalendar,
  });
  const currentStatus =
    task.status === "completed"
      ? "完了"
      : task.status === "archived"
        ? "アーカイブ"
        : priorAnswer === "完了" || priorAnswer === "アーカイブ"
          ? "対応中"
          : priorAnswer;
  const stateMessage =
    task.status === "completed"
      ? "このタスクは完了マーク済みです。"
      : task.status === "archived"
        ? "このタスクはアーカイブマーク済みです。"
        : choosePrompt(level).message;
  const statusClassName =
    task.status === "completed"
      ? "reviewCurrentStatus__value reviewCurrentStatus__value--completed"
      : task.status === "archived"
        ? "reviewCurrentStatus__value reviewCurrentStatus__value--archived"
        : "reviewCurrentStatus__value";
  return (
    <section aria-labelledby="today-review-title">
      <header className="reviewHeader" data-testid="review-header">
        <h1 className="reviewHeader__title" id="today-review-title">
          今日の確認
        </h1>
        {session.currentIndex > 0 ? (
          <button
            className="reviewHeader__previous"
            disabled={isSaving}
            onClick={() => void previous()}
            type="button"
          >
            前のタスク
          </button>
        ) : null}
        {session.orderedTaskIds.length > 1 ? (
          <button
            className="reviewHeader__next"
            disabled={isSaving}
            onClick={() => void nextTask()}
            type="button"
          >
            次のタスク
          </button>
        ) : null}
      </header>
      <article
        aria-label="確認するタスク"
        className={`reviewTaskCard${isTaskOverdue(task, displayTime) ? " reviewTaskCard--overdue" : ""}`}
      >
        <p
          className="reviewProgress"
          data-testid="review-progress"
          aria-label="進行状況"
        >
          {Math.min(session.currentIndex + 1, session.orderedTaskIds.length)} /{" "}
          {session.orderedTaskIds.length}
        </p>
        <p>{stateMessage}</p>
        <h2>{task.title}</h2>
        {task.category ? (
          <p aria-label="現在のカテゴリ" className="reviewTaskCategory">
            カテゴリ: {taskCategoryDisplayLabel(snapshot, task.category)}
          </p>
        ) : null}
        <p className="reviewDeadline">
          {isTaskOverdue(task, displayTime) ? <OverdueIndicator /> : null}
          <span>{presentation.deadline}</span>
        </p>
        <p>{presentation.elapsed}</p>
        {currentStatus ? (
          <p className="reviewCurrentStatus">
            <span>現在：</span>
            <strong className={statusClassName}>{currentStatus}</strong>
          </p>
        ) : null}
        <ReviewActionSheet
          key={task.id}
          disabled={isSaving}
          onAnswer={(action) => void answer(action)}
          onReschedule={(date) => void answer("reschedule", date)}
        />
      </article>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function defaultCreateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `review-${Date.now()}`;
}
