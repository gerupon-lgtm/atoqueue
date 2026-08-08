import { useState } from "react";

export interface ReviewActionSheetProps {
  disabled?: boolean;
  onAnswer: (
    answer: "complete" | "do_today" | "no_due" | "dismiss" | "archive",
  ) => void;
  onReschedule: (date: string) => void;
}

export function ReviewActionSheet({
  disabled = false,
  onAnswer,
  onReschedule,
}: ReviewActionSheetProps) {
  const [isChoosingDate, setIsChoosingDate] = useState(false);
  const [date, setDate] = useState("");

  if (isChoosingDate) {
    return (
      <form
        aria-label="日付を変える"
        className="reviewActionSheet"
        onSubmit={(event) => {
          event.preventDefault();
          if (!date || disabled) return;
          onReschedule(date);
        }}
      >
        <label htmlFor="review-reschedule-date">新しい期限</label>
        <input
          disabled={disabled}
          id="review-reschedule-date"
          onChange={(event) => setDate(event.target.value)}
          required
          type="date"
          value={date}
        />
        <button disabled={disabled || !date} type="submit">
          この日付にする
        </button>
        <button
          disabled={disabled}
          onClick={() => setIsChoosingDate(false)}
          type="button"
        >
          戻る
        </button>
      </form>
    );
  }

  return (
    <div aria-label="タスクの操作" className="reviewActionSheet">
      <button
        className="reviewActionSheet__complete"
        disabled={disabled}
        onClick={() => onAnswer("complete")}
        type="button"
      >
        完了
      </button>
      <button
        className="reviewActionSheet__today"
        disabled={disabled}
        onClick={() => onAnswer("do_today")}
        type="button"
      >
        今日やる
      </button>
      <button
        className="reviewActionSheet__reschedule"
        disabled={disabled}
        onClick={() => setIsChoosingDate(true)}
        type="button"
      >
        日付を変える
      </button>
      <button
        className="reviewActionSheet__no-due"
        disabled={disabled}
        onClick={() => onAnswer("no_due")}
        type="button"
      >
        期限なし
      </button>
      <button
        className="reviewActionSheet__dismiss"
        disabled={disabled}
        onClick={() => onAnswer("dismiss")}
        type="button"
      >
        今回は閉じる
      </button>
      <button
        className="reviewActionSheet__archive"
        disabled={disabled}
        onClick={() => onAnswer("archive")}
        type="button"
      >
        不要
      </button>
    </div>
  );
}
