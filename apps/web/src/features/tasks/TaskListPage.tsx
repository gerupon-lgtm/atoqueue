import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  createLocalCalendar,
  listTasks,
  isTaskOverdue,
  type AppRepository,
  type DueFilter,
  type Task,
  type TaskTab,
  type TempalistDraft,
  type PreparedTempalistRequest,
} from "../../../../../packages/domain/src";
import { formatLocalDateTime } from "../../presentation/format-local-date-time";
import type { TempalistTransferService } from "../../application/tempalist-transfer-service";
import { TempalistTransferPanel } from "../tempalist/TempalistTransferPanel";
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
  tempalist?: TempalistTransferService;
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
  tempalist,
}: TaskListPageProps & { overdueOnly: boolean }) {
  const { snapshot, timestamp, error } = useTaskSnapshot(repository, now);
  const [tab, setTab] = useState<TaskTab>("active");
  const [due, setDue] = useState<DueFilter | "">(overdueOnly ? "overdue" : "");
  const [category, setCategory] = useState<Task["category"] | "">("");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"list" | "select" | "review" | "retry">(
    "list",
  );
  const [draft, setDraft] = useState<TempalistDraft>({
    title: "あとキューのチェックリスト",
    tasks: [],
  });
  const [lastRequest, setLastRequest] =
    useState<PreparedTempalistRequest | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const retryPending = useRef(false);
  const [retryMessage, setRetryMessage] = useState("");
  useEffect(() => {
    if (mode === "review" || mode === "retry") return;
    let active = true;
    if (tempalist)
      void tempalist
        .lastRequest()
        .then((request) => {
          if (active) setLastRequest(request);
        })
        .catch(() => {
          if (active)
            setRetryMessage(
              "直前の連携を読み込めませんでした。タスクから選び直してください。",
            );
        });
    return () => {
      active = false;
    };
  }, [tempalist, mode]);

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
  if (tempalist && mode === "review")
    return (
      <TempalistTransferPanel
        draft={draft}
        onChange={setDraft}
        service={tempalist}
        onCancel={() => {
          // Explicit return refreshes the selection after a changed/deleted-task warning.
          setDraft((previous) => ({
            ...previous,
            tasks: previous.tasks.flatMap((selected) => {
              const task = snapshot.tasks.find(
                (task) => task.id === selected.id,
              );
              return task
                ? [{ id: task.id, title: task.title, revision: task.revision }]
                : [];
            }),
          }));
          setMode("select");
        }}
      />
    );
  if (tempalist && mode === "retry" && lastRequest)
    return (
      <section className="tempalist-transfer" aria-busy={retryBusy}>
        <h1>直前の連携</h1>
        <h2>{lastRequest.payload.title}</h2>
        <ol>
          {lastRequest.payload.items.map((item) => (
            <li key={item.sourceTaskId}>{item.label}</li>
          ))}
        </ol>
        <p>
          保存済みの確定内容をもう一度開きます。元のタスクと通知はあとキューに残ります。
        </p>
        <p>
          URLには選択したタスク名が含まれます。Android優先・iOSの起動先と保存先は未検証です。
        </p>
        <button
          type="button"
          disabled={retryBusy}
          onClick={() => {
            if (retryPending.current) return;
            retryPending.current = true;
            setRetryBusy(true);
            setRetryMessage("");
            void tempalist
              .open(lastRequest)
              .then(() =>
                setRetryMessage(
                  "開く操作を受け付けました。受信・保存の成功を示すものではありません。",
                ),
              )
              .catch(() =>
                setRetryMessage(
                  "開く操作を完了できませんでした。同じ内容でもう一度開いてください。",
                ),
              )
              .finally(() => {
                retryPending.current = false;
                setRetryBusy(false);
              });
          }}
        >
          直前の連携をもう一度開く
        </button>
        <button
          type="button"
          disabled={retryBusy}
          onClick={() => setMode("list")}
        >
          タスクに戻る
        </button>
        {retryBusy && <p role="status">保存しています…</p>}
        {retryMessage && <p role="status">{retryMessage}</p>}
      </section>
    );
  return (
    <section aria-labelledby="task-list-title" className="task-list">
      <h1 id="task-list-title">タスク</h1>
      {tempalist && (
        <div className="tempalist-selection">
          {mode === "list" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraft({ title: "あとキューのチェックリスト", tasks: [] });
                  setMode("select");
                }}
              >
                チェックリストにする
              </button>
              {lastRequest && (
                <button
                  type="button"
                  onClick={() => {
                    setRetryMessage("");
                    setMode("retry");
                  }}
                >
                  直前の連携を確認
                </button>
              )}
              {retryMessage && <p role="status">{retryMessage}</p>}
            </>
          ) : (
            <>
              <p aria-live="polite">
                {draft.tasks.length}件選択中（表示外も含む）
              </p>
              <button
                type="button"
                disabled={draft.tasks.length === 0}
                onClick={() => setMode("review")}
              >
                内容を確認
              </button>
              <button type="button" onClick={() => setMode("list")}>
                選択をやめる
              </button>
            </>
          )}
        </div>
      )}
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
              {mode === "select" && (
                <label className="tempalist-select-task">
                  <input
                    type="checkbox"
                    aria-label={`${task.title}を選択`}
                    checked={draft.tasks.some(
                      (selected) => selected.id === task.id,
                    )}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        tasks: event.target.checked
                          ? [
                              ...previous.tasks,
                              {
                                id: task.id,
                                title: task.title,
                                revision: task.revision,
                              },
                            ]
                          : previous.tasks.filter(
                              (selected) => selected.id !== task.id,
                            ),
                      }))
                    }
                  />
                  選択
                </label>
              )}
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
