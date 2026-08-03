import type { Task } from "./model";

export type TaskTab = Task["status"];
export type DueFilter = "overdue" | "today" | "unset" | "none";

export interface TaskQuery {
  tab: TaskTab;
  now: string;
  /** The device-local date (YYYY-MM-DD), supplied by the presentation layer. */
  today: string;
  due?: DueFilter;
  category?: Task["category"];
  search?: string;
}

/**
 * Returns tasks for the requested view without embedding device time-zone or
 * UI concerns in the domain. Array.sort is stable on supported runtimes, so
 * equally ranked tasks retain their persisted order.
 */
export function listTasks(tasks: readonly Task[], query: TaskQuery): Task[] {
  const search = query.search?.trim().toLocaleLowerCase("ja-JP");
  return tasks
    .filter((task) => task.status === query.tab)
    .filter((task) => !query.category || task.category === query.category)
    .filter((task) => !search || task.title.toLocaleLowerCase("ja-JP").includes(search))
    .filter((task) => !query.due || matchesDueFilter(task, query))
    .slice()
    .sort(compareTasks);
}

function matchesDueFilter(task: Task, query: TaskQuery): boolean {
  switch (query.due) {
    case "overdue":
      return task.dueMode === "scheduled" && task.dueAt !== undefined && task.dueAt < query.now;
    case "today":
      return task.dueMode === "scheduled" && task.dueAt !== undefined && task.dueAt.slice(0, 10) === query.today;
    case "unset": return task.dueMode === "unset";
    case "none": return task.dueMode === "none";
    default: return false;
  }
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
