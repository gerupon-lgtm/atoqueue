import { describe, expect, it } from "vitest";
import {
  backfillMissingNotifications, createBackup, createCapture, createEmptySnapshot,
  markAsNote, markNoteAsUnneeded, migrateSnapshot, rebuildMemoReviewNotifications,
  restoreBackup, restoreUnneededCapture, updateCaptureBody,
} from "./index";

const createdAt = "2026-08-26T00:00:00.000Z";
const now = "2026-09-13T09:56:52.488Z";
const captureId = "11111111-1111-4111-8111-111111111111";

function fixture() {
  const initial = createEmptySnapshot({ appVersion: "test", localDeviceId: "22222222-2222-4222-8222-222222222222", timeZone: "Asia/Tokyo", now: createdAt });
  initial.settings.notificationEnabled = true;
  const snapshot = createCapture(initial, "古い記録", createdAt, captureId);
  snapshot.notificationOutbox = [];
  return snapshot;
}

describe("F-014 memo classification reminder anchor", () => {
  it("starts the monthly first review 14 days after classification", () => {
    const snapshot = fixture();
    snapshot.settings.memoReviewFrequency = "monthly";
    const next = markAsNote({ snapshot, captureId, now });
    expect(next.notificationOutbox.filter(x => x.operation === "upsert").map(x => x.scheduledAt)).toEqual([
      "2026-09-27T09:56:52.488Z", "2026-10-27T09:56:52.488Z",
    ]);
  });

  it("keeps the existing earlier memo classification as the anchor when an older capture is classified now", () => {
    const snapshot = fixture();
    snapshot.captures.push({ id: "existing", body: "既存メモ", classification: "note", createdAt: "2026-09-10T00:00:00.000Z", classifiedAt: "2026-09-11T00:00:00.000Z", updatedAt: now });
    Object.assign(snapshot, rebuildMemoReviewNotifications({ snapshot, now }));
    snapshot.notificationOutbox = [];
    const prior = structuredClone(snapshot.reminderMap);
    const next = markAsNote({ snapshot, captureId, now });
    expect(next.reminderMap.filter(x => x.scope === "memo")).toEqual(prior.filter(x => x.scope === "memo"));
    expect(next.notificationOutbox.filter(x => x.operation === "upsert")).toEqual([]);
  });

  it("does not move a memo's review date on body edits and starts a new cycle after restore and reclassification", () => {
    let snapshot = markAsNote({ snapshot: fixture(), captureId, now });
    snapshot.notificationOutbox = [];
    snapshot = updateCaptureBody(snapshot, captureId, "編集後", "2026-09-14T00:00:00.000Z");
    expect(backfillMissingNotifications({ snapshot, now: "2026-09-14T00:00:00.000Z" })).toBeUndefined();
    snapshot = markNoteAsUnneeded({ snapshot, captureId, now: "2026-09-14T01:00:00.000Z" });
    snapshot = restoreUnneededCapture({ snapshot, captureId, now: "2026-09-14T02:00:00.000Z" });
    snapshot = markAsNote({ snapshot, captureId, now: "2026-09-15T00:00:00.000Z" });
    expect(snapshot.notificationOutbox.filter(x => x.operation === "upsert")[0]?.scheduledAt).toBe("2026-09-22T00:00:00.000Z");
  });

  it("corrects a legacy creation-based memo series once, preserving IDs and avoiding an immediate replay", () => {
    const snapshot = fixture();
    snapshot.captures[0] = { ...snapshot.captures[0]!, classification: "note", classifiedAt: now };
    snapshot.reminderMap = [{ reminderId: "existing-memo", scope: "memo", kind: "capture_initial", taskRevision: 0, createdAt, seriesKey: JSON.stringify(["memo", createdAt, "weekly"]) }];
    const corrected = backfillMissingNotifications({ snapshot, now: "2026-09-13T10:05:00.000Z" })!;
    expect(corrected.notificationOutbox[0]).toMatchObject({ reminderId: "existing-memo", operation: "upsert", scheduledAt: "2026-09-20T09:56:52.488Z" });
    const saved = { ...snapshot, ...corrected, notificationOutbox: [] };
    expect(backfillMissingNotifications({ snapshot: saved, now: "2026-09-14T00:00:00.000Z" })).toBeUndefined();
  });

  it("retains a legacy note's creation-based series when classifiedAt is absent", () => {
    const snapshot = fixture();
    snapshot.captures[0]!.classification = "note";
    snapshot.reminderMap = [{ reminderId: "legacy-memo", scope: "memo", kind: "capture_initial", taskRevision: 0, createdAt, seriesKey: JSON.stringify(["memo", createdAt, "weekly"]) }];
    expect(backfillMissingNotifications({ snapshot, now })).toBeUndefined();
  });

  it("keeps classification time through a backup round trip", async () => {
    const snapshot = markAsNote({ snapshot: fixture(), captureId, now });
    // Match the repository's save/load boundary before exporting user data.
    const saved = migrateSnapshot(JSON.parse(JSON.stringify(migrateSnapshot(snapshot))));
    // Use the existing backup contract's UUID history fixture. Raw classification
    // event IDs are a pre-existing backup incompatibility, tracked separately.
    saved.actionHistory = saved.actionHistory.map((event, index) => ({ ...event, id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}` }));
    const serialized = await createBackup(saved);
    const restored = await restoreBackup({ current: fixture(), serialized, now });
    expect(restored.captures[0]).toMatchObject({ createdAt, classifiedAt: now });
    expect(restored.notificationOutbox.filter(x => x.operation === "upsert")[0]?.scheduledAt).toBe("2026-09-20T09:56:52.488Z");
  });
});
