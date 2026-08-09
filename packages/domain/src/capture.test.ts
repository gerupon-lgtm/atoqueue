import { describe, expect, it } from "vitest";
import { createCapture, createEmptySnapshot } from "./index";

const now = "2026-08-03T00:00:00.000Z";

function snapshot() {
  return createEmptySnapshot({
    appVersion: "0.1.0",
    localDeviceId: "device-1",
    timeZone: "Asia/Tokyo",
    now,
  });
}

describe("createCapture", () => {
  it("trims the body and appends an unclassified capture and its history", () => {
    const original = snapshot();

    const next = createCapture(original, "  牛乳を買う  ", now, "capture-1");

    expect(next).toMatchObject({
      captures: [
        {
          id: "capture-1",
          body: "牛乳を買う",
          classification: "unclassified",
          createdAt: now,
          updatedAt: now,
        },
      ],
      actionHistory: [
        {
          entityType: "capture",
          entityId: "capture-1",
          action: "capture_created",
          occurredAt: now,
        },
      ],
      savedAt: now,
    });
  });

  it("F-014 schedules one anonymous inbox reminder when a capture is saved", () => {
    const next = createCapture(snapshot(), "SECRET_CAPTURE_CANARY", now, "capture-1");

    expect(next.reminderMap).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "inbox", kind: "capture_initial" }),
    ]));
    expect(next.notificationOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "upsert",
        scheduledAt: "2026-08-03T01:00:00.000Z",
        notificationType: "inbox_review",
      }),
    ]));
    expect(JSON.stringify(next.notificationOutbox)).not.toContain("SECRET_CAPTURE_CANARY");
    expect(JSON.stringify(next.notificationOutbox)).not.toContain("capture-1");
  });

  // Break caught: a newer capture tears down and recreates an unchanged global inbox series.
  it("keeps the existing global inbox reminder IDs and times when a newer capture is saved", () => {
    let nextId = 0;
    const idFactory = () => `opaque-${++nextId}`;
    const first = createCapture(snapshot(), "first", now, "capture-1", idFactory);
    const before = first.notificationOutbox.map((item) => ({
      reminderId: item.reminderId,
      scheduledAt: item.scheduledAt,
      operation: item.operation,
    }));

    const second = createCapture(first, "second", "2026-08-03T00:30:00.000Z", "capture-2", idFactory);

    expect(second.notificationOutbox.map((item) => ({
      reminderId: item.reminderId,
      scheduledAt: item.scheduledAt,
      operation: item.operation,
    }))).toEqual(before);
  });

  // Break caught: capture creation bypasses the unified rebuild and leaves existing memo scope absent.
  it("rebuilds memo scope as part of capture creation", () => {
    const original = snapshot();
    original.captures = [{ id: "note-1", body: "memo", classification: "note", createdAt: now, updatedAt: now }];

    const next = createCapture(original, "inbox", now, "capture-1");

    expect(next.reminderMap).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "memo" }),
    ]));
    expect(next.notificationOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "upsert", repeatCadence: "weekly" }),
    ]));
  });

  it.each(["", "   ", "\n\t", "a".repeat(281)])(
    "rejects invalid body %j without changing the original snapshot",
    (body) => {
      const original = snapshot();
      const captures = original.captures;
      const history = original.actionHistory;

      expect(() => createCapture(original, body, now, "capture-1")).toThrow();
      expect(original.captures).toBe(captures);
      expect(original.actionHistory).toBe(history);
      expect(original.captures).toEqual([]);
      expect(original.actionHistory).toEqual([]);
    },
  );

  it("returns new arrays without mutating the supplied snapshot", () => {
    const original = snapshot();

    const next = createCapture(original, "メールを返す", now, "capture-1");

    expect(next).not.toBe(original);
    expect(next.captures).not.toBe(original.captures);
    expect(next.actionHistory).not.toBe(original.actionHistory);
    expect(original.captures).toEqual([]);
    expect(original.actionHistory).toEqual([]);
  });
});
