import type { AppSnapshot } from "./model";

/** Local-only identity of the scheduling inputs, independent of outbox delivery. */
export function globalNotificationSeriesKey(snapshot: Pick<AppSnapshot, "captures" | "settings">, scope: "inbox" | "memo"): string | undefined {
  const classification = scope === "inbox" ? "unclassified" : "note";
  const oldest = snapshot.captures.filter(capture => capture.classification === classification)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
  if (!oldest || (scope === "memo" && snapshot.settings.memoReviewFrequency === "none")) return undefined;
  return JSON.stringify(scope === "inbox"
    ? [scope, oldest.createdAt, snapshot.settings.initialReminderDelayMinutes, snapshot.settings.inboxReminderFrequency]
    : [scope, oldest.createdAt, snapshot.settings.memoReviewFrequency]);
}
