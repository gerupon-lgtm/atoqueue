import { useEffect, useState } from "react";
import { calculateNeglectLevel, createLocalCalendar, modifyTask, resolveDueChoice, type AppRepository, type AppSnapshot, type DirectTaskChange, type Task } from "../../../../../packages/domain/src";
import { createReviewCalendar } from "../../infrastructure/review-calendar/review-calendar";
import { ActionHistoryList } from "./ActionHistoryList";

export interface TaskDetailPageProps { repository: AppRepository; taskId: string; now?: () => string; sync?: (snapshot: AppSnapshot) => Promise<void>; }

export function TaskDetailPage({ repository, taskId, now = () => new Date().toISOString(), sync }: TaskDetailPageProps) {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Task["category"] | "">("");
  const [message, setMessage] = useState<string>();
  useEffect(() => { let current = true; void repository.load().then((value) => { const task = value.tasks.find((item) => item.id === taskId); if (current && task) { setSnapshot(value); setTitle(task.title); setCategory(task.category ?? ""); } }); return () => { current = false; }; }, [repository, taskId]);

  async function change(change: DirectTaskChange): Promise<void> {
    if (!snapshot) return;
    const timestamp = now();
    const next = modifyTask({ snapshot, taskId, change, now: timestamp, calendar: createReviewCalendar(snapshot.settings.timeZone) });
    await repository.save(next);
    setSnapshot(next);
    const task = next.tasks.find((item) => item.id === taskId)!;
    setTitle(task.title); setCategory(task.category ?? "");
    if (sync) { try { await sync(next); setMessage(undefined); } catch { setMessage("通知の更新を後で同期します。"); } }
  }

  if (!snapshot) return <p>読み込み中です…</p>;
  const task = snapshot.tasks.find((item) => item.id === taskId);
  if (!task) return <p role="alert">タスクが見つかりません。</p>;
  const timestamp = now();
  const level = calculateNeglectLevel({ ...task, now: timestamp, calendar: createReviewCalendar(snapshot.settings.timeZone) });
  const source = snapshot.captures.find((capture) => capture.id === task.sourceCaptureId);
  const applyDue = async (type: "reschedule" | "no_due") => {
    if (type === "no_due") return change({ type });
    const due = resolveDueChoice({ choice: { type: "tomorrow" }, now: timestamp, calendar: createLocalCalendar(snapshot.settings.timeZone), weeklyReviewDay: snapshot.settings.weeklyReviewDay });
    return change({ type, due });
  };
  return <section aria-labelledby="task-detail-title">
    <h1 id="task-detail-title">タスクを修正</h1>
    <p aria-label="元の記録">元の記録: {source?.body ?? "見つかりません"}</p><p aria-label="現在の状態">状態: {statusLabel(task.status)}</p><p aria-label="期限の状態">期限: {dueLabel(task, timestamp)}</p><p aria-label="次の確認">次の確認: {task.nextReviewAt}</p><p aria-label="放置理由">放置理由: {neglectReason(level)}</p>
    <label>タイトル<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>カテゴリ<select value={category} onChange={(event) => setCategory(event.target.value as Task["category"] | "")}><option value="">なし</option><option value="work">仕事</option><option value="home">家</option><option value="shopping">買い物</option><option value="other">その他</option></select></label><button type="button" onClick={() => void change({ type: "edit", title, category: category || null })}>編集を保存</button>
    {task.status === "active" ? <><button type="button" onClick={() => void change({ type: "complete" })}>完了</button><button type="button" onClick={() => void applyDue("reschedule")}>期限を変更</button><button type="button" onClick={() => void applyDue("no_due")}>期限なし</button><button type="button" onClick={() => void change({ type: "dismiss" })}>後回し</button><button type="button" onClick={() => void change({ type: "archive" })}>アーカイブ</button></> : <button type="button" onClick={() => void change({ type: "reopen" })}>再開</button>}
    <h2>操作履歴</h2><ActionHistoryList events={snapshot.actionHistory.filter((event) => event.entityType === "task" && event.entityId === taskId)} />
    {message ? <p role="alert">{message}</p> : null}
  </section>;
}

function statusLabel(status: Task["status"]): string { return status === "active" ? "対応中" : status === "completed" ? "完了" : "アーカイブ"; }
function dueLabel(task: Task, now: string): string { if (task.dueMode === "unset") return "期限未設定"; if (task.dueMode === "none") return "期限なし"; return task.dueAt && task.dueAt < now ? "期限超過" : "期限あり"; }
function neglectReason(level: number): string { return level >= 2 ? "後回し" : level === 1 ? "確認が必要" : "ありません"; }
