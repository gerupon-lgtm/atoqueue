import { afterEach, describe, expect, it, vi } from "vitest";
import { genericNotification, handleNotificationClick, handlePush } from "./service-worker";

describe("service worker notification behavior", () => {
  afterEach(() => vi.useRealTimers());
  it("accepts the real dispatcher payload while retaining only its anonymous reminder context", async () => {
    const showNotification = vi.fn();
    const reminderId = "22222222-2222-4222-8222-222222222222";
    await handlePush(JSON.stringify({
      type: "review_due",
      reminderId,
      url: `/today?reminder=${reminderId}`,
      groupId: "0240ed4ae646d5c0",
    }), showNotification);

    expect(showNotification).toHaveBeenCalledWith(genericNotification.title, expect.objectContaining({
      body: genericNotification.body,
      tag: "atoqueue-review-0240ed4ae646d5c0",
      vibrate: [200, 100, 200],
      data: { url: `/today?reminder=${reminderId}`, reminderId },
    }));
    const options = showNotification.mock.calls[0]?.[1];
    expect(options).not.toHaveProperty("silent");
    expect(options).not.toHaveProperty("requireInteraction");
  });

  it("uses one tag for four same-time reminders and a different tag for another delivery group", async () => {
    const tags: string[] = [];
    const showNotification = vi.fn(async (_title: string, options: NotificationOptions) => {
      tags.push(options.tag ?? "");
    });
    for (let index = 1; index <= 4; index += 1) {
      const reminderId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      await handlePush(JSON.stringify({
        type: "review_due",
        reminderId,
        url: `/today?reminder=${reminderId}`,
        groupId: "0240ed4ae646d5c0",
      }), showNotification);
    }
    const deadlineReminderId = "00000000-0000-4000-8000-000000000005";
    await handlePush(JSON.stringify({
      type: "review_due",
      reminderId: deadlineReminderId,
      url: `/today?reminder=${deadlineReminderId}`,
      groupId: "e20e1528e82a602b",
    }), showNotification);

    expect(tags).toEqual([
      "atoqueue-review-0240ed4ae646d5c0",
      "atoqueue-review-0240ed4ae646d5c0",
      "atoqueue-review-0240ed4ae646d5c0",
      "atoqueue-review-0240ed4ae646d5c0",
      "atoqueue-review-e20e1528e82a602b",
    ]);
  });

  it("keeps accepting the deployed three-field payload during service-worker rollout", async () => {
    const showNotification = vi.fn();
    const reminderId = "22222222-2222-4222-8222-222222222222";
    await handlePush(JSON.stringify({
      type: "review_due",
      reminderId,
      url: `/today?reminder=${reminderId}`,
    }), showNotification);

    expect(showNotification).toHaveBeenCalledWith(
      genericNotification.title,
      expect.objectContaining({ tag: "atoqueue-review" }),
    );
  });

  it("focuses an existing same-origin client and sends missing reminder links to today", async () => {
    const focus = vi.fn();
    const openWindow = vi.fn();
    await handleNotificationClick({ url: "/today?reminder=22222222-2222-4222-8222-222222222222", reminderId: "22222222-2222-4222-8222-222222222222" }, { matchAll: async () => [{ url: `${window.location.origin}/today`, focus }], openWindow });
    expect(focus).toHaveBeenCalledTimes(1);

    await handleNotificationClick({}, { matchAll: async () => [], openWindow });
    expect(openWindow).toHaveBeenCalledWith("/today");
  });

  it("does not trust a reminder URL whose reminder ID is missing or mismatched", async () => {
    const openWindow = vi.fn();
    await handleNotificationClick(
      { url: "/today?reminder=22222222-2222-4222-8222-222222222222", reminderId: "33333333-3333-4333-8333-333333333333" },
      { matchAll: async () => [], openWindow },
    );
    expect(openWindow).toHaveBeenCalledWith("/today");
  });

  it("opens the inbox for an anonymous inbox reminder", async () => {
    const openWindow = vi.fn();
    const reminderId = "22222222-2222-4222-8222-222222222222";
    await handleNotificationClick(
      { url: `/inbox?reminder=${reminderId}`, reminderId },
      { matchAll: async () => [], openWindow },
    );
    expect(openWindow).toHaveBeenCalledWith(`/inbox?reminder=${reminderId}`);
  });

  it("F-015 carries the clicked reminder into an already open inbox instead of only focusing it", async () => {
    const reminderId = "22222222-2222-4222-8222-222222222222";
    const url = `/inbox?reminder=${reminderId}`;
    const focus = vi.fn();
    const postMessage = vi.fn((_message: unknown, ports: Transferable[]) => (ports[0] as MessagePort).postMessage("handled"));
    const openWindow = vi.fn();
    await handleNotificationClick({ url, reminderId }, {
      matchAll: async () => [{ url: `${window.location.origin}/inbox`, focus, postMessage }],
      openWindow,
    });
    expect(postMessage).toHaveBeenCalledWith({ type: "atoqueue:notification-click", url, reminderId }, expect.any(Array));
    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("F-015 opens the reminder link if the inbox closes after acknowledging navigation", async () => {
    const reminderId = "22222222-2222-4222-8222-222222222222";
    const url = `/inbox?reminder=${reminderId}`;
    const focus = vi.fn().mockRejectedValue(new Error("window closed"));
    const postMessage = (_message: unknown, ports: Transferable[]) => (ports[0] as MessagePort).postMessage("handled");
    const openWindow = vi.fn();
    await handleNotificationClick({ url, reminderId }, {
      matchAll: async () => [{ url: `${window.location.origin}/inbox`, focus, postMessage }], openWindow,
    });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith(url);
  });

  it("rejects extra URL parameters so push data cannot carry task content", async () => {
    const showNotification = vi.fn();
    const reminderId = "22222222-2222-4222-8222-222222222222";
    await handlePush(JSON.stringify({ type: "review_due", reminderId, url: `/today?reminder=${reminderId}&title=private-task` }), showNotification);

    expect(showNotification).toHaveBeenCalledWith(genericNotification.title, expect.objectContaining({ data: { url: "/today" } }));
  });

  it.each(["closed", "unsupported", "failed"])("F-015 opens the reminder link when an existing inbox is %s", async (reason) => {
    const reminderId = "22222222-2222-4222-8222-222222222222";
    const url = `/inbox?reminder=${reminderId}`;
    const openWindow = vi.fn();
    vi.useFakeTimers();
    const postMessage = reason === "unsupported" ? undefined : () => {
      if (reason === "failed") throw new Error("window closed");
    };
    const clicked = handleNotificationClick({ url, reminderId }, {
      matchAll: async () => [{ url: `${window.location.origin}/inbox`, focus: vi.fn(), postMessage }], openWindow,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await clicked;
    expect(openWindow).toHaveBeenCalledWith(url);
  });
});
