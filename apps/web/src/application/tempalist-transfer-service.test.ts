import { describe, expect, it, vi } from "vitest";
import { makeTempalistFixture } from "../../../../packages/domain/src/tempalist-test-fixture";
import type { TempalistRepository } from "./tempalist-repository";
import { createTempalistTransferService } from "./tempalist-transfer-service";

function setup(
  environment?: () => "supported" | "ios-browser" | "ios-standalone",
) {
  const fixture = makeTempalistFixture();
  let stored = structuredClone(fixture.snapshot);
  const repository: TempalistRepository = {
    load: async () => structuredClone(stored),
    updateTempalist: vi.fn(async (update) => {
      const state = update(structuredClone(stored));
      stored = { ...stored, tempalist: structuredClone(state) };
      return structuredClone(state);
    }),
  };
  const launch = vi.fn();
  const requestId = vi
    .fn()
    .mockReturnValueOnce(fixture.requestId)
    .mockReturnValue("22222222-2222-4222-8222-222222222222");
  const service = createTempalistTransferService({
    environment,
    repository,
    launcher: { open: launch },
    now: () => fixture.now,
    requestId,
  });
  return {
    ...fixture,
    repository,
    launch,
    requestId,
    service,
    stored: () => stored,
  };
}

describe("Tempalist transfer orchestration (F-020)", () => {
  it("blocks iOS standalone prepare and stored retries before any writes or navigation", async () => {
    let environment: "ios-browser" | "ios-standalone" = "ios-browser";
    const s = setup(() => environment);
    const request = await s.service.prepare(s.draft);
    const before = structuredClone(s.stored());
    environment = "ios-standalone";
    await expect(s.service.prepare(s.draft)).rejects.toThrow(/通常のブラウザ/);
    await expect(s.service.open(request)).rejects.toThrow(/通常のブラウザ/);
    expect(s.stored()).toEqual(before);
    expect(s.launch).not.toHaveBeenCalled();
    environment = "ios-browser";
    await s.service.open(request);
    expect(s.launch).toHaveBeenCalledWith(request.url);
  });
  it("shares only an identical in-flight draft, then issues a fresh ID", async () => {
    const s = setup();
    const first = s.service.prepare(s.draft);
    expect(s.service.prepare(structuredClone(s.draft))).toBe(first);
    const differentTitle = expect(
      s.service.prepare({ ...s.draft, title: "別" }),
    ).rejects.toThrow(/処理中/);
    const differentOrder = expect(
      s.service.prepare({ ...s.draft, tasks: [...s.draft.tasks].reverse() }),
    ).rejects.toThrow(/処理中/);
    await differentTitle;
    await differentOrder;
    const request = await first;
    expect(s.requestId).toHaveBeenCalledTimes(1);
    expect((await s.service.prepare(s.draft)).payload.requestId).not.toBe(
      request.payload.requestId,
    );
  });

  it("compares the frozen selection with latest values inside the update", async () => {
    const s = setup();
    const update = s.repository.updateTempalist;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.repository.updateTempalist = async (callback) => {
      await gate;
      return update(callback);
    };
    const prepared = s.service.prepare(s.draft);
    s.draft.title = "後の入力";
    s.draft.tasks[0].title = "後の入力";
    release();
    expect((await prepared).payload.title).toBe("買い物");
    s.stored().tasks[0].revision++;
    await expect(
      s.service.prepare(makeTempalistFixture().draft),
    ).rejects.toThrow(/変更または削除/);
    s.stored().tasks[0].revision--;
    await expect(
      s.service.prepare(makeTempalistFixture().draft),
    ).resolves.toBeDefined();
  });

  it("persists markers before each launch and leaves all other data unchanged", async () => {
    const s = setup();
    expect(await s.service.lastRequest()).toBeNull();
    const request = await s.service.prepare(s.draft);
    expect(s.stored().tempalist.markers).toEqual([]);
    expect(s.launch).not.toHaveBeenCalled();
    s.launch.mockImplementation(() =>
      expect(s.stored().tempalist.markers).toHaveLength(2),
    );
    await s.service.open(request);
    await s.service.open(request);
    expect(s.launch.mock.calls).toEqual([[request.url], [request.url]]);
    expect(s.stored().tempalist.markers).toHaveLength(2);
    expect({ ...s.stored(), tempalist: s.snapshot.tempalist }).toEqual(
      s.snapshot,
    );
    const restarted = createTempalistTransferService({
      repository: s.repository,
      launcher: { open: s.launch },
      now: () => s.now,
      requestId: s.requestId,
    });
    expect(await restarted.lastRequest()).toEqual(request);
    expect(s.launch).toHaveBeenCalledTimes(2);
  });

  it("freezes open before awaiting storage and preserves a newer lastRequest", async () => {
    const s = setup();
    const request = await s.service.prepare(s.draft);
    const original = structuredClone(request);
    const newer = await s.service.prepare(s.draft);
    const update = s.repository.updateTempalist;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.repository.updateTempalist = async (callback) => {
      await gate;
      return update(callback);
    };
    const opening = s.service.open(request);
    request.url = "https://example.com/";
    request.payload.items[0].label = "modified";
    release();
    await opening;
    expect(s.launch).toHaveBeenCalledWith(original.url);
    expect(await s.service.lastRequest()).toEqual(newer);
  });

  it("rejects tampering before saving and never launches on save failure", async () => {
    const s = setup();
    const request = await s.service.prepare(s.draft);
    const saves = vi.mocked(s.repository.updateTempalist).mock.calls.length;
    await expect(
      s.service.open({ ...request, url: "https://example.com/" }),
    ).rejects.toThrow();
    expect(vi.mocked(s.repository.updateTempalist).mock.calls).toHaveLength(
      saves,
    );
    s.repository.updateTempalist = async () => {
      throw new Error("storage unavailable");
    };
    await expect(s.service.open(request)).rejects.toThrow(
      "storage unavailable",
    );
    expect(s.launch).not.toHaveBeenCalled();
    expect(s.stored().tempalist.markers).toEqual([]);
  });

  it("keeps the accepted marker and safe retry guidance after launch errors", async () => {
    const s = setup();
    const request = await s.service.prepare(s.draft);
    s.launch.mockImplementationOnce(() => {
      throw new Error(request.url);
    });
    await expect(s.service.open(request)).rejects.toThrow(
      "開く操作を完了できませんでした。同じ内容でもう一度開けます",
    );
    expect(s.stored().tempalist.markers).toHaveLength(2);
    await s.service.open(request);
    expect(s.launch.mock.calls).toEqual([[request.url], [request.url]]);
  });
});
