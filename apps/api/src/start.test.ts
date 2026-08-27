import { describe, expect, it, vi } from "vitest";
import { API_VERSION, installReminderPoll, startServer } from "./start.js";

it("publishes the release version used by the production entrypoint", () => {
  expect(API_VERSION).toBe("mvp-1.17.1");
});

describe("reminder polling", () => {
  it("dispatches every five minutes, unrefs its timer, and shuts it down", async () => {
    const dispatchDue = vi.fn(async () => undefined);
    const unref = vi.fn();
    const timer = { unref } as unknown as NodeJS.Timeout;
    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue(timer);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const stop = installReminderPoll({ dispatchDue });
    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      5 * 60_000,
    );
    expect(unref).toHaveBeenCalledOnce();
    const callback = setIntervalSpy.mock.calls[0]?.[0] as () => void;
    callback();
    await Promise.resolve();
    expect(dispatchDue).toHaveBeenCalledOnce();
    stop();
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});

describe("notification API startup", () => {
  it("contains interval failures and closes its timer, app, and pool when listen fails", async () => {
    const dispatchDue = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("database unavailable"));
    const recoverStaleClaims = vi.fn(async () => undefined);
    const closeApp = vi.fn(async () => undefined);
    const endPool = vi.fn(async () => undefined);
    const timer = { unref: vi.fn() } as unknown as NodeJS.Timeout;
    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue(timer);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const reportFailure = vi.fn();
    await expect(
      startServer({
        app: {
          listen: async () => {
            throw new Error("listen failed");
          },
          close: closeApp,
        },
        pool: { end: endPool },
        dispatcher: { recoverStaleClaims, dispatchDue },
        port: 3030,
        reportFailure,
      }),
    ).rejects.toThrow("listen failed");
    expect(recoverStaleClaims).toHaveBeenCalledOnce();
    expect(dispatchDue).toHaveBeenCalledOnce();
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
    expect(closeApp).toHaveBeenCalledOnce();
    expect(endPool).toHaveBeenCalledOnce();
    const callback = setIntervalSpy.mock.calls[0]?.[0] as () => void;
    callback();
    await Promise.resolve();
    expect(reportFailure).toHaveBeenCalledWith(expect.any(Error));
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});
