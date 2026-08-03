export type DueChoice =
  | { type: "today" }
  | { type: "tomorrow" }
  | { type: "this_sunday" }
  | { type: "custom"; date: string }
  | { type: "none" }
  | { type: "unset" };

export interface LocalCalendar {
  today(instant: string): string;
  addDays(date: string, days: number): string;
  nextSunday(date: string): string;
  nextWeekday(date: string, weekday: number): string;
  endOfDay(date: string): string;
  atTime(date: string, hour: number, minute: number): string;
  isAtOrAfter(instant: string, date: string, hour: number, minute: number): boolean;
}

export interface ResolveDueChoiceInput {
  choice: DueChoice;
  now: string;
  calendar: LocalCalendar;
  weeklyReviewDay?: number;
}

export interface DueResolution {
  dueMode: "unset" | "scheduled" | "none";
  dueAt?: string;
  nextReviewAt: string;
}

export function resolveDueChoice(input: ResolveDueChoiceInput): DueResolution {
  const today = input.calendar.today(input.now);

  switch (input.choice.type) {
    case "today":
      return scheduled(input.calendar.endOfDay(today));
    case "tomorrow":
      return scheduled(input.calendar.endOfDay(input.calendar.addDays(today, 1)));
    case "this_sunday":
      return scheduled(input.calendar.endOfDay(input.calendar.nextSunday(today)));
    case "custom":
      return scheduled(input.calendar.endOfDay(input.choice.date));
    case "none":
      {
        const weeklyReviewDate = input.calendar.nextWeekday(
          today,
          input.weeklyReviewDay ?? 0,
        );
        const nextReviewDate = input.calendar.isAtOrAfter(
          input.now,
          weeklyReviewDate,
          18,
          0,
        )
          ? input.calendar.addDays(weeklyReviewDate, 7)
          : weeklyReviewDate;
      return {
        dueMode: "none",
        nextReviewAt: input.calendar.atTime(
          nextReviewDate,
          18,
          0,
        ),
      };
      }
    case "unset":
      return {
        dueMode: "unset",
        nextReviewAt: input.calendar.endOfDay(input.calendar.addDays(today, 3)),
      };
  }
}

export function createLocalCalendar(timeZone: string): LocalCalendar {
  return {
    today(instant) {
      return formatDateParts(new Date(instant), timeZone).date;
    },
    addDays(date, days) {
      const [year, month, day] = parseDate(date);
      const result = new Date(Date.UTC(year, month - 1, day + days));
      return toDateString(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
    },
    nextSunday(date) {
      return this.nextWeekday(date, 0);
    },
    nextWeekday(date, weekday) {
      const [year, month, day] = parseDate(date);
      const weekDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      return this.addDays(date, (weekday - weekDay + 7) % 7);
    },
    endOfDay(date) {
      return localTimeToIso(date, 23, 59, timeZone);
    },
    atTime(date, hour, minute) {
      return localTimeToIso(date, hour, minute, timeZone);
    },
    isAtOrAfter(instant, date, hour, minute) {
      return Date.parse(instant) >= Date.parse(this.atTime(date, hour, minute));
    },
  };
}

function localTimeToIso(date: string, hour: number, minute: number, timeZone: string): string {
  const [year, month, day] = parseDate(date);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = desiredUtc;

  // Resolve the local wall time after the IANA offset at that instant has settled.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    candidate = desiredUtc - offsetAt(new Date(candidate), timeZone);
  }

  return new Date(candidate).toISOString();
}

function scheduled(dueAt: string): DueResolution {
  return { dueMode: "scheduled", dueAt, nextReviewAt: dueAt };
}

function parseDate(value: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("A custom due date must use YYYY-MM-DD.");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error("A custom due date must be a real calendar date.");
  }
  return [year, month, day];
}

function formatDateParts(instant: Date, timeZone: string): {
  date: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  const second = value("second");
  return { date: toDateString(year, month, day), year, month, day, hour, minute, second };
}

function offsetAt(instant: Date, timeZone: string): number {
  const parts = formatDateParts(instant, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant.getTime();
}

function toDateString(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}
