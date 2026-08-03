import { describe, expect, it } from "vitest";
import { createCapture, createEmptySnapshot, generateTaskCandidate } from "./index";

describe("generateTaskCandidate", () => {
  it("F-005 transparently suggests an editable title, tomorrow due choice, and shopping category", () => {
    expect(generateTaskCandidate("明日 牛乳を買う")).toEqual({
      title: "牛乳を買う",
      dueChoice: { type: "tomorrow" },
      category: "shopping",
    });
  });

  it.each([
    ["今日 会議資料を提出", { type: "today" }],
    ["今週中に仕事の資料を提出", { type: "this_sunday" }],
  ] as const)("recognizes the exact date expression in %s", (body, dueChoice) => {
    expect(generateTaskCandidate(body)).toMatchObject({ dueChoice, category: "work" });
  });

  it("F-005 does not mutate a capture or create a task", () => {
    const snapshot = createCapture(
      createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now: "2026-08-03T00:00:00.000Z",
      }),
      "今日 牛乳を買う",
      "2026-08-03T00:00:00.000Z",
      "capture-1",
    );

    generateTaskCandidate(snapshot.captures[0]!.body);

    expect(snapshot.captures[0]!.classification).toBe("unclassified");
    expect(snapshot.tasks).toEqual([]);
  });
});
