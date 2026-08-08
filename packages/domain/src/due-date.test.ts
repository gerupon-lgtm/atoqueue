import { describe, expect, it } from "vitest";
import { resolveDueChoice, type LocalCalendar } from "./index";

const now = "2026-03-28T12:34:56.000Z";
const calendar: LocalCalendar = {
  addDays: (date, days) => {
    expect(date).toBe("2026-03-28");
    return { 1: "2026-03-29", 3: "2026-03-31" }[days]!;
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
  nextWeekday: (date, weekday) => {
    expect(date).toBe("2026-03-28");
    expect(weekday).toBe(0);
    return "2026-04-05";
  },
  atTime: (date, hour, minute) => {
    expect(date).toBe("2026-04-05");
    expect(hour).toBe(18);
    expect(minute).toBe(0);
    return "2026-04-05T09:00:00.000Z";
  },
  isAtOrAfter: () => false,
  today: (instant) => {
    expect(instant).toBe(now);
    return "2026-03-28";
  },
};

describe("resolveDueChoice", () => {
  it.each([
    ["today", { type: "today" } as const, "2026-03-28T14:59:00.000Z"],
    ["tomorrow", { type: "tomorrow" } as const, "2026-03-29T14:59:00.000Z"],
    [
      "this Sunday",
      { type: "this_sunday" } as const,
      "2026-04-05T14:59:00.000Z",
    ],
    [
      "custom date",
      { type: "custom", date: "2026-04-01" } as const,
      "2026-04-01T14:59:00.000Z",
    ],
  ])(
    "F-007 resolves %s to local 23:59 through the injected calendar",
    (_, choice, dueAt) => {
      expect(resolveDueChoice({ choice, now, calendar })).toEqual({
        dueMode: "scheduled",
        dueAt,
        nextReviewAt: dueAt,
      });
    },
  );

  it("F-007 stops due prompting but schedules the normal weekly review for an explicit no-due choice", () => {
    expect(
      resolveDueChoice({ choice: { type: "none" }, now, calendar }),
    ).toEqual({
      dueMode: "none",
      nextReviewAt: "2026-04-05T09:00:00.000Z",
    });
  });

  it.each([
    ["Sunday 17:59", "2026-08-09T08:59:00.000Z", "2026-08-09T09:00:00.000Z"],
    ["Sunday 18:00", "2026-08-09T09:00:00.000Z", "2026-08-16T09:00:00.000Z"],
    ["Sunday 18:01", "2026-08-09T09:01:00.000Z", "2026-08-16T09:00:00.000Z"],
  ])(
    "F-007 schedules the next weekly review after %s",
    (_, boundaryNow, expected) => {
      const sundayCalendar: LocalCalendar = {
        addDays: (date, days) => {
          expect(date).toMatch(/2026-08-(09|16)/);
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
        endOfDay: () => "",
        isAtOrAfter: (instant, date, hour, minute) => {
          expect(date).toBe("2026-08-09");
          expect(hour).toBe(18);
          expect(minute).toBe(0);
          return instant >= "2026-08-09T09:00:00.000Z";
        },
        nextSunday: () => "2026-08-09",
        nextWeekday: () => "2026-08-09",
        today: () => "2026-08-09",
      };

      expect(
        resolveDueChoice({
          choice: { type: "none" },
          now: boundaryNow,
          calendar: sundayCalendar,
        }),
      ).toMatchObject({ dueMode: "none", nextReviewAt: expected });
    },
  );

  it("F-007 schedules an undecided due date for three local days later", () => {
    expect(
      resolveDueChoice({ choice: { type: "unset" }, now, calendar }),
    ).toEqual({
      dueMode: "unset",
      nextReviewAt: "2026-03-31T14:59:00.000Z",
    });
  });

  it("F-007 resolves an explicitly selected local deadline time instead of defaulting to the end of the day", () => {
    const timeCalendar: LocalCalendar = {
      ...calendar,
      atTime: (date, hour, minute) => {
        expect(date).toBe("2026-04-01");
        expect(hour).toBe(9);
        expect(minute).toBe(30);
        return "2026-04-01T00:30:00.000Z";
      },
    };

    expect(
      resolveDueChoice({
        choice: { type: "custom", date: "2026-04-01", time: "09:30" },
        now,
        calendar: timeCalendar,
      }),
    ).toEqual({
      dueMode: "scheduled",
      dueAt: "2026-04-01T00:30:00.000Z",
      nextReviewAt: "2026-04-01T00:30:00.000Z",
    });
  });
});
