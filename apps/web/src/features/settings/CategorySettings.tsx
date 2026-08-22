import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  PRESET_TASK_CATEGORIES,
  taskCategoryUsage,
  validateCustomTaskCategories,
  type AppRepository,
  type AppSnapshot,
} from "../../../../../packages/domain/src";
import "./CategorySettings.css";

export interface CategorySettingsProps {
  repository: AppRepository;
}

export function CategorySettings({ repository }: CategorySettingsProps) {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [categories, setCategories] = useState<string[]>([]);
  const [savedCategories, setSavedCategories] = useState<string[]>([]);
  const [pendingRemoval, setPendingRemoval] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void repository
      .load()
      .then((current) => {
        if (!active) return;
        setSnapshot(current);
        setCategories(current.settings.customTaskCategories);
        setSavedCategories(current.settings.customTaskCategories);
      })
      .catch(() => {
        if (active) setError("カテゴリを読み込めませんでした。");
      });
    return () => {
      active = false;
    };
  }, [repository]);

  const activeCategories = useMemo(
    () => categories.filter((category) => !pendingRemoval.has(category)),
    [categories, pendingRemoval],
  );
  const atLimit = activeCategories.length >= 10;
  const isDirty =
    JSON.stringify(activeCategories) !== JSON.stringify(savedCategories);

  function addCategory(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(undefined);
    setFeedback(undefined);
    try {
      const next = validateCustomTaskCategories([...activeCategories, name]);
      const added = next.at(-1)!;
      if (categories.includes(added)) {
        setPendingRemoval((current) => {
          const updated = new Set(current);
          updated.delete(added);
          return updated;
        });
      } else {
        setCategories([...categories, added]);
      }
      setName("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "追加できませんでした。",
      );
    }
  }

  function markForRemoval(category: string): void {
    setPendingRemoval((current) => new Set(current).add(category));
    setError(undefined);
    setFeedback(undefined);
  }

  function undoRemoval(category: string): void {
    setPendingRemoval((current) => {
      const next = new Set(current);
      next.delete(category);
      return next;
    });
  }

  async function saveCategories(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setFeedback(undefined);
    try {
      const nextCategories = validateCustomTaskCategories(activeCategories);
      const latest = await repository.load();
      const next: AppSnapshot = {
        ...latest,
        settings: {
          ...latest.settings,
          customTaskCategories: nextCategories,
        },
        savedAt: new Date().toISOString(),
      };
      await repository.save(next);
      setSnapshot(next);
      setCategories(nextCategories);
      setSavedCategories(nextCategories);
      setPendingRemoval(new Set());
      setFeedback("カテゴリを保存しました。");
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message !== "quota"
          ? reason.message
          : "カテゴリを保存できませんでした。入力内容は画面に残しています。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="category-settings-title"
      className="category-settings"
    >
      <h2 id="category-settings-title">カテゴリ</h2>
      <p>
        タスクで使うカテゴリを、この端末だけに追加できます。プリセットは変更できません。
      </p>

      <div className="category-settings__presets">
        <strong>プリセット（変更不可）</strong>
        <div className="category-settings__tags">
          {PRESET_TASK_CATEGORIES.map(({ label, value }) => (
            <span className="category-settings__tag is-preset" key={value}>
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="category-settings__custom-heading">
        <strong>追加カテゴリ</strong>
        <span>{activeCategories.length} / 10件</span>
      </div>
      {categories.length > 0 ? (
        <div className="category-settings__tags">
          {categories.map((category) => {
            const removing = pendingRemoval.has(category);
            const usage = snapshot
              ? taskCategoryUsage(snapshot.tasks, category)
              : { total: 0, active: 0, finished: 0 };
            return (
              <div
                className={`category-settings__custom${removing ? " is-removing" : ""}`}
                key={category}
              >
                <span className="category-settings__tag">{category}</span>
                <button
                  aria-label={
                    removing
                      ? `${category}の削除を元に戻す`
                      : `${category}を削除予定にする`
                  }
                  className="category-settings__tag-action"
                  onClick={() =>
                    removing ? undoRemoval(category) : markForRemoval(category)
                  }
                  type="button"
                >
                  {removing ? "元に戻す" : "×"}
                </button>
                {removing ? (
                  <div className="category-settings__removal-note">
                    <strong className="category-settings__removal-label">
                      削除予定
                    </strong>
                    <p>
                      「{category}」が付いたタスク: {usage.total}件（対応中
                      {usage.active}件、完了・アーカイブ{usage.finished}件）
                    </p>
                    <p>
                      選択肢からは削除されますが、これらのタスクには残ります。
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {atLimit ? (
        <p className="category-settings__limit">
          追加カテゴリは10件までです。削除予定にすると新しく追加できます。
        </p>
      ) : null}
      <form className="category-settings__add" onSubmit={addCategory}>
        <label>
          カテゴリ名
          <input
            disabled={atLimit || busy}
            maxLength={12}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <button
          disabled={atLimit || busy || name.trim().length === 0}
          type="submit"
        >
          追加
        </button>
      </form>
      <p className="category-settings__note">
        追加・削除した内容は、「カテゴリを保存」を押すと確定します。
      </p>
      <button
        disabled={busy || !snapshot || !isDirty}
        onClick={() => void saveCategories()}
        type="button"
      >
        {busy ? "保存中…" : "カテゴリを保存"}
      </button>
      {feedback ? <p role="status">{feedback}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
