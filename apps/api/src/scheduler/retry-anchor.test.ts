import { createECDH, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { ApplicationRegistry } from "../applications/registry.js";
import { InMemoryReminderRepository } from "../reminders/reminder-repository.js";
import {
  ReminderDispatcher,
  type DeliveryObservation,
} from "./reminder-dispatcher.js";
const ec = createECDH("prime256v1");
ec.generateKeys();
const registry = new ApplicationRegistry([
  {
    appId: "sample",
    origins: ["https://sample.example"],
    vapidPublicKey: ec.getPublicKey().toString("base64url"),
    vapidPrivateKey: Buffer.from(
      ec.getPrivateKey().toString("hex").padStart(64, "0"),
      "hex",
    ).toString("base64url"),
    vapidSubject: "mailto:test@example.com",
    notificationKeys: ["review_due"],
    routeKeys: ["review"],
  },
]);
it.each([
  ["daily", "2026-02-01T12:00:00.000Z"],
  ["weekly", "2026-02-07T12:00:00.000Z"],
  ["monthly", "2026-02-28T12:00:00.000Z"],
] as const)(
  "anchors %s retries and groupId to the planned occurrence",
  async (cadence, next) => {
    const repo = new InMemoryReminderRepository();
    const id = randomUUID();
    let now = "2026-01-31T12:00:00.000Z";
    repo.seedDevice({
      deviceId: "device",
      appId: "sample",
      protocolVersion: 2,
      status: "active",
      subscription: {
        endpoint: "https://push.example/SECRET",
        p256dh: "SECRET",
        auth: "SECRET",
      },
    });
    repo.seed({
      id,
      deviceId: "device",
      scheduledAt: now,
      notificationType: "review_due",
      routeKey: "review",
      repeatCadence: cadence,
      status: "pending",
      attemptCount: 0,
      claimedAt: null,
    });
    const groups: string[] = [];
    const logs: DeliveryObservation[] = [];
    const dispatcher = new ReminderDispatcher(
      repo,
      {
        send: async ({ payload }) => {
          groups.push(payload.groupId);
          return { statusCode: groups.length < 3 ? 503 : 201 };
        },
      },
      () => new Date(now),
      0,
      registry,
      (event) => logs.push(event),
    );
    await dispatcher.dispatchDue();
    expect(repo.get(id)?.repeatAnchorAt).toBe(now);
    now = "2026-01-31T12:05:00.000Z";
    await dispatcher.dispatchDue();
    now = "2026-01-31T12:20:00.000Z";
    await dispatcher.dispatchDue();
    expect(new Set(groups).size).toBe(1);
    expect(repo.get(id)).toMatchObject({
      scheduledAt: next,
      repeatAnchorAt: null,
    });
    expect(logs.map((event) => event.outcome)).toEqual([
      "retry",
      "retry",
      "sent",
    ]);
    expect(
      logs.every(
        (event) =>
          event.appId === "sample" &&
          event.protocolVersion === 2 &&
          event.count === 1,
      ),
    ).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("SECRET");
    expect(JSON.stringify(logs)).not.toContain(id);
  },
);
it("logs bounded mixed-app expiry, terminal failure and raw exceptions anonymously", async () => {
  const repo = new InMemoryReminderRepository();
  const now = "2026-01-31T12:00:00.000Z";
  for (const [deviceId, appId, protocolVersion, attemptCount] of [
    ["expired", "atoqueue", 1, 0],
    ["failure", "sample", 2, 3],
  ] as const) {
    repo.seedDevice({
      deviceId,
      appId,
      protocolVersion,
      status: "active",
      subscription: { endpoint: deviceId, p256dh: "SECRET", auth: "SECRET" },
    });
    repo.seed({
      id: randomUUID(),
      deviceId,
      scheduledAt: now,
      notificationType: "review_due",
      routeKey: "review",
      status: "pending",
      attemptCount,
      claimedAt: null,
    });
  }
  const logs: DeliveryObservation[] = [];
  await new ReminderDispatcher(
    repo,
    {
      send: async ({ subscription }) => {
        if (subscription.endpoint === "expired") return { statusCode: 410 };
        throw new Error("SECRET_RAW_FAILURE");
      },
    },
    () => new Date(now),
    0,
    registry,
    (event) => logs.push(event),
  ).dispatchDue();
  expect(logs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        appId: "atoqueue",
        protocolVersion: 1,
        outcome: "expired",
        errorCode: "push_410",
      }),
      expect.objectContaining({
        appId: "sample",
        protocolVersion: 2,
        outcome: "failed",
        errorCode: "push_error",
        attemptCount: 4,
      }),
    ]),
  );
  expect(JSON.stringify(logs)).not.toContain("SECRET");
});
it("clears a retry anchor on full replacement and protects success from observer failure", async () => {
  const repo = new InMemoryReminderRepository();
  const id = randomUUID();
  const now = "2026-01-31T12:00:00.000Z";
  repo.seedDevice({
    deviceId: "device",
    status: "active",
    subscription: {
      endpoint: "https://push.example/test",
      p256dh: "p",
      auth: "a",
    },
  });
  repo.seed({
    id,
    deviceId: "device",
    scheduledAt: now,
    repeatAnchorAt: "2026-01-30T12:00:00.000Z",
    notificationType: "task_review",
    status: "pending",
    attemptCount: 2,
    claimedAt: null,
  });
  await repo.upsert({
    id,
    deviceId: "device",
    scheduledAt: now,
    notificationType: "task_review",
    repeatCadence: null,
    idempotencyKey: randomUUID(),
    now,
  });
  expect(repo.get(id)?.repeatAnchorAt ?? null).toBeNull();
  await new ReminderDispatcher(
    repo,
    { send: async () => ({ statusCode: 201 }) },
    () => new Date(now),
    0,
    undefined,
    () => {
      throw new Error("LOG_SINK_ERROR");
    },
  ).dispatchDue();
  expect(repo.get(id)?.status).toBe("sent");
});
