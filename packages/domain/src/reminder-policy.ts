import type { NeglectLevel, Task } from "./model";

/**
 * The only time boundary used by reminder policy. Callers provide it from the
 * device's configured local time zone, which keeps policy evaluation pure.
 */
export interface ReminderCalendar {
  today(instant: string): string;
  addDays(date: string, days: number): string;
  nextSunday(date: string): string;
  atTime(date: string, hour: number, minute: number): string;
  isAtOrAfter(
    instant: string,
    date: string,
    hour: number,
    minute: number,
  ): boolean;
  addHours(instant: string, hours: number): string;
  compareInstants(left: string, right: string): number;
  elapsedDays(from: string, to: string): number;
}

export interface NextReviewInput {
  now: string;
  dueMode: Task["dueMode"];
  undecidedCount: number;
  dismissCount: number;
  calendar: Pick<ReminderCalendar, "today" | "addDays" | "nextSunday" | "atTime" | "isAtOrAfter">;
}

export interface NeglectInput {
  now: string;
  createdAt: string;
  dueMode: Task["dueMode"];
  dueAt?: string;
  nextReviewAt: string;
  undecidedCount: number;
  dismissCount: number;
  postponeCount: number;
  calendar: ReminderCalendar;
}

/**
 * Calculates the next locally scheduled review after an undecided-due prompt
 * or an explicit in-app dismissal. The counts are the values before recording
 * the action that prompted this calculation.
 */
export function calculateNextReview(input: NextReviewInput): string {
  const today = input.calendar.today(input.now);

  if (input.dueMode === "unset") {
    if (input.undecidedCount < 2) {
      return input.calendar.atTime(input.calendar.addDays(today, 3), 18, 0);
    }

    const sunday = input.calendar.nextSunday(today);
    const reviewDate = input.calendar.isAtOrAfter(input.now, sunday, 18, 0)
      ? input.calendar.addDays(sunday, 7)
      : sunday;
    return input.calendar.atTime(reviewDate, 18, 0);
  }

  const daysUntilReview =
    input.dismissCount === 0 ? 1 : input.dismissCount === 1 ? 3 : 7;
  return input.calendar.atTime(
    input.calendar.addDays(today, daysUntilReview),
    18,
    0,
  );
}

/**
 * Returns a derived level only. No derived date or level belongs in storage.
 */
export function calculateNeglectLevel(input: NeglectInput): NeglectLevel {
  let level: NeglectLevel = 0;

  if (
    input.calendar.compareInstants(
      input.createdAt,
      input.calendar.addHours(input.now, -24),
    ) <= 0
  ) {
    level = 1;
  }

  if (input.dueMode === "scheduled" && input.dueAt) {
    const dueComparison = input.calendar.compareInstants(
      input.dueAt,
      input.now,
    );
    if (dueComparison <= 0) {
      level = Math.max(
        level,
        overdueLevel(input.calendar.elapsedDays(input.dueAt, input.now)),
      ) as NeglectLevel;
    } else if (
      input.calendar.today(input.dueAt) === input.calendar.today(input.now)
    ) {
      level = Math.max(level, 1) as NeglectLevel;
    }
  }

  if (input.dueMode === "unset") {
    if (input.undecidedCount >= 2) {
      level = 4;
    } else if (input.undecidedCount === 1) {
      level = Math.max(level, 2) as NeglectLevel;
    } else if (
      input.calendar.compareInstants(input.nextReviewAt, input.now) <= 0
    ) {
      level = Math.max(level, 1) as NeglectLevel;
    }
  }

  if (input.dismissCount >= 2) {
    level = Math.max(level, 3) as NeglectLevel;
  } else if (input.dismissCount === 1) {
    level = Math.max(level, 2) as NeglectLevel;
  }

  if (input.postponeCount >= 3) {
    level = 4;
  }

  return level;
}

function overdueLevel(elapsedDays: number): NeglectLevel {
  if (elapsedDays >= 8) return 4;
  if (elapsedDays >= 4) return 3;
  if (elapsedDays >= 1) return 2;
  return 1;
}
