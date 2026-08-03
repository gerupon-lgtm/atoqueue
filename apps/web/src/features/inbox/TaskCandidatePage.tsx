import { useEffect, useState, type FormEvent } from "react";
import {
  confirmTask,
  createLocalCalendar,
  markAsNote,
  resolveDueChoice,
  type AppRepository,
  type DueChoice,
  type Task,
} from "../../../../../packages/domain/src";

export interface TaskCandidatePageProps {
  repository: AppRepository;
  captureId: string;
  now?: () => string;
  createId?: () => string;
  onReturn?: () => void;
  onCompleted?: () => void;
}

export function TaskCandidatePage({
  repository,
  captureId,
  now = () => new Date().toISOString(),
  createId = defaultCreateId,
  onReturn,
  onCompleted,
}: TaskCandidatePageProps) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Task["category"] | "">("");
  const [dueType, setDueType] = useState<DueChoice["type"]>("unset");
  const [customDate, setCustomDate] = useState("");
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let current = true;
    void repository
      .load()
      .then((snapshot) => {
        const capture = snapshot.captures.find((candidate) => candidate.id === captureId);
        if (!capture || capture.classification !== "unclassified") {
          throw new Error("Capture is unavailable.");
        }
        if (current) setTitle(capture.body);
      })
      .catch(() => {
        if (current) setError("この記録は整理できません。受信箱へ戻ってください。");
      });
    return () => {
      current = false;
    };
  }, [captureId, repository]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSaving || !title.trim()) return;

    setIsSaving(true);
    setError(undefined);
    try {
      const snapshot = await repository.load();
      const dueChoice = choiceFromForm(dueType, customDate);
      const timestamp = now();
      const due = resolveDueChoice({
        choice: dueChoice,
        now: timestamp,
        calendar: createLocalCalendar(snapshot.settings.timeZone),
      });
      await repository.save(
        confirmTask({
          snapshot,
          captureId,
          taskId: createId(),
          title,
          ...(category ? { category } : {}),
          due,
          now: timestamp,
        }),
      );
      (onReturn ?? onCompleted)?.();
    } catch {
      setError("タスクを保存できませんでした。もう一度お試しください。");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveAsNote(): Promise<void> {
    if (isSaving) return;

    setIsSaving(true);
    setError(undefined);
    try {
      const snapshot = await repository.load();
      await repository.save(markAsNote({ snapshot, captureId, now: now() }));
      (onReturn ?? onCompleted)?.();
    } catch {
      setError("メモを保存できませんでした。もう一度お試しください。");
    } finally {
      setIsSaving(false);
    }
  }

  const categoryCandidate = suggestCategory(title);

  return (
    <section aria-labelledby="task-candidate-title">
      <h1 id="task-candidate-title">タスク候補を確認</h1>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="task-title">タスク名</label>
        <input
          id="task-title"
          onChange={(event) => setTitle(event.target.value)}
          readOnly={isSaving}
          value={title}
        />
        {categoryCandidate ? <p>カテゴリ候補: {categoryLabel(categoryCandidate)}</p> : null}
        <label htmlFor="task-category">カテゴリ</label>
        <select
          id="task-category"
          onChange={(event) => setCategory(event.target.value as Task["category"] | "")}
          value={category}
        >
          <option value="">選択しない</option>
          <option value="work">仕事</option>
          <option value="home">家</option>
          <option value="shopping">買い物</option>
          <option value="other">その他</option>
        </select>
        <label htmlFor="task-due">期限</label>
        <select
          id="task-due"
          onChange={(event) => setDueType(event.target.value as DueChoice["type"])}
          value={dueType}
        >
          <option value="today">今日</option>
          <option value="tomorrow">明日</option>
          <option value="this_sunday">今週中</option>
          <option value="custom">日付を選ぶ</option>
          <option value="none">期限なし</option>
          <option value="unset">まだ決めない</option>
        </select>
        {dueType === "custom" ? (
          <>
            <label htmlFor="task-custom-due">日付</label>
            <input
              id="task-custom-due"
              onChange={(event) => setCustomDate(event.target.value)}
              required
              type="date"
              value={customDate}
            />
          </>
        ) : null}
        <button disabled={isSaving || !title.trim()} type="submit">
          タスクにする
        </button>
        <button disabled={isSaving} onClick={() => void saveAsNote()} type="button">
          メモにする
        </button>
        <button disabled={isSaving} onClick={() => (onReturn ?? onCompleted)?.()} type="button">
          受信箱へ戻る
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function choiceFromForm(type: DueChoice["type"], customDate: string): DueChoice {
  return type === "custom" ? { type, date: customDate } : { type };
}

function defaultCreateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `task-${Date.now()}`;
}

function suggestCategory(title: string): NonNullable<Task["category"]> | undefined {
  return /(?:買う|購入|スーパー|牛乳)/u.test(title) ? "shopping" : undefined;
}

function categoryLabel(category: NonNullable<Task["category"]>): string {
  return { work: "仕事", home: "家", shopping: "買い物", other: "その他" }[category];
}
