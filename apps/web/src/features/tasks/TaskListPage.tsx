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
  const tasks = useMemo(() => {
    if (!snapshot) return [];
    const timestamp = now();
    const calendar = createLocalCalendar(snapshot.settings.timeZone);
    return listTasks(
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
  }, [category, due, now, search, snapshot, tab]);

  if (!snapshot) return <p>読み込み中です…</p>;
  return (
    <section aria-labelledby="task-list-title">
      <h1 id="task-list-title">タスク</h1>
      <label>
        状態
        <select
          style={touchTarget}
          value={tab}
          onChange={(event) => setTab(event.target.value as TaskTab)}
        >
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
      <label>
        カテゴリ
        <select
          style={touchTarget}
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as Task["category"] | "")
          }
        >
          <option value="">すべて</option>
          <option value="work">仕事</option>
          <option value="home">家</option>
          <option value="shopping">買い物</option>
          <option value="other">その他</option>
        </select>
      </label>
      <label>
        検索
        <input
          style={touchTarget}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {tasks.length === 0 ? (
        <p>該当するタスクはありません。</p>
      ) : (
        <ul>
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                aria-label={task.title}
                style={touchTarget}
                to={`/tasks/${task.id}`}
              >
                {task.title}
              </Link>{" "}
              <span aria-label={`${task.title}の期限状態`}>
                {dueState(
                  task,
                  now(),
                  createLocalCalendar(snapshot.settings.timeZone),
                )}
              </span>{" "}
              {task.dueAt ? (
                <span aria-label={`${task.title}の期限日時`}>
                  期限:{" "}
                  {formatLocalDateTime(task.dueAt, snapshot.settings.timeZone)}
                </span>
              ) : null}{" "}
              <span aria-label={`${task.title}の登録日時`}>
                登録:{" "}
                {formatLocalDateTime(
                  task.createdAt,
                  snapshot.settings.timeZone,
                )}
              </span>
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
  if (task.dueAt < now) return "期限超過";
  return calendar.today(task.dueAt) === calendar.today(now)
    ? "今日が期限"
    : "期限あり";
}
