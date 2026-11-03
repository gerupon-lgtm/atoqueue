import { describe, expect, it } from "vitest";
import { CorruptDataError, migrateSnapshot } from "./index";
import { makeTempalistFixture } from "./tempalist-test-fixture";
import {
  emptyTempalistState,
  markTempalistOpened,
  prepareTempalistRequest,
  validateTempalistState,
} from "./tempalist-transfer";

describe("F-020 prepared transfer and schema 11", () => {
  it("copies ordered current titles without changing any original state or capturing source text", () => {
    const input = makeTempalistFixture();
    input.draft.tasks.reverse();
    const before = structuredClone(input.snapshot);
    const request = prepareTempalistRequest(input);
    expect(request.payload.items).toEqual(
      input.draft.tasks.map((t) => ({ sourceTaskId: t.id, label: t.title })),
    );
    expect(input.snapshot).toEqual(before);
    expect(JSON.stringify(request)).not.toContain("送信禁止");
    input.draft.tasks[0]!.title = "変更";
    input.snapshot.tasks[0]!.title = "変更";
    expect(request.payload.items[0]!.label).toBe("電池を買う");
  });
  it.each(["title", "revision", "deleted", "empty", "duplicate"])(
    "rejects %s before preparation",
    (reason) => {
      const input = makeTempalistFixture();
      if (reason === "title") input.snapshot.tasks[0]!.title = "更新";
      if (reason === "revision") input.snapshot.tasks[0]!.revision++;
      if (reason === "deleted") input.snapshot.tasks.shift();
      if (reason === "empty") input.draft.tasks = [];
      if (reason === "duplicate") input.draft.tasks.push(input.draft.tasks[0]!);
      expect(() => prepareTempalistRequest(input)).toThrow();
    },
  );
  it("preserves equal titles with distinct IDs and repeated marker acceptance is idempotent", () => {
    const input = makeTempalistFixture();
    input.snapshot.tasks[1]!.title = input.draft.tasks[1]!.title =
      input.snapshot.tasks[0]!.title;
    const request = prepareTempalistRequest(input);
    expect(request.payload.items).toHaveLength(2);
    const state = { lastRequest: request, markers: [] };
    const args = {
      state,
      request,
      existingTaskIds: input.snapshot.tasks.map((t) => t.id),
      now: input.now,
    };
    const marked = markTempalistOpened(args);
    expect(marked.markers.map((m) => m.taskId)).toEqual(args.existingTaskIds);
    expect(markTempalistOpened({ ...args, state: marked })).toEqual(marked);
    expect(state.markers).toEqual([]);
  });
  it("keeps the newer retry request and unrelated markers without resurrecting deleted task markers", () => {
    const input = makeTempalistFixture();
    const request = prepareTempalistRequest(input);
    const newer = prepareTempalistRequest({
      ...input,
      requestId: "22222222-2222-4222-8222-222222222222",
    });
    const marker = {
      taskId: "unrelated",
      requestId: newer.payload.requestId,
      lastOpenedAt: input.now,
    };
    const state = { lastRequest: newer, markers: [marker] };
    const result = markTempalistOpened({
      state,
      request,
      existingTaskIds: ["task-0", "unrelated"],
      now: input.now,
    });
    expect(result.lastRequest).toEqual(newer);
    expect(result.markers).toEqual([
      marker,
      { taskId: "task-0", requestId: input.requestId, lastOpenedAt: input.now },
    ]);
  });
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))(
    "migrates v%i with an empty namespace and ignores unvalidated injected metadata",
    (version) => {
      const { snapshot } = makeTempalistFixture();
      expect(
        migrateSnapshot({
          ...snapshot,
          schemaVersion: version,
          tempalist: { malicious: true },
        }),
      ).toMatchObject({ schemaVersion: 11, tempalist: emptyTempalistState() });
    },
  );
  it("round trips prepared state with no references shared with untrusted input", () => {
    const input = makeTempalistFixture();
    const request = prepareTempalistRequest(input);
    const state = {
      lastRequest: request,
      markers: [
        {
          taskId: "task-0",
          requestId: input.requestId,
          lastOpenedAt: input.now,
        },
      ],
    };
    const result = migrateSnapshot({ ...input.snapshot, tempalist: state });
    expect(result.tempalist).toEqual(state);
    state.lastRequest.payload.items[0]!.label = "改変";
    expect(result.tempalist.lastRequest!.payload.items[0]!.label).toBe(
      "牛乳を買う",
    );
  });
  it.each([
    "missing",
    "url",
    "payload",
    "date",
    "marker-date",
    "marker-id",
    "duplicate",
    "unknown",
  ])("rejects corrupt schema 11 %s", (reason) => {
    const input = makeTempalistFixture();
    const state = {
      lastRequest: prepareTempalistRequest(input),
      markers: [
        {
          taskId: "task-0",
          requestId: input.requestId,
          lastOpenedAt: input.now,
        },
      ],
    };
    if (reason === "url")
      state.lastRequest.url = "https://evil.example/#create=bad";
    if (reason === "payload") state.lastRequest.payload.title = "different";
    if (reason === "date")
      state.lastRequest.preparedAt = "2026-02-30T00:00:00.000Z";
    if (reason === "marker-date") state.markers[0]!.lastOpenedAt = "bad";
    if (reason === "marker-id") state.markers[0]!.requestId = "bad";
    if (reason === "duplicate") state.markers.push(state.markers[0]!);
    if (reason === "unknown") Object.assign(state, { extra: "unexpected" });
    expect(() =>
      migrateSnapshot({
        ...input.snapshot,
        schemaVersion: 11,
        tempalist: reason === "missing" ? undefined : state,
      }),
    ).toThrow(CorruptDataError);
  });
  it("rejects an invalid request passed to marker updates and invalid state directly", () => {
    const input = makeTempalistFixture();
    const request = prepareTempalistRequest(input);
    expect(() =>
      markTempalistOpened({
        state: emptyTempalistState(),
        request: { ...request, url: "bad" },
        existingTaskIds: [],
        now: input.now,
      }),
    ).toThrow();
    expect(() => validateTempalistState(null)).toThrow();
  });
});
