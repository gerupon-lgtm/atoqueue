import { describe, expect, it } from "vitest";
import { resolveDueChoice, type LocalCalendar } from "./index";

const now = "2026-03-28T12:34:56.000Z";
const calendar: LocalCalendar = {
  addDays: (date, days) => {
    expect(date).toBe("2026-03-28");
    return ({ 1: "2026-03-29", 3: "2026-03-31" })[days]!;
  },
  endOfDay: (date) =>
    ({
      "2026-03-28": "2026-03-28T14:59:00.000Z",
      "2026-03-29": "2026-03-29T14:59:00.000Z",
      "2026-03-31": "2026-03-31T14:59:00.000Z",
      "2026-04-05": "2026-04-05T14:59:00.000Z",
      "2026-04-01": "2026-04-01T14:59:00.000Z",
    })[date]!,
  nextSunday: (date) => {
    expect(date).toBe("2026-03-28");
    return "2026-04-05";
  },
  today: (instant) => {
    expect(instant).toBe(now);
    return "2026-03-28";
  },
};

describe("resolveDueChoice", () => {
  it.each([
    ["today", { type: "today" } as const, "2026-03-28T14:59:00.000Z"],
    ["tomorrow", { type: "tomorrow" } as const, "2026-03-29T14:59:00.000Z"],
    ["this Sunday", { type: "this_sunday" } as const, "2026-04-05T14:59:00.000Z"],
    ["custom date", { type: "custom", date: "2026-04-01" } as const, "2026-04-01T14:59:00.000Z"],
  ])("F-007 resolves %s to local 23:59 through the injected calendar", (_, choice, dueAt) => {
    expect(resolveDueChoice({ choice, now, calendar })).toEqual({
      dueMode: "scheduled",
      dueAt,
      nextReviewAt: dueAt,
    });
  });

  it("F-007 represents an explicit no-due choice", () => {
    expect(resolveDueChoice({ choice: { type: "none" }, now, calendar })).toEqual({
      dueMode: "none",
      nextReviewAt: now,
    });
  });

  it("F-007 schedules an undecided due date for three local days later", () => {
    expect(resolveDueChoice({ choice: { type: "unset" }, now, calendar })).toEqual({
      dueMode: "unset",
      nextReviewAt: "2026-03-31T14:59:00.000Z",
    });
  });
});
