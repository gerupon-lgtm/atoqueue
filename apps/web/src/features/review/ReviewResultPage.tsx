import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { summarizeReview, type AppRepository, type AppSnapshot, type ReviewSession } from "../../../../../packages/domain/src";

export interface ReviewResultPageProps { repository: AppRepository; }

const actionLabels = {
  task_completed: "完了",
  task_rescheduled: "期限変更",
  task_marked_no_due: "期限なし",
  task_dismissed: "見送り",
  task_archived: "アーカイブ",
} as const;

export function ReviewResultPage({ repository }: ReviewResultPageProps) {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [session, setSession] = useState<ReviewSession>();

  useEffect(() => {
    let active = true;
    void repository.load().then((loaded) => {
      if (!active) return;
      setSnapshot(loaded);
      setSession([...loaded.reviewSessions].reverse().find((candidate) => candidate.completedAt));
    });
    return () => { active = false; };
  }, [repository]);

  if (!snapshot) return <p>読み込んでいます…</p>;
  if (!session) return <section aria-labelledby="review-result-title"><h1 id="review-result-title">今日の確認結果</h1><p>今日の処理結果はありません。</p></section>;

  const summary = summarizeReview(session, snapshot.actionHistory);
  const processedTasks = summary.processedTaskIds.map((id) => snapshot.tasks.find((task) => task.id === id)).filter((task): task is NonNullable<typeof task> => Boolean(task));
  return (
    <section aria-labelledby="review-result-title">
      <h1 id="review-result-title">今日の確認結果</h1>
      <ul aria-label="処理件数">
        {Object.entries(actionLabels).map(([action, label]) => <li key={action}>{label}: {summary.actionCounts[action as keyof typeof summary.actionCounts] ?? 0}件</li>)}
      </ul>
      <ul aria-label="処理したタスク">
        {processedTasks.map((task) => <li key={task.id}><span>{task.title} — {statusLabel(task.status)}</span> <Link aria-label={`${task.title}を修正`} to={`/tasks/${task.id}`}>修正</Link></li>)}
      </ul>
      <p><Link to="/tasks">タスク一覧を見る</Link></p>
      <p><Link to="/">記録へ戻る</Link></p>
    </section>
  );
}

function statusLabel(status: "active" | "completed" | "archived"): string {
  return status === "completed"
    ? "完了"
    : status === "archived"
      ? "アーカイブ"
      : "対応中";
}
