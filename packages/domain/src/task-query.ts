import type { Capture, Task } from "./model";

export type TaskTab = Task["status"];
export type DueFilter = "overdue" | "today" | "unset" | "none";

export interface TaskQuery {
  tab: TaskTab;
  now: string;
  /** Device-local date conversion supplied at the app boundary. */
  calendar: { today(instant: string): string };
  due?: DueFilter;
  category?: Task["category"];
  search?: string;
}

/**
 * Returns tasks for the requested view without embedding device time-zone or
 * UI concerns in the domain. Array.sort is stable on supported runtimes, so
 * equally ranked tasks retain their persisted order.
 */
export function listTasks(tasks: readonly Task[], query: TaskQuery, captures: readonly Capture[] = []): Task[] {
  const search = query.search?.trim().toLocaleLowerCase("ja-JP");
  return tasks
    .filter((task) => task.status === query.tab)
    .filter((task) => !query.category || task.category === query.category)
    .filter((task) => !search || matchesSearch(task, captures, search))
    .filter((task) => !query.due || matchesDueFilter(task, query))
    .slice()
    .sort(compareTasks);
}

function matchesDueFilter(task: Task, query: TaskQuery): boolean {
  switch (query.due) {
    case "overdue":
      return task.dueMode === "scheduled" && task.dueAt !== undefined && task.dueAt < query.now;
    case "today":
      return task.dueMode === "scheduled" && task.dueAt !== undefined && query.calendar.today(task.dueAt) === query.calendar.today(query.now);
    case "unset": return task.dueMode === "unset";
    case "none": return task.dueMode === "none";
    default: return false;
  }
}

function matchesSearch(task: Task, captures: readonly Capture[], search: string): boolean {
  const source = captures.find((capture) => capture.id === task.sourceCaptureId)?.body ?? "";
  return task.title.toLocaleLowerCase("ja-JP").includes(search)
    || source.toLocaleLowerCase("ja-JP").includes(search);
}

function compareTasks(left: Task, right: Task): number {
  return compareOptional(left.nextReviewAt, right.nextReviewAt)
    || compareOptional(left.dueAt, right.dueAt)
    || left.createdAt.localeCompare(right.createdAt);
}

function compareOptional(left: string | undefined, right: string | undefined): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right);
}
