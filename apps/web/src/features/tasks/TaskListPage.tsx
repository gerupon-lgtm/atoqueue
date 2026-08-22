import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  createLocalCalendar,
  listTasks,
  type AppRepository,
  type AppSnapshot,
  type DueFilter,
  type Task,
  type TaskTab,
} from "../../../../../packages/domain/src";
import { formatLocalDateTime } from "../../presentation/format-local-date-time";
import {
  taskCategoryDisplayLabel,
  taskCategoryOptions,
} from "./task-category-options";

export interface TaskListPageProps {
  repository: AppRepository;
  now?: () => string;
}

export function TaskListPage({
  repository,
  now = () => new Date().toISOString(),
}: TaskListPageProps) {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [tab, setTab] = useState<TaskTab>("active");
  const [due, setDue] = useState<DueFilter | "">("");
  const [category, setCategory] = useState<Task["category"] | "">("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let current = true;
    void repository.load().then((value) => {
      if (current) setSnapshot(value);
    });
    return () => {
      current = false;
    };
  }, [repository]);
  const display = useMemo(() => {
    if (!snapshot) return;
    const timestamp = now();
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
  }, [category, due, now, search, snapshot, tab]);

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
          }}
          type="button"
        >
          期限超過のタスクを見る（{display.overdueCount}件）
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
                <span
                  aria-label={`${task.title}の期限状態`}
                  className="task-list__due-state"
                >
                  {dueState(task, display.timestamp, display.calendar)}
                </span>
                {task.category ? (
                  <span
                    aria-label={`${task.title}のカテゴリ`}
                    className="task-list__category-badge"
                  >
                    カテゴリ: {taskCategoryDisplayLabel(snapshot, task.category)}
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
