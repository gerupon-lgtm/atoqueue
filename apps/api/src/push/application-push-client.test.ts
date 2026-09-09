import { expect, it, vi } from "vitest";
import { createECDH } from "node:crypto";
import { ApplicationRegistry } from "../applications/registry.js";
const sendNotification = vi.fn().mockResolvedValue({ statusCode: 201 });
vi.mock("web-push", () => ({ default: { sendNotification } }));
it("F-019 selects independent VAPID credentials on each concurrent send", async () => {
  const { ApplicationPushClient } =
    await import("./application-push-client.js");
  const legacy = {
    publicKey: "legacy-public",
    privateKey: "legacy-private",
    subject: "mailto:legacy@example.com",
  };
  const config = {
    appId: "sample",
    origins: ["https://sample.example"],
    ...(() => {
      const ec = createECDH("prime256v1");
      ec.generateKeys();
      return {
        vapidPublicKey: ec.getPublicKey().toString("base64url"),
        vapidPrivateKey: ec.getPrivateKey().toString("base64url"),
      };
    })(),
    vapidSubject: "mailto:test@example.com",
    notificationKeys: ["review_due"],
    routeKeys: ["review"],
  };
  const client = new ApplicationPushClient(
    legacy,
    new ApplicationRegistry([config]),
  );
  const input = {
    subscription: {
      endpoint: "https://push.example/a",
      p256dh: "p",
      auth: "a",
    },
    payload: {
      type: "review_due" as const,
      reminderId: "id",
      url: "/today",
      groupId: "0123456789abcdef",
    },
  };
  await Promise.all([
    client.send(input),
    client.send({ ...input, appId: "sample" }),
  ]);
  expect(sendNotification.mock.calls[0]?.[2]).toEqual({
    TTL: 86400,
    urgency: "high",
    vapidDetails: legacy,
  });
  expect(sendNotification.mock.calls[1]?.[2]).toEqual({
    TTL: 86400,
    urgency: "high",
    vapidDetails: {
      publicKey: config.vapidPublicKey,
      privateKey: config.vapidPrivateKey,
      subject: config.vapidSubject,
    },
  });
});
