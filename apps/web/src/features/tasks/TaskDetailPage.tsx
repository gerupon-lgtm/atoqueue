import { useEffect, useState } from "react";
import {
  calculateNeglectLevel,
  createLocalCalendar,
  modifyTask,
  resolveDueChoice,
  type AppRepository,
  type AppSnapshot,
  type DirectTaskChange,
  type Task,
} from "../../../../../packages/domain/src";
import { createReviewCalendar } from "../../infrastructure/review-calendar/review-calendar";
import { ActionHistoryList } from "./ActionHistoryList";
import { formatLocalDateTime } from "../../presentation/format-local-date-time";
import { formatLocalTime } from "../../presentation/format-local-time";
import {
  DeadlineInputFields,
  dateFromDigits,
  timeFromDigits,
} from "./DeadlineInputFields";

const defaultNow = () => new Date().toISOString();

export interface TaskDetailPageProps {
  repository: AppRepository;
  taskId: string;
  onReturn?: () => void;
  now?: () => string;
  sync?: (snapshot: AppSnapshot) => Promise<void>;
}

export function TaskDetailPage({
  repository,
  taskId,
  onReturn,
  now = defaultNow,
  sync,
}: TaskDetailPageProps) {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Task["category"] | "">("");
  const [selectedDueDate, setSelectedDueDate] = useState("");
  const [selectedDueTime, setSelectedDueTime] = useState("");
  const [dueTimeEnabled, setDueTimeEnabled] = useState(false);
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    let current = true;
    void repository.load().then((value) => {
      const task = value.tasks.find((item) => item.id === taskId);
      if (current && task) {
        setSnapshot(value);
        setTitle(task.title);
        setCategory(task.category ?? "");
        setSelectedDueDate(
          createLocalCalendar(value.settings.timeZone)
            .today(task.dueAt ?? now())
            .replaceAll("-", ""),
        );
        setSelectedDueTime(
          task.dueAt
            ? formatLocalTime(task.dueAt, value.settings.timeZone).replace(
                ":",
                "",
              )
            : "",
        );
        setDueTimeEnabled(Boolean(task.dueAt));
      }
    });
    return () => {
      current = false;
    };
  }, [now, repository, taskId]);

  async function change(change: DirectTaskChange): Promise<void> {
    if (!snapshot) return;
    try {
      const timestamp = now();
      const next = modifyTask({
        snapshot,
        taskId,
        change,
        now: timestamp,
        calendar: createReviewCalendar(snapshot.settings.timeZone),
      });
      await repository.save(next);
      setSnapshot(next);
      const task = next.tasks.find((item) => item.id === taskId)!;
      setTitle(task.title);
      setCategory(task.category ?? "");
      if (sync) {
        try {
          await sync(next);
          setMessage(undefined);
        } catch {
          setMessage("通知の更新を送信待ちにしています");
        }
      }
    } catch {
      setMessage("変更を保存できませんでした。もう一度お試しください。");
    }
  }

  if (!snapshot) return <p>読み込み中です…</p>;
  const task = snapshot.tasks.find((item) => item.id === taskId);
  if (!task) return <p role="alert">タスクが見つかりません。</p>;
  const timestamp = now();
  const level = calculateNeglectLevel({
    ...task,
    now: timestamp,
    calendar: createReviewCalendar(snapshot.settings.timeZone),
  });
  const source = snapshot.captures.find(
    (capture) => capture.id === task.sourceCaptureId,
  );
  const applyDue = async (type: "reschedule" | "no_due") => {
    if (type === "no_due") return change({ type });
    const date = dateFromDigits(selectedDueDate);
    if (!date) return setMessage("新しい期限日を8桁で入力してください。");
    const time = dueTimeEnabled ? timeFromDigits(selectedDueTime) : undefined;
    if (dueTimeEnabled && !time)
      return setMessage("期限時刻を4桁で入力してください。");
    const due = resolveDueChoice({
      choice: {
        type: "custom",
        date,
        time,
      },
      now: timestamp,
      calendar: createLocalCalendar(snapshot.settings.timeZone),
      weeklyReviewDay: snapshot.settings.weeklyReviewDay,
      defaultDeadlineTime: snapshot.settings.defaultDeadlineTime ?? "23:59",
    });
    return change({ type, due });
  };
  return (
    <section aria-labelledby="task-detail-title">
      <header className="task-detail__header">
        {onReturn ? (
          <button
            className="task-detail__return"
            onClick={onReturn}
            type="button"
          >
            ← タスク一覧に戻る
          </button>
        ) : null}
        <h1 id="task-detail-title">タスクを修正</h1>
      </header>
      <section className="task-detail__summary" aria-label="タスクの概要">
        <p className="task-detail__source" aria-label="元の記録">
          元の記録: {source?.body ?? "見つかりません"}
        </p>
        <dl>
          <div aria-label="現在の状態">
            <dt>状態: </dt>
            <dd>{statusLabel(task.status)}</dd>
          </div>
          <div aria-label="登録日時">
            <dt>登録日時: </dt>
            <dd>
              {formatLocalDateTime(task.createdAt, snapshot.settings.timeZone)}
            </dd>
          </div>
          <div aria-label="期限の状態">
            <dt>期限: </dt>
            <dd>
              {dueLabel(
                task,
                timestamp,
                createLocalCalendar(snapshot.settings.timeZone),
                snapshot.settings.timeZone,
              )}
            </dd>
          </div>
          {task.nextReviewAt !== task.dueAt ? (
            <div aria-label="次の確認">
              <dt>次の確認: </dt>
              <dd>
                {formatLocalDateTime(
                  task.nextReviewAt,
                  snapshot.settings.timeZone,
                )}
              </dd>
            </div>
          ) : null}
          <div aria-label="放置理由">
            <dt>放置理由</dt>
            <dd>{neglectReason(level)}</dd>
          </div>
        </dl>
      </section>
      <section
        className="task-detail__section"
        aria-labelledby="task-detail-content-heading"
      >
        <h2 id="task-detail-content-heading">内容</h2>
        <label>
          タイトル
          <input
            style={touchTarget}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
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
            <option value="">なし</option>
            <option value="work">仕事</option>
            <option value="home">家</option>
            <option value="shopping">買い物</option>
            <option value="other">その他</option>
          </select>
        </label>
        <div className="task-detail__actions task-detail__content-actions">
          <button
            className="task-detail__content-save"
            style={touchTarget}
            type="button"
            onClick={() =>
              void change({ type: "edit", title, category: category || null })
            }
          >
            内容を保存
          </button>
        </div>
      </section>
      <section
        className="task-detail__section"
        aria-labelledby="task-detail-deadline-heading"
      >
        <h2 id="task-detail-deadline-heading">期限</h2>
        <DeadlineInputFields
          dateDigits={selectedDueDate}
          defaultDeadlineTime={snapshot.settings.defaultDeadlineTime ?? "23:59"}
          idPrefix="task-detail"
          onDateDigitsChange={setSelectedDueDate}
          onTimeDigitsChange={setSelectedDueTime}
          onTimeEnabledChange={(enabled) => {
            setDueTimeEnabled(enabled);
            if (!enabled) setSelectedDueTime("");
          }}
          timeDigits={selectedDueTime}
          timeEnabled={dueTimeEnabled}
        />
        {task.status === "active" ? (
          <div className="task-detail__actions task-detail__deadline-actions">
            <button
              className="task-detail__deadline-save"
              style={touchTarget}
              type="button"
              onClick={() => void applyDue("reschedule")}
            >
              期限を保存
            </button>
            <button
              className="task-detail__no-due"
              style={touchTarget}
              type="button"
              onClick={() => void applyDue("no_due")}
            >
              期限なしにする
            </button>
          </div>
        ) : null}
      </section>
      {task.status === "active" ? (
        <section
          className="task-detail__section"
          aria-labelledby="task-detail-status-heading"
        >
          <h2 id="task-detail-status-heading">状態</h2>
          <div className="task-detail__actions task-detail__status-actions">
            <button
              className="task-detail__complete"
              style={touchTarget}
              type="button"
              onClick={() => void change({ type: "complete" })}
            >
              完了
            </button>
            <button
              className="task-detail__dismiss"
              style={touchTarget}
              type="button"
              onClick={() => void change({ type: "dismiss" })}
            >
              後回し
            </button>
            <button
              className="task-detail__archive"
              style={touchTarget}
              type="button"
              onClick={() => void change({ type: "archive" })}
            >
              アーカイブ
            </button>
          </div>
        </section>
      ) : (
        <div className="task-detail__actions task-detail__single-action">
          <button
            className="task-detail__reopen"
            style={touchTarget}
            type="button"
            onClick={() => void change({ type: "reopen" })}
          >
            再開
          </button>
        </div>
      )}
      <h2>操作履歴</h2>
      <ActionHistoryList
        events={snapshot.actionHistory.filter(
          (event) => event.entityType === "task" && event.entityId === taskId,
        )}
        timeZone={snapshot.settings.timeZone}
      />
      {message ? <p role="alert">{message}</p> : null}
    </section>
  );
}

function statusLabel(status: Task["status"]): string {
  return status === "active"
    ? "対応中"
    : status === "completed"
      ? "完了"
      : "アーカイブ";
}
const touchTarget = { minHeight: "44px", minWidth: "44px" };
function dueLabel(
  task: Task,
  now: string,
  calendar: { today(instant: string): string },
  timeZone: string,
): string {
  if (task.dueMode === "unset") return "期限未設定";
  if (task.dueMode === "none") return "期限なし";
  if (!task.dueAt) return "期限あり";
  const label =
    task.dueAt < now
      ? "期限超過"
      : calendar.today(task.dueAt) === calendar.today(now)
        ? "今日が期限"
        : "期限あり";
  return `${formatLocalDateTime(task.dueAt, timeZone)}（${label}）`;
}
function neglectReason(level: number): string {
  return level >= 2 ? "後回し" : level === 1 ? "確認が必要" : "ありません";
}
