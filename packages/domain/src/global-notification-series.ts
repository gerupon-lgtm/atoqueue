import type { AppSnapshot, Capture } from "./model";

/** Capture that owns a global notification series: newest inbox item, oldest memo. */
export function globalNotificationSeriesAnchor(
  captures: Capture[],
  scope: "inbox" | "memo",
): Capture | undefined {
  const classification = scope === "inbox" ? "unclassified" : "note";
  return captures
    .filter((capture) => capture.classification === classification)
    .sort((left, right) =>
      scope === "inbox"
        ? right.createdAt.localeCompare(left.createdAt)
        : left.createdAt.localeCompare(right.createdAt),
    )[0];
}

/** Local-only identity of the scheduling inputs, independent of outbox delivery. */
export function globalNotificationSeriesKey(snapshot: Pick<AppSnapshot, "captures" | "settings">, scope: "inbox" | "memo"): string | undefined {
  const anchor = globalNotificationSeriesAnchor(snapshot.captures, scope);
  if (!anchor || (scope === "memo" && snapshot.settings.memoReviewFrequency === "none")) return undefined;
  return JSON.stringify(scope === "inbox"
    ? [scope, anchor.createdAt, snapshot.settings.initialReminderDelayMinutes, snapshot.settings.inboxReminderFrequency]
    : [scope, anchor.createdAt, snapshot.settings.memoReviewFrequency]);
}
