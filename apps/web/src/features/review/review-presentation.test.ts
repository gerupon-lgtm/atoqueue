import { describe, expect, it } from "vitest";
import { createReviewPresentation } from "./review-presentation";

const calendar = {
  addDays: (date: string) => date,
  addHours: (instant: string) => instant,
  atTime: (date: string) => `${date}T23:59:00.000Z`,
  compareInstants: (left: string, right: string) => left.localeCompare(right),
  elapsedDays: () => 3,
  endOfDay: (date: string) => `${date}T23:59:00.000Z`,
  isAtOrAfter: () => false,
  nextSunday: (date: string) => date,
  nextWeekday: (date: string) => date,
  today: (instant: string) => instant.slice(0, 10),
};

describe("createReviewPresentation", () => {
  it("renders the deadline time in the active local time zone", () => {
    const value = createReviewPresentation({
      task: {
        dueMode: "scheduled",
        dueAt: "2026-08-01T23:59:00.000Z",
        nextReviewAt: "2026-08-01T23:59:00.000Z",
      },
      now: "2026-08-03T09:00:00.000Z",
      calendar,
      timeZone: "UTC",
    });

    expect(value).toMatchObject({
      deadline: "期限: 2026/8/1 23:59",
      elapsed: "期限から3日",
    });
  });
});
