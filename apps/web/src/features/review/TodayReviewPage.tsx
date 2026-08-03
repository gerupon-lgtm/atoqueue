import { useEffect, useState } from "react";
import {
  answerReview,
  calculateNeglectLevel,
  choosePrompt,
  currentReviewTask,
  goToPreviousTask,
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
import { createReviewPresentation, latestSessionAnswer } from "./review-presentation";
import { resolveReminderTaskId } from "../../infrastructure/notifications/reminder-navigation";
import "./TodayReviewPage.css";

export interface TodayReviewPageProps {
  repository: AppRepository;
  now?: () => string;
  calendar?: ReviewCalendar;
  createId?: () => string;
  onFinished?: () => void;
  /** Anonymous ID supplied by a generic push link; resolved only from loaded local state. */
  preferredReminderId?: string;
}

const currentTime = () => new Date().toISOString();

export function TodayReviewPage({
  repository,
  now = currentTime,
  calendar,
  createId = defaultCreateId,
  onFinished,
  preferredReminderId,
}: TodayReviewPageProps) {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [session, setSession] = useState<ReviewSession>();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const reviewCalendar = calendar;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await repository.load();
        const selectedCalendar = reviewCalendar ?? createReviewCalendar(loaded.settings.timeZone);
        const unfinished = [...loaded.reviewSessions].reverse().find((candidate) => !candidate.completedAt);
        if (unfinished && unfinished.orderedTaskIds.length > 0 && currentReviewTask({ session: unfinished, tasks: loaded.tasks })) {
          if (active) {
            setSnapshot(loaded);
            setSession(unfinished);
          }
          return;
        }
        const timestamp = now();
        const started = startReviewSession({ sessionId: createId(), now: timestamp, calendar: selectedCalendar, tasks: loaded.tasks });
        const preferredTaskId = resolveReminderTaskId(loaded, preferredReminderId ?? null);
        const prioritized = preferredTaskId
          ? { ...started, orderedTaskIds: [preferredTaskId, ...started.orderedTaskIds.filter((taskId) => taskId !== preferredTaskId)] }
          : started;
        const completedSessions = unfinished
          ? loaded.reviewSessions.map((candidate) => candidate.id === unfinished.id ? { ...candidate, completedAt: timestamp, updatedAt: timestamp } : candidate)
          : loaded.reviewSessions;
        const next = { ...loaded, reviewSessions: [...completedSessions, prioritized], savedAt: timestamp };
        await repository.save(next);
        if (active) {
          setSnapshot(next);
          setSession(prioritized);
        }
      } catch {
        if (active) setError("今日の確認を読み込めませんでした。もう一度お試しください。");
      }
    })();
    return () => { active = false; };
  }, [createId, now, preferredReminderId, repository, reviewCalendar]);

  async function answer(answerType: ReviewAnswer, date?: string): Promise<void> {
    if (!snapshot || !session || isSaving) return;
    setIsSaving(true);
    setError(undefined);
    try {
      const timestamp = now();
      const selectedCalendar = reviewCalendar ?? createReviewCalendar(snapshot.settings.timeZone);
      const due = date
        ? resolveDueChoice({ choice: { type: "custom", date }, now: timestamp, calendar: selectedCalendar, weeklyReviewDay: snapshot.settings.weeklyReviewDay })
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
      const updated = next.reviewSessions.find((candidate) => candidate.id === session.id)!;
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
      const next = { ...snapshot, reviewSessions: snapshot.reviewSessions.map((candidate) => candidate.id === session.id ? updated : candidate), savedAt: now() };
      await repository.save(next);
      setSnapshot(next);
      setSession(updated);
    } catch {
      setError("前のタスクへ戻れませんでした。もう一度お試しください。");
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !snapshot) return <p role="alert">{error}</p>;
  if (!snapshot || !session) return <p>読み込んでいます…</p>;

  const selectedCalendar = reviewCalendar ?? createReviewCalendar(snapshot.settings.timeZone);
  const task = currentReviewTask({ session, tasks: snapshot.tasks });
  if (!task) {
    return <section aria-labelledby="today-review-title"><h1 id="today-review-title">今日の確認</h1><p>今日確認するものはありません。記録したことは受信箱やタスク一覧からいつでも見直せます</p></section>;
  }

  const level = calculateNeglectLevel({ ...task, now: now(), calendar: selectedCalendar });
  const presentation = createReviewPresentation({ task, now: now(), calendar: selectedCalendar });
  const priorAnswer = latestSessionAnswer({ actionEventIds: session.actionEventIds, events: snapshot.actionHistory, taskId: task.id, now: now(), calendar: selectedCalendar });
  return (
    <section aria-labelledby="today-review-title">
      <header className="reviewHeader" data-testid="review-header">
        <button className="reviewHeader__previous" disabled={isSaving || session.currentIndex === 0} onClick={() => void previous()} type="button">← 前のタスク</button>
        <h1 className="reviewHeader__title" id="today-review-title">今日の確認</h1>
        <p className="reviewHeader__progress" aria-label="進行状況">{Math.min(session.currentIndex + 1, session.orderedTaskIds.length)} / {session.orderedTaskIds.length}</p>
      </header>
      <article aria-label="確認するタスク" className="reviewTaskCard">
        <p>{choosePrompt(level).message}</p>
        <h2>{task.title}</h2>
        <p>{presentation.deadline}</p>
        <p>{presentation.elapsed}</p>
        {priorAnswer ? <p>現在: {priorAnswer}</p> : null}
        <ReviewActionSheet key={task.id} disabled={isSaving} onAnswer={(action) => void answer(action)} onReschedule={(date) => void answer("reschedule", date)} />
      </article>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function defaultCreateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `review-${Date.now()}`;
}
