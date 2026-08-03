import { describe, expect, it, vi } from "vitest";
import { genericNotification, handleNotificationClick, handlePush } from "./service-worker";

describe("service worker notification behavior", () => {
  it("accepts the real dispatcher payload while retaining only its anonymous reminder context", async () => {
    const showNotification = vi.fn();
    const reminderId = "22222222-2222-4222-8222-222222222222";
    await handlePush(JSON.stringify({ type: "review_due", reminderId, url: `/today?reminder=${reminderId}` }), showNotification);

    expect(showNotification).toHaveBeenCalledWith(genericNotification.title, expect.objectContaining({
      body: genericNotification.body,
      tag: "atoqueue-review",
      data: { url: `/today?reminder=${reminderId}`, reminderId },
    }));
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

  it("rejects extra URL parameters so push data cannot carry task content", async () => {
    const showNotification = vi.fn();
    const reminderId = "22222222-2222-4222-8222-222222222222";
    await handlePush(JSON.stringify({ type: "review_due", reminderId, url: `/today?reminder=${reminderId}&title=private-task` }), showNotification);

    expect(showNotification).toHaveBeenCalledWith(genericNotification.title, expect.objectContaining({ data: { url: "/today" } }));
  });
});
