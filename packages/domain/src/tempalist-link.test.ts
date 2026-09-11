import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { buildTempalistUrl, validateTempalistPayload } from "./tempalist-link";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function validPayload() {
  return {
    schemaVersion: 1,
    kind: "checklist-create",
    source: "atoqueue",
    requestId: REQUEST_ID,
    title: "買い物 🛒",
    items: [
      { sourceTaskId: "milk-1", label: "牛乳🥛\n2本" },
      { sourceTaskId: "milk-2", label: "牛乳🥛\n2本" },
    ],
  };
}

describe("Tempalist checklist-link contract", () => {
  it("F-020 preserves UTF-8, order and opaque IDs without private extras", () => {
    const payload = validPayload();

    const url = buildTempalistUrl(payload);

    expect(new URL(url).search).toBe("");
    expect(
      JSON.parse(
        Buffer.from(url.split("#create=")[1]!, "base64url").toString("utf8"),
      ),
    ).toEqual(payload);
    expect(url.length).toBeLessThanOrEqual(8000);
  });

  it("F-020 lowercases an uppercase UUID while preserving item IDs and text", () => {
    const payload = {
      ...validPayload(),
      requestId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      title: " 買い物 ",
      items: [{ sourceTaskId: " Task-A ", label: " 牛乳\n " }],
    };

    expect(validateTempalistPayload(payload)).toEqual({
      ...payload,
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });

  it.each([
    ["null", null],
    ["array", []],
    ["wrong schemaVersion", { ...validPayload(), schemaVersion: "1" }],
    ["wrong kind", { ...validPayload(), kind: "checklist" }],
    ["wrong source", { ...validPayload(), source: "other" }],
    ["wrong requestId type", { ...validPayload(), requestId: 1 }],
    ["non-v4 requestId", { ...validPayload(), requestId: "not-a-uuid" }],
    ["wrong title type", { ...validPayload(), title: 1 }],
    ["wrong items type", { ...validPayload(), items: "item" }],
    ["empty items", { ...validPayload(), items: [] }],
    [
      "wrong sourceTaskId type",
      { ...validPayload(), items: [{ sourceTaskId: 1, label: "牛乳" }] },
    ],
    [
      "wrong label type",
      { ...validPayload(), items: [{ sourceTaskId: "milk-1", label: 1 }] },
    ],
  ])("F-020 rejects an invalid %s", (_case, value) => {
    expect(() => validateTempalistPayload(value)).toThrow();
  });

  it.each([
    ["requestId", { ...validPayload(), requestId: "   " }],
    ["title", { ...validPayload(), title: "\n\t " }],
    [
      "sourceTaskId",
      { ...validPayload(), items: [{ sourceTaskId: " ", label: "牛乳" }] },
    ],
    [
      "label",
      { ...validPayload(), items: [{ sourceTaskId: "milk-1", label: "\n " }] },
    ],
  ])("F-020 rejects a whitespace-only %s", (_field, value) => {
    expect(() => validateTempalistPayload(value)).toThrow();
  });

  it("F-020 rejects unknown top-level and item fields", () => {
    expect(() =>
      validateTempalistPayload({ ...validPayload(), dueAt: "2026-09-11" }),
    ).toThrow();
    expect(() =>
      validateTempalistPayload({
        ...validPayload(),
        items: [{ sourceTaskId: "milk-1", label: "牛乳", note: "原メモ" }],
      }),
    ).toThrow();
  });

  it("F-020 rejects duplicate opaque item IDs but permits duplicate labels", () => {
    expect(() =>
      validateTempalistPayload({
        ...validPayload(),
        items: [
          { sourceTaskId: "task-1", label: "同じ名前" },
          { sourceTaskId: "task-1", label: "同じ名前" },
        ],
      }),
    ).toThrow();

    expect(
      validateTempalistPayload({
        ...validPayload(),
        items: [
          { sourceTaskId: "task-1", label: "同じ名前" },
          { sourceTaskId: "task-2", label: "同じ名前" },
        ],
      }).items,
    ).toHaveLength(2);
  });

  it("F-020 accepts a completed URL of exactly 8000 characters", () => {
    const url = buildTempalistUrl({
      ...validPayload(),
      title: "x",
      items: [{ sourceTaskId: "id", label: "a".repeat(5799) }],
    });

    expect(url).toHaveLength(8000);
  });

  it("F-020 rejects a completed URL over 8000 characters without truncation", () => {
    expect(() =>
      buildTempalistUrl({
        ...validPayload(),
        title: "x",
        items: [{ sourceTaskId: "id", label: "a".repeat(5800) }],
      }),
    ).toThrow("項目を分けて送ってください。");
  });
});
