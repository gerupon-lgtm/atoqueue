import { useEffect, useState } from "react";
import {
  calculateNeglectLevel,
  createLocalCalendar,
  modifyTask,
  isTaskOverdue,
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
import {
  taskCategoryDisplayLabel,
  taskCategoryOptions,
} from "./task-category-options";
import { OverdueIndicator } from "../../presentation/OverdueIndicator";
import { useDisplayTime } from "../../presentation/use-task-snapshot";

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
  const displayTime = useDisplayTime(now);
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Task["category"] | "">("");
  const [selectedDueDate, setSelectedDueDate] = useState("");
  const [selectedDueTime, setSelectedDueTime] = useState("");
  const [dueTimeEnabled, setDueTimeEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<DirectTaskChange["type"]>();
  const [feedback, setFeedback] = useState<{
    area: "content" | "deadline" | "status";
    kind: "success" | "error";
    message: string;
    syncPending?: boolean;
  }>();
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

  async function change(
    change: DirectTaskChange,
    result: { area: "content" | "deadline" | "status"; message: string },
  ): Promise<void> {
    if (!snapshot || busy) return;
    setBusy(true);
    setBusyAction(change.type);
    setFeedback(undefined);
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
      if (change.type === "no_due") {
        setSelectedDueDate("");
        setSelectedDueTime("");
        setDueTimeEnabled(false);
      }
      setFeedback({ ...result, kind: "success" });
      if (sync) {
        try {
          await sync(next);
        } catch {
          setFeedback({ ...result, kind: "success", syncPending: true });
        }
      }
    } catch {
      setFeedback({
        area: result.area,
        kind: "error",
        message: "変更を保存できませんでした。もう一度お試しください。",
      });
    } finally {
      setBusy(false);
      setBusyAction(undefined);
    }
  }

  if (!snapshot) return <p>読み込み中です…</p>;
  const task = snapshot.tasks.find((item) => item.id === taskId);
  if (!task) return <p role="alert">タスクが見つかりません。</p>;
  const timestamp = displayTime;
  const level = calculateNeglectLevel({
    ...task,
    now: timestamp,
    calendar: createReviewCalendar(snapshot.settings.timeZone),
  });
  const source = snapshot.captures.find(
    (capture) => capture.id === task.sourceCaptureId,
  );
  const categoryOptions = taskCategoryOptions(snapshot);
  const applyDue = async (type: "reschedule" | "no_due") => {
    if (type === "no_due")
      return change(
        { type },
        { area: "deadline", message: "期限なしに変更しました。" },
      );
    const date = dateFromDigits(selectedDueDate);
    if (!date)
      return setFeedback({
        area: "deadline",
        kind: "error",
        message: "新しい期限日を8桁で入力してください。",
      });
    const time = dueTimeEnabled ? timeFromDigits(selectedDueTime) : undefined;
    if (dueTimeEnabled && !time)
      return setFeedback({
        area: "deadline",
        kind: "error",
        message: "期限時刻を4桁で入力してください。",
      });
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
    return change(
      { type, due },
      { area: "deadline", message: "期限を変更しました。" },
    );
  };
  return (
    <section aria-labelledby="task-detail-title">
      <header className="task-detail__header">
        <h1 id="task-detail-title">タスクを修正</h1>
        {onReturn ? (
          <button
            className="task-detail__return"
            onClick={onReturn}
            style={touchTarget}
            type="button"
          >
            タスク一覧
          </button>
        ) : null}
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
          <div aria-label="現在のカテゴリ">
            <dt>カテゴリ: </dt>
            <dd>{taskCategoryDisplayLabel(snapshot, task.category)}</dd>
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
              {isTaskOverdue(task, timestamp) ? (
                <OverdueIndicator>
                  {dueLabel(
                    task,
                    timestamp,
                    createLocalCalendar(snapshot.settings.timeZone),
                    snapshot.settings.timeZone,
                  )}
                </OverdueIndicator>
              ) : (
                dueLabel(
                  task,
                  timestamp,
                  createLocalCalendar(snapshot.settings.timeZone),
                  snapshot.settings.timeZone,
                )
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
      {task.status === "active" ? (
        <section
          className="task-detail__section"
          aria-labelledby="task-detail-status-heading"
        >
          <h2 id="task-detail-status-heading">状態</h2>
          <div className="task-detail__actions task-detail__status-actions">
            <button
              className="task-detail__complete"
              disabled={busy}
              style={touchTarget}
              type="button"
              onClick={() =>
                void change(
                  { type: "complete" },
                  { area: "status", message: "完了にしました。" },
                )
              }
            >
              {busyAction === "complete" ? "変更中…" : "完了"}
            </button>
            <button
              className="task-detail__dismiss"
              disabled={busy}
              style={touchTarget}
              type="button"
              onClick={() =>
                void change(
                  { type: "dismiss" },
                  { area: "status", message: "後回しにしました。" },
                )
              }
            >
              {busyAction === "dismiss" ? "変更中…" : "後回し"}
            </button>
            <button
              className="task-detail__archive"
              disabled={busy}
              style={touchTarget}
              type="button"
              onClick={() =>
                void change(
                  { type: "archive" },
                  { area: "status", message: "アーカイブしました。" },
                )
              }
            >
              {busyAction === "archive" ? "変更中…" : "アーカイブ"}
            </button>
          </div>
        </section>
      ) : (
        <div className="task-detail__actions task-detail__single-action">
          <button
            className="task-detail__reopen"
            disabled={busy}
            style={touchTarget}
            type="button"
            onClick={() =>
              void change(
                { type: "reopen" },
                { area: "status", message: "対応中に戻しました。" },
              )
            }
          >
            {busyAction === "reopen" ? "変更中…" : "再開"}
          </button>
        </div>
      )}
      <OperationFeedback area="status" feedback={feedback} />
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
            onChange={(event) => {
              if (feedback?.area === "content") setFeedback(undefined);
              setTitle(event.target.value);
            }}
          />
        </label>
        <label>
          カテゴリ
          <select
            style={touchTarget}
            value={category}
            onChange={(event) => {
              if (feedback?.area === "content") setFeedback(undefined);
              setCategory(event.target.value as Task["category"] | "");
            }}
          >
            <option value="">なし</option>
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="task-detail__actions task-detail__content-actions">
          <button
            className="task-detail__content-save"
            disabled={busy}
            style={touchTarget}
            type="button"
            onClick={() =>
              void change(
                { type: "edit", title, category: category || null },
                { area: "content", message: "内容を保存しました。" },
              )
            }
          >
            {busyAction === "edit" ? "保存中…" : "内容を保存"}
          </button>
        </div>
        <OperationFeedback area="content" feedback={feedback} />
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
          onDateDigitsChange={(value) => {
            if (feedback?.area === "deadline") setFeedback(undefined);
            setSelectedDueDate(value);
          }}
          onTimeDigitsChange={(value) => {
            if (feedback?.area === "deadline") setFeedback(undefined);
            setSelectedDueTime(value);
          }}
          onTimeEnabledChange={(enabled) => {
            if (feedback?.area === "deadline") setFeedback(undefined);
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
              disabled={busy}
              style={touchTarget}
              type="button"
              onClick={() => void applyDue("reschedule")}
            >
              {busyAction === "reschedule" ? "保存中…" : "期限を保存"}
            </button>
            <button
              className="task-detail__no-due"
              disabled={busy}
              style={touchTarget}
              type="button"
              onClick={() => void applyDue("no_due")}
            >
              {busyAction === "no_due" ? "変更中…" : "期限なしにする"}
            </button>
          </div>
        ) : null}
        <OperationFeedback area="deadline" feedback={feedback} />
      </section>
      <h2>操作履歴</h2>
      <ActionHistoryList
        events={snapshot.actionHistory.filter(
          (event) => event.entityType === "task" && event.entityId === taskId,
        )}
        timeZone={snapshot.settings.timeZone}
      />
    </section>
  );
}

interface OperationFeedbackProps {
  area: "content" | "deadline" | "status";
  feedback:
    | {
        area: "content" | "deadline" | "status";
        kind: "success" | "error";
        message: string;
        syncPending?: boolean;
      }
    | undefined;
}

function OperationFeedback({ area, feedback }: OperationFeedbackProps) {
  if (!feedback || feedback.area !== area) return null;
  return (
    <div className="task-detail__feedback">
      <p role={feedback.kind === "success" ? "status" : "alert"}>
        {feedback.message}
      </p>
      {feedback.syncPending ? (
        <p role="alert">通知の更新を送信待ちにしています</p>
      ) : null}
    </div>
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
  const label = isTaskOverdue(task, now)
    ? "期限超過"
    : calendar.today(task.dueAt) === calendar.today(now)
      ? "今日が期限"
      : "期限あり";
  return `${formatLocalDateTime(task.dueAt, timeZone)}（${label}）`;
}
function neglectReason(level: number): string {
  return level >= 2 ? "後回し" : level === 1 ? "確認が必要" : "ありません";
}
