import type { ActionEvent } from "../../../../../packages/domain/src";

const labels: Record<ActionEvent["action"], string> = {
  capture_created: "記録を作成",
  capture_classified: "記録を分類",
  task_created: "タスクを作成",
  task_completed: "完了",
  task_rescheduled: "期限を変更",
  task_marked_no_due: "期限なしに変更",
  task_dismissed: "後回し",
  task_archived: "アーカイブ",
  task_edited: "内容を編集",
  task_reopened: "再開",
  backup_exported: "バックアップを出力",
  backup_restored: "バックアップを復元",
};

export function ActionHistoryList({ events }: { events: readonly ActionEvent[] }) {
  if (events.length === 0) return <p>操作履歴はありません。</p>;
  return <ol aria-label="操作履歴">
    {[...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)).map((event) => (
      <li key={event.id}><time dateTime={event.occurredAt}>{event.occurredAt}</time> — {labels[event.action]}</li>
    ))}
  </ol>;
}
