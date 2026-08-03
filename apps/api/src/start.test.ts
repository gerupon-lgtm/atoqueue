import { describe, expect, it, vi } from "vitest";
import { installReminderPoll } from "./start.js";

describe("reminder polling", () => {
  it("dispatches every five minutes, unrefs its timer, and shuts it down", async () => {
    const dispatchDue = vi.fn(async () => undefined);
    const unref = vi.fn();
    const timer = { unref } as unknown as NodeJS.Timeout;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockReturnValue(timer);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const stop = installReminderPoll({ dispatchDue });
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5 * 60_000);
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
