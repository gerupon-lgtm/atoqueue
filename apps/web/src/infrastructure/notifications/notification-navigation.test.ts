import { describe, expect, it, vi } from "vitest";
import { installNotificationNavigation } from "./notification-navigation";

const reminderId = "22222222-2222-4222-8222-222222222222";
const url = `/inbox?reminder=${reminderId}`;

describe("F-015 service worker navigation inside the running app", () => {
  it("acknowledges a validated click after routing and removes its listener on cleanup", async () => {
    const target = new EventTarget();
    let complete!: () => void;
    const navigate = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const handled = vi.fn();
    const stop = installNotificationNavigation(target, navigate);
    const event = new MessageEvent("message", { data: { type: "atoqueue:notification-click", url, reminderId } });
    Object.defineProperty(event, "ports", { value: [{ postMessage: handled }] });
    target.dispatchEvent(event);
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledWith(url);
    expect(handled).not.toHaveBeenCalled();
    complete();
    await vi.waitFor(() => expect(handled).toHaveBeenCalledWith("handled"));
    stop();
    target.dispatchEvent(event);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { type: "other", url, reminderId },
    { type: "atoqueue:notification-click", url: "https://other.example/inbox?reminder=" + reminderId, reminderId },
    { type: "atoqueue:notification-click", url: url + "&body=private", reminderId },
    { type: "atoqueue:notification-click", url, reminderId: "missing" },
  ])("ignores untrusted or malformed message %j", async data => {
    const target = new EventTarget();
    const navigate = vi.fn();
    const stop = installNotificationNavigation(target, navigate);
    target.dispatchEvent(new MessageEvent("message", { data }));
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
    stop();
  });
});
