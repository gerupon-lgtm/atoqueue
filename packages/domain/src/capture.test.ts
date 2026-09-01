import { describe, expect, it } from "vitest";
import {
  createCapture,
  createEmptySnapshot,
  rebuildGlobalNotificationSchedules,
} from "./index";

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

  // Break caught: preserving the previous inbox series suppresses the newer capture's initial reminder.
  it("moves an unsent inbox initial reminder to the newer capture's configured time", () => {
    let nextId = 0;
    const idFactory = () => `opaque-${++nextId}`;
    const first = createCapture(snapshot(), "first", now, "capture-1", idFactory);
    const synced = { ...first, notificationOutbox: [] };

    const second = createCapture(synced, "second", "2026-08-03T00:30:00.000Z", "capture-2", idFactory);

    expect(second.notificationOutbox.filter((item) => item.operation === "upsert").map((item) => item.scheduledAt)).toEqual([
      "2026-08-03T01:30:00.000Z",
      "2026-08-06T01:30:00.000Z",
      "2026-08-10T01:30:00.000Z",
      "2026-08-17T01:30:00.000Z",
    ]);
    expect(second.notificationOutbox.filter((item) => item.operation === "cancel")).toHaveLength(4);
  });

  it("queues a new initial reminder when another capture is saved after the previous initial was sent", () => {
    let nextId = 0;
    const idFactory = () => `opaque-${++nextId}`;
    const first = createCapture(
      snapshot(),
      "first",
      "2026-08-01T00:00:00.000Z",
      "capture-1",
      idFactory,
    );
    const synced = { ...first, notificationOutbox: [] };
    const second = createCapture(
      synced,
      "second",
      "2026-08-10T00:00:00.000Z",
      "capture-2",
      idFactory,
    );

    expect(second.notificationOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "upsert",
        scheduledAt: "2026-08-10T01:00:00.000Z",
        notificationType: "inbox_review",
      }),
    ]));
  });

  it("keeps one inbox series when captures share the same configured initial time", () => {
    let nextId = 0;
    const idFactory = () => `opaque-${++nextId}`;
    const first = createCapture(snapshot(), "first", now, "capture-1", idFactory);
    const synced = { ...first, notificationOutbox: [] };

    const second = createCapture(synced, "second", now, "capture-2", idFactory);

    expect(second.notificationOutbox).toEqual([]);
    expect(second.reminderMap).toEqual(first.reminderMap);
  });

  it("does not replace a synced memo series when the first unclassified capture is saved", () => {
    let nextId = 0;
    const idFactory = () => `opaque-${++nextId}`;
    const original = snapshot();
    original.captures = [
      {
        id: "note-1",
        body: "memo",
        classification: "note",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ];
    const scheduled = rebuildGlobalNotificationSchedules({
      snapshot: original,
      now: "2026-08-01T00:00:00.000Z",
      createId: idFactory,
    });
    const synced = {
      ...original,
      ...scheduled,
      notificationOutbox: [],
    };
    const memoIds = synced.reminderMap
      .filter((entry) => entry.scope === "memo")
      .map((entry) => entry.reminderId);

    const next = createCapture(
      synced,
      "new inbox item",
      "2026-08-10T00:00:00.000Z",
      "capture-1",
      idFactory,
    );

    expect(next.notificationOutbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "upsert",
          scheduledAt: "2026-08-10T01:00:00.000Z",
        }),
      ]),
    );
    const nextMemoIds = new Set(
      next.reminderMap
        .filter((entry) => entry.scope === "memo")
        .map((entry) => entry.reminderId),
    );
    expect(
      next.notificationOutbox.filter((item) =>
        nextMemoIds.has(item.reminderId),
      ),
    ).toEqual([]);
    expect(
      next.reminderMap
        .filter((entry) => entry.scope === "memo")
        .map((entry) => entry.reminderId),
    ).toEqual(memoIds);
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
