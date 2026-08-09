import { describe, expect, it } from "vitest";
import { listCaptures, type Capture } from "./index";

function capture(
  id: string,
  classification: Capture["classification"],
  createdAt: string,
): Capture {
  return {
    id,
    body: id,
    classification,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("listCaptures", () => {
  it("shows every capture classification once in newest-first order", () => {
    const captures = [
      capture("unclassified", "unclassified", "2026-08-09T01:00:00.000Z"),
      capture("task", "task", "2026-08-09T04:00:00.000Z"),
      capture("note", "note", "2026-08-09T02:00:00.000Z"),
      capture("unneeded", "unneeded", "2026-08-09T03:00:00.000Z"),
    ];

    expect(listCaptures(captures, "all").map(({ id }) => id)).toEqual([
      "task",
      "unneeded",
      "note",
      "unclassified",
    ]);
  });

  it("keeps unclassified, note, and unneeded tabs separate", () => {
    const captures = [
      capture("unclassified", "unclassified", "2026-08-09T01:00:00.000Z"),
      capture("task", "task", "2026-08-09T04:00:00.000Z"),
      capture("note", "note", "2026-08-09T02:00:00.000Z"),
      capture("unneeded", "unneeded", "2026-08-09T03:00:00.000Z"),
    ];

    expect(listCaptures(captures, "unclassified").map(({ id }) => id)).toEqual([
      "unclassified",
    ]);
    expect(listCaptures(captures, "note").map(({ id }) => id)).toEqual([
      "note",
    ]);
    expect(listCaptures(captures, "unneeded").map(({ id }) => id)).toEqual([
      "unneeded",
    ]);
  });
});
