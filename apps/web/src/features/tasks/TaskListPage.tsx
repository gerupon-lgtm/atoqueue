import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  createLocalCalendar,
  listTasks,
  isTaskOverdue,
  type AppRepository,
  type DueFilter,
  type Task,
  type TaskTab,
} from "../../../../../packages/domain/src";
import { formatLocalDateTime } from "../../presentation/format-local-date-time";
import {
  taskCategoryDisplayLabel,
  taskCategoryOptions,
} from "./task-category-options";
import {
  currentTime,
  useTaskSnapshot,
} from "../../presentation/use-task-snapshot";
import {
  OverdueIndicator,
  OverdueClockIcon,
} from "../../presentation/OverdueIndicator";

export interface TaskListPageProps {
  repository: AppRepository;
  now?: () => string;
}

export function TaskListPage(props: TaskListPageProps) {
  const location = useLocation();
  return (
    <TaskListView
      key={location.key}
      {...props}
      overdueOnly={
        new URLSearchParams(location.search).get("due") === "overdue"
      }
    />
  );
}

function TaskListView({
  repository,
  now = currentTime,
  overdueOnly,
}: TaskListPageProps & { overdueOnly: boolean }) {
  const { snapshot, timestamp, error } = useTaskSnapshot(repository, now);
  const [tab, setTab] = useState<TaskTab>("active");
  const [due, setDue] = useState<DueFilter | "">(overdueOnly ? "overdue" : "");
  const [category, setCategory] = useState<Task["category"] | "">("");
  const [search, setSearch] = useState("");

  const display = useMemo(() => {
    if (!snapshot || !timestamp) return;
    const calendar = createLocalCalendar(snapshot.settings.timeZone);
    const tasks = listTasks(
      snapshot.tasks,
      {
        tab,
        now: timestamp,
        calendar,
        ...(due ? { due } : {}),
        ...(category ? { category } : {}),
        search,
      },
      snapshot.captures,
    );
    const overdueCount = listTasks(
      snapshot.tasks,
      {
        tab: "active",
        due: "overdue",
        now: timestamp,
        calendar,
      },
      snapshot.captures,
    ).length;
    return { calendar, overdueCount, tasks, timestamp };
  }, [category, due, timestamp, search, snapshot, tab]);

  if (error)
    return (
      <p role="alert">
        タスクを読み込めませんでした。画面を開き直してください。
      </p>
    );
  if (!snapshot || !display) return <p>読み込み中です…</p>;
  const categoryOptions = taskCategoryOptions(snapshot);
  return (
    <section aria-labelledby="task-list-title" className="task-list">
      <h1 id="task-list-title">タスク</h1>
      {display.overdueCount > 0 ? (
        <button
          aria-label="期限超過のタスクを見る"
          className="task-list__overdue-link"
          onClick={() => {
            setTab("active");
            setDue("overdue");
            setCategory("");
            setSearch("");
          }}
          type="button"
        >
          <OverdueClockIcon /> 期限超過のタスクを見る（{display.overdueCount}
          件）
        </button>
      ) : null}
      <section aria-label="タスクを絞り込む" className="task-list__filters">
        <label>
          状態
          <select
            style={touchTarget}
            value={tab}
            onChange={(event) => setTab(event.target.value as TaskTab)}
          >
            <option value="all">すべて</option>
            <option value="active">対応中</option>
            <option value="completed">完了</option>
            <option value="archived">アーカイブ</option>
          </select>
        </label>
        <label>
          期限
          <select
            style={touchTarget}
            value={due}
            onChange={(event) => setDue(event.target.value as DueFilter | "")}
          >
            <option value="">すべて</option>
            <option value="overdue">期限超過</option>
            <option value="today">今日</option>
            <option value="unset">未設定</option>
            <option value="none">なし</option>
          </select>
        </label>
        <label className="task-list__category">
          カテゴリ
          <select
            style={touchTarget}
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as Task["category"] | "")
            }
          >
            <option value="">すべて</option>
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="task-list__search">
          検索
          <input
            style={touchTarget}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </section>
      {tab === "completed" ? (
        <p className="task-list__hint">
          完了したタスクは、詳細画面の「再開」で戻せます。
        </p>
      ) : null}
      {display.tasks.length === 0 ? (
        <p>該当するタスクはありません。</p>
      ) : (
        <ul className="task-list__items">
          {display.tasks.map((task) => (
            <li key={task.id}>
              <Link
                aria-label={task.title}
                className="task-list__item-title"
                style={touchTarget}
                to={`/tasks/${task.id}`}
              >
                {task.title}
              </Link>
              <div className="task-list__item-meta">
                {isTaskOverdue(task, display.timestamp) ? (
                  <OverdueIndicator ariaLabel={`${task.title}の期限状態`} />
                ) : (
                  <span
                    aria-label={`${task.title}の期限状態`}
                    className="task-list__due-state"
                  >
                    {dueState(task, display.timestamp, display.calendar)}
                  </span>
                )}
                {task.category ? (
                  <span
                    aria-label={`${task.title}のカテゴリ`}
                    className="task-list__category-badge"
                  >
                    カテゴリ:{" "}
                    {taskCategoryDisplayLabel(snapshot, task.category)}
                  </span>
                ) : null}
                {task.dueAt ? (
                  <span aria-label={`${task.title}の期限日時`}>
                    期限:{" "}
                    {formatLocalDateTime(
                      task.dueAt,
                      snapshot.settings.timeZone,
                    )}
                  </span>
                ) : null}
                <span aria-label={`${task.title}の登録日時`}>
                  登録:{" "}
                  {formatLocalDateTime(
                    task.createdAt,
                    snapshot.settings.timeZone,
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const touchTarget = { minHeight: "44px", minWidth: "44px" };

function dueState(
  task: Task,
  now: string,
  calendar: { today(instant: string): string },
): string {
  if (task.dueMode === "unset") return "期限未設定";
  if (task.dueMode === "none") return "期限なし";
  if (!task.dueAt) return "期限あり";
  if (task.status === "active" && task.dueAt < now) return "期限超過";
  return calendar.today(task.dueAt) === calendar.today(now)
    ? "今日が期限"
    : "期限あり";
}
