import { describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));

describe("WebPushClient", () => {
  it("turns the real web-push rejection status into a dispatcher-visible result", async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 410, body: "gone" });
    const { WebPushClient } = await import("./web-push-client.js");
    const client = new WebPushClient({ publicKey: "public", privateKey: "private", subject: "mailto:gerupon@gmail.com" });
    const input = { subscription: { endpoint: "https://push.example/subscription", p256dh: "p", auth: "a" }, payload: { type: "review_due" as const, reminderId: "id", url: "/today?reminder=id", groupId: "0123456789abcdef" } };

    await expect(client.send(input)).resolves.toEqual({ statusCode: 410 });
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: input.subscription.endpoint, keys: { p256dh: "p", auth: "a" } },
      JSON.stringify(input.payload),
      { TTL: 24 * 60 * 60, urgency: "high" },
    );
  });
});
