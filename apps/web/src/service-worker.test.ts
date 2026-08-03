import { describe, expect, it, vi } from "vitest";
import { genericNotification, handleNotificationClick, handlePush } from "./service-worker";

describe("service worker notification behavior", () => {
  it("shows the documented generic Japanese notification and rejects task text payloads", async () => {
    const showNotification = vi.fn();
    await handlePush(JSON.stringify({ type: "task_review", reminderId: "22222222-2222-4222-8222-222222222222", url: "/today?reminder=22222222-2222-4222-8222-222222222222", title: "private task" }), showNotification);

    expect(showNotification).toHaveBeenCalledWith(genericNotification.title, expect.objectContaining({ body: genericNotification.body, tag: "atoqueue-review" }));
  });

  it("focuses an existing same-origin client and sends missing reminder links to today", async () => {
    const focus = vi.fn();
    const openWindow = vi.fn();
    await handleNotificationClick({ url: "/today?reminder=22222222-2222-4222-8222-222222222222" }, { matchAll: async () => [{ url: `${window.location.origin}/today`, focus }], openWindow });
    expect(focus).toHaveBeenCalledTimes(1);

    await handleNotificationClick({}, { matchAll: async () => [], openWindow });
    expect(openWindow).toHaveBeenCalledWith("/today");
  });
});
