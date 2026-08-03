import { createLocalCalendar, type ReviewCalendar } from "../../../../../packages/domain/src";

/** Browser-side adapter that supplies device-local and absolute-time primitives to the domain. */
export function createReviewCalendar(timeZone: string): ReviewCalendar {
  const local = createLocalCalendar(timeZone);
  return {
    ...local,
    addHours(instant, hours) {
      return new Date(Date.parse(instant) + hours * 3_600_000).toISOString();
    },
    compareInstants(left, right) {
      return Math.sign(Date.parse(left) - Date.parse(right));
    },
    elapsedDays(from, to) {
      return dayNumber(local.today(to)) - dayNumber(local.today(from));
    },
  };
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
}
