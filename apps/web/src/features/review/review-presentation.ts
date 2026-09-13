import type {
  ActionEvent,
  ReviewCalendar,
  Task,
} from "../../../../../packages/domain/src";
import { formatLocalDateTime } from "../../presentation/format-local-date-time";

export function createReviewPresentation(input: {
  task: Pick<Task, "dueMode" | "dueAt" | "nextReviewAt">;
  now: string;
  calendar: ReviewCalendar;
  timeZone: string;
}): { deadline: string; elapsed: string } {
  if (input.task.dueMode === "none")
    return { deadline: "期限なし", elapsed: "週次確認" };
  if (input.task.dueMode === "unset")
    return {
      deadline: "期限未設定",
      elapsed: `次回確認: ${input.calendar.today(input.task.nextReviewAt)}`,
    };
  if (!input.task.dueAt)
    return { deadline: "期限あり", elapsed: "期限を確認してください" };

  const date = input.calendar.today(input.task.dueAt);
  const deadline = formatLocalDateTime(input.task.dueAt, input.timeZone);
  if (input.calendar.compareInstants(input.task.dueAt, input.now) < 0) {
    return {
      deadline: `期限: ${deadline}`,
      elapsed: `期限から${input.calendar.elapsedDays(input.task.dueAt, input.now)}日`,
    };
  }
  return {
    deadline: `期限: ${deadline}`,
    elapsed:
      date === input.calendar.today(input.now)
        ? "期限は今日"
        : `期限まで: ${date}`,
  };
}

export function latestSessionAnswer(input: {
  actionEventIds: string[];
  events: ActionEvent[];
  taskId: string;
  now: string;
  calendar: ReviewCalendar;
}): string | undefined {
  const byId = new Map(input.events.map((event) => [event.id, event]));
  for (const id of [...input.actionEventIds].reverse()) {
    const event = byId.get(id);
    if (
      !event ||
      event.entityType !== "task" ||
      event.entityId !== input.taskId
    )
      continue;
    if (event.action === "task_completed") return "完了";
    if (event.action === "task_marked_no_due") return "期限なし";
    if (event.action === "task_dismissed") return "今回は閉じる";
    if (event.action === "task_archived") return "アーカイブ";
    if (event.action === "task_rescheduled") {
      const dueAt = event.after?.dueAt;
      return typeof dueAt === "string" &&
        dueAt === input.calendar.endOfDay(input.calendar.today(input.now))
        ? "今日やる"
        : "日付を変えた";
    }
  }
  return undefined;
}
