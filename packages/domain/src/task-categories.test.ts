import { describe, expect, it } from "vitest";
import type { Task } from "./model";
import {
  pastTaskCategories,
  suggestTaskCategory,
  taskCategoryUsage,
  validateCustomTaskCategories,
} from "./task-categories";

describe("custom task categories", () => {
  it("trims valid names and keeps their registration order", () => {
    expect(validateCustomTaskCategories([" 経費 ", "冷蔵庫"])).toEqual([
      "経費",
      "冷蔵庫",
    ]);
  });

  it.each([
    [[""], "1文字以上"],
    [["1234567890123"], "12文字以内"],
    [["仕事"], "プリセット"],
    [["経費", "経費"], "登録済み"],
    [Array.from({ length: 11 }, (_, index) => `分類${index}`), "10件まで"],
  ])("rejects invalid names without returning a partial list", (names, message) => {
    expect(() => validateCustomTaskCategories(names)).toThrow(message);
  });

  it("suggests only an exact-script substring and prefers the longest match", () => {
    expect(suggestTaskCategory("冷蔵庫の豆腐", ["冷蔵", "冷蔵庫"])).toBe(
      "冷蔵庫",
    );
    expect(
      suggestTaskCategory("れいぞうこのとうふ", ["冷蔵庫"]),
    ).toBeUndefined();
  });

  it("uses registration order when matching names have the same length", () => {
    expect(suggestTaskCategory("経費精算と家事予定", ["家事", "経費"])).toBe(
      "家事",
    );
  });

  it("counts every matching task and separates active from finished", () => {
    const tasks = [
      task("one", "active", "冷蔵庫"),
      task("two", "active", "冷蔵庫"),
      task("three", "completed", "冷蔵庫"),
      task("four", "archived", "経費"),
    ];
    expect(taskCategoryUsage(tasks, "冷蔵庫")).toEqual({
      total: 3,
      active: 2,
      finished: 1,
    });
  });

  it("derives only used non-preset categories removed from current settings", () => {
    const tasks = [
      task("one", "active", "冷蔵庫"),
      task("two", "completed", "経費"),
      task("three", "archived", "冷蔵庫"),
      task("four", "active", "work"),
    ];
    expect(pastTaskCategories(tasks, ["経費"])).toEqual(["冷蔵庫"]);
  });
});

function task(id: string, status: Task["status"], category: string): Task {
  return {
    id,
    sourceCaptureId: `capture-${id}`,
    title: id,
    category,
    status,
    dueMode: "unset",
    nextReviewAt: "2026-08-11T00:00:00.000Z",
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    revision: 1,
  };
}
