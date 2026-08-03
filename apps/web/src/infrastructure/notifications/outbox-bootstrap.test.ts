import { describe, expect, it, vi } from "vitest";
import { installOutboxFlush } from "./outbox-bootstrap";

describe("installOutboxFlush", () => {
  it("flushes on application launch and each online event, then removes its listener", async () => {
    const target = new EventTarget();
    const flush = vi.fn().mockResolvedValue(undefined);
    const stop = installOutboxFlush(target, flush);
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(1);

    target.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(2);
    stop();
    target.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
