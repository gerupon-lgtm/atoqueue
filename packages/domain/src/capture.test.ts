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
