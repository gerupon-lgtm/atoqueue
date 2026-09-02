import { describe, expect, it } from "vitest";
import { createEmptySnapshot } from "./repository";
import { migrateSnapshot } from "./migrations";
import { nextGlobalRepeatAt, rebuildGlobalNotificationSchedules } from "./notification-queue";

const now = "2026-08-31T10:00:00.000Z";
function fixture(classification: "unclassified" | "note" = "unclassified") {
  const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
  snapshot.settings.notificationEnabled = true;
  snapshot.captures = ["one", "two"].map(id => ({ id, body: "PRIVATE", classification, createdAt: "2026-08-01T10:00:00.000Z", updatedAt: now }));
  return snapshot;
}

describe("F-014 persistent global reminder series", () => {
  it("preserves month-end cadence while skipping expired occurrences", () => {
    expect(nextGlobalRepeatAt("2026-01-31T10:00:00.000Z", "monthly", "2026-03-01T10:00:00.000Z")).toBe("2026-03-28T10:00:00.000Z");
  });
  it("keeps the current series when an older unresolved capture is removed", () => {
    const original = fixture();
    original.captures[1]!.createdAt = "2026-08-27T10:00:00.000Z";
    const queued = rebuildGlobalNotificationSchedules({ snapshot: original, now });
    const next = rebuildGlobalNotificationSchedules({ snapshot: { ...original, ...queued, notificationOutbox: [], captures: original.captures.slice(1) }, now });
    expect(next.notificationOutbox).toEqual([]);
    expect(next.reminderMap).toEqual(queued.reminderMap);
  });
  it.each(["unclassified", "note"] as const)("keeps registered %s reservations after successful outbox removal and reload", classification => {
    const original = fixture(classification);
    const queued = rebuildGlobalNotificationSchedules({ snapshot: original, now });
    const saved = migrateSnapshot(JSON.parse(JSON.stringify({ ...original, ...queued, notificationOutbox: [] })));
    const next = rebuildGlobalNotificationSchedules({ snapshot: saved, now: "2026-09-01T10:00:00.000Z" });
    expect(next.notificationOutbox).toEqual([]);
    expect(next.reminderMap).toEqual(queued.reminderMap);
  });

  it("migrates v9 registered reservations without recreating them or changing user data", () => {
    const original = fixture();
    const legacy = { ...original, schemaVersion: 9, reminderMap: [{ reminderId: "registered", scope: "inbox", kind: "capture_initial", taskRevision: 0, createdAt: now }] };
    const migrated = migrateSnapshot(legacy);
    expect(migrated.schemaVersion).toBe(10);
    expect(migrated.captures).toEqual(original.captures);
    expect(migrated.settings).toEqual(original.settings);
    const next = rebuildGlobalNotificationSchedules({ snapshot: migrated, now: "2026-09-01T10:00:00.000Z" });
    expect(next.notificationOutbox).toEqual([]);
    expect(next.reminderMap.map(entry => entry.reminderId)).toEqual(["registered"]);
  });

  it("cancels a registered series when no owners remain", () => {
    const original = fixture();
    const queued = rebuildGlobalNotificationSchedules({ snapshot: original, now });
    const next = rebuildGlobalNotificationSchedules({ snapshot: { ...original, ...queued, notificationOutbox: [], captures: [] }, now });
    expect(next.notificationOutbox.map(item => item.operation)).toEqual(["cancel"]);
    expect(next.reminderMap).toEqual([]);
  });

  it("changes future timing when the delay changes, but leaves memo reservations intact", () => {
    const original = fixture();
    original.captures.forEach(capture => { capture.createdAt = now; });
    original.captures.push({ id: "memo", body: "PRIVATE NOTE", classification: "note", createdAt: now, updatedAt: now });
    const queued = rebuildGlobalNotificationSchedules({ snapshot: original, now });
    const next = rebuildGlobalNotificationSchedules({ snapshot: { ...original, ...queued, notificationOutbox: [], settings: { ...original.settings, initialReminderDelayMinutes: 120 } }, now });
    expect(next.notificationOutbox.filter(item => item.operation === "upsert")[0]?.scheduledAt).toBe("2026-08-31T12:00:00.000Z");
    expect(next.reminderMap.filter(entry => entry.scope === "memo")).toEqual(queued.reminderMap.filter(entry => entry.scope === "memo"));
  });
});
