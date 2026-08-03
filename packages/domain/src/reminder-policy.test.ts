import { describe, expect, it } from "vitest";
import {
  calculateNeglectLevel,
  calculateNextReview,
  type ReminderCalendar,
} from "./index";

const now = "2026-08-03T03:00:00.000Z";

const calendar: ReminderCalendar = {
  addDays: (date, days) => {
    const dates: Record<string, string> = {
      "2026-08-03:1": "2026-08-04",
      "2026-08-03:3": "2026-08-06",
      "2026-08-03:7": "2026-08-10",
    };
    return dates[`${date}:${days}`]!;
  },
  addHours: (instant, hours) => {
    expect(instant).toBe(now);
    expect(hours).toBe(-24);
    return "2026-08-02T03:00:00.000Z";
  },
  atTime: (date, hour, minute) => {
    expect(hour).toBe(18);
    expect(minute).toBe(0);
    return `${date}T09:00:00.000Z`;
  },
  compareInstants: (left, right) => left.localeCompare(right),
  elapsedDays: (from, to) => {
    const days: Record<string, number> = {
      "2026-08-02T03:00:00.000Z": 1,
      "2026-07-30T03:00:00.000Z": 4,
      "2026-07-26T03:00:00.000Z": 8,
    };
    expect(to).toBe(now);
    return days[from] ?? 0;
  },
  isAtOrAfter: () => false,
  nextSunday: (date) => {
    expect(date).toBe("2026-08-03");
    return "2026-08-09";
  },
  today: (instant) => instant.slice(0, 10),
};

describe("calculateNextReview", () => {
  it.each([
    [
      "unset due without a prior prompt",
      "unset",
      0,
      0,
      "2026-08-06T09:00:00.000Z",
    ],
    ["first unset-due prompt", "unset", 1, 0, "2026-08-06T09:00:00.000Z"],
    ["third unset-due prompt", "unset", 2, 0, "2026-08-09T09:00:00.000Z"],
    ["first dismissal", "scheduled", 0, 0, "2026-08-04T09:00:00.000Z"],
    ["second dismissal", "scheduled", 0, 1, "2026-08-06T09:00:00.000Z"],
    ["third dismissal", "scheduled", 0, 2, "2026-08-10T09:00:00.000Z"],
    ["fourth dismissal", "scheduled", 0, 3, "2026-08-10T09:00:00.000Z"],
  ] as const)(
    "F-008/F-010 schedules %s",
    (_, dueMode, undecidedCount, dismissCount, expected) => {
      expect(
        calculateNextReview({
          now,
          dueMode,
          undecidedCount,
          dismissCount,
          calendar,
        }),
      ).toBe(expected);
    },
  );

  it.each([
    [
      "Sunday 17:59",
      "2026-08-09T08:59:00.000Z",
      false,
      "2026-08-09T09:00:00.000Z",
    ],
    [
      "Sunday 18:00",
      "2026-08-09T09:00:00.000Z",
      true,
      "2026-08-16T09:00:00.000Z",
    ],
    [
      "Sunday 18:01",
      "2026-08-09T09:01:00.000Z",
      true,
      "2026-08-16T09:00:00.000Z",
    ],
  ] as const)(
    "F-008 uses the injected local Sunday boundary after %s",
    (_, sundayNow, afterReviewTime, expected) => {
      const sundayCalendar: ReminderCalendar = {
        ...calendar,
        addDays: (date, days) => {
          expect(date).toBe("2026-08-09");
          expect(days).toBe(7);
          return "2026-08-16";
        },
        atTime: (date, hour, minute) => {
          expect(hour).toBe(18);
          expect(minute).toBe(0);
          return date === "2026-08-09"
            ? "2026-08-09T09:00:00.000Z"
            : "2026-08-16T09:00:00.000Z";
        },
        isAtOrAfter: (instant, date, hour, minute) => {
          expect(instant).toBe(sundayNow);
          expect(date).toBe("2026-08-09");
          expect(hour).toBe(18);
          expect(minute).toBe(0);
          return afterReviewTime;
        },
        nextSunday: () => "2026-08-09",
        today: (instant) => {
          expect(instant).toBe(sundayNow);
          return "2026-08-09";
        },
      };

      expect(
        calculateNextReview({
          now: sundayNow,
          dueMode: "unset",
          undecidedCount: 2,
          dismissCount: 0,
          calendar: sundayCalendar,
        }),
      ).toBe(expected);
    },
  );
});

describe("calculateNeglectLevel", () => {
  const base = {
    now,
    calendar,
    createdAt: "2026-08-02T03:00:00.001Z",
    dueMode: "scheduled" as const,
    dueAt: "2026-08-04T03:00:00.000Z",
    nextReviewAt: "2026-08-04T03:00:00.000Z",
    dismissCount: 0,
    postponeCount: 0,
    undecidedCount: 0,
  };

  it.each([
    ["normal task", {}, 0],
    [
      "exactly 24 hours since creation",
      { createdAt: "2026-08-02T03:00:00.000Z" },
      1,
    ],
    ["due today", { dueAt: "2026-08-03T20:00:00.000Z" }, 1],
    ["overdue for less than one day", { dueAt: "2026-08-03T02:00:00.000Z" }, 1],
    ["one day overdue", { dueAt: "2026-08-02T03:00:00.000Z" }, 2],
    ["four days overdue", { dueAt: "2026-07-30T03:00:00.000Z" }, 3],
    ["eight days overdue", { dueAt: "2026-07-26T03:00:00.000Z" }, 4],
    ["one in-app dismissal", { dismissCount: 1 }, 2],
    ["two in-app dismissals", { dismissCount: 2 }, 3],
    ["four in-app dismissals", { dismissCount: 4 }, 3],
    [
      "second unset-due prompt",
      { dueMode: "unset", dueAt: undefined, undecidedCount: 1 },
      2,
    ],
    [
      "third unset-due prompt",
      { dueMode: "unset", dueAt: undefined, undecidedCount: 2 },
      4,
    ],
    ["sustained postponement", { postponeCount: 3 }, 4],
  ] as const)(
    "F-011 derives the expected level for %s",
    (label, changes, expected) => {
      expect(calculateNeglectLevel({ ...base, ...changes })).toBe(expected);
    },
  );

  it("F-011 treats an unset review whose time has arrived as level 1", () => {
    expect(
      calculateNeglectLevel({
        ...base,
        dueMode: "unset",
        dueAt: undefined,
        nextReviewAt: now,
      }),
    ).toBe(1);
  });
});
