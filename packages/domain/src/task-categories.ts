import type { Task } from "./model";

export const PRESET_TASK_CATEGORIES = [
  { value: "work", label: "仕事" },
  { value: "home", label: "家" },
  { value: "shopping", label: "買い物" },
  { value: "other", label: "その他" },
] as const;

const presetValues = new Set<string>(
  PRESET_TASK_CATEGORIES.map(({ value }) => value),
);
const presetLabels = new Set<string>(
  PRESET_TASK_CATEGORIES.map(({ label }) => label),
);

export function validateCustomTaskCategories(
  names: readonly string[],
): string[] {
  const normalized = names.map((name) => name.trim());
  if (normalized.length > 10) {
    throw new Error("追加カテゴリは10件までです。");
  }
  const seen = new Set<string>();
  for (const name of normalized) {
    if (name.length === 0) {
      throw new Error("カテゴリ名は1文字以上で入力してください。");
    }
    if ([...name].length > 12) {
      throw new Error("カテゴリ名は12文字以内で入力してください。");
    }
    if (presetLabels.has(name) || presetValues.has(name)) {
      throw new Error("プリセットと同じカテゴリ名は追加できません。");
    }
    if (seen.has(name)) {
      throw new Error("このカテゴリは登録済みです。");
    }
    seen.add(name);
  }
  return normalized;
}

export function suggestTaskCategory(
  body: string,
  customCategories: readonly string[],
): string | undefined {
  return customCategories
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => body.includes(name))
    .sort(
      (left, right) =>
        [...right.name].length - [...left.name].length ||
        left.index - right.index,
    )[0]?.name;
}

export function taskCategoryUsage(
  tasks: readonly Task[],
  category: string,
): { total: number; active: number; finished: number } {
  const matching = tasks.filter((task) => task.category === category);
  const active = matching.filter((task) => task.status === "active").length;
  return { total: matching.length, active, finished: matching.length - active };
}

export function pastTaskCategories(
  tasks: readonly Task[],
  activeCustomCategories: readonly string[],
): string[] {
  const active = new Set(activeCustomCategories);
  return [...new Set(tasks.map(({ category }) => category).filter(isCategory))]
    .filter((category) => !presetValues.has(category) && !active.has(category))
    .sort((left, right) => left.localeCompare(right, "ja-JP"));
}

export function isPresetTaskCategory(category: string): boolean {
  return presetValues.has(category);
}

function isCategory(value: string | undefined): value is string {
  return value !== undefined;
}
