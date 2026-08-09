import {
  PRESET_TASK_CATEGORIES,
  pastTaskCategories,
  type AppSnapshot,
} from "../../../../../packages/domain/src";

export interface TaskCategoryOption {
  value: string;
  label: string;
  historical: boolean;
}

export function taskCategoryOptions(
  snapshot: AppSnapshot,
): TaskCategoryOption[] {
  return [
    ...PRESET_TASK_CATEGORIES.map(({ value, label }) => ({
      value,
      label,
      historical: false,
    })),
    ...snapshot.settings.customTaskCategories.map((value) => ({
      value,
      label: value,
      historical: false,
    })),
    ...pastTaskCategories(
      snapshot.tasks,
      snapshot.settings.customTaskCategories,
    ).map((value) => ({
      value,
      label: `${value}（過去）`,
      historical: true,
    })),
  ];
}

export function taskCategoryLabel(category: string): string {
  return (
    PRESET_TASK_CATEGORIES.find(({ value }) => value === category)?.label ??
    category
  );
}
