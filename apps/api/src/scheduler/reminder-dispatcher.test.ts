import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryReminderRepository } from "../reminders/reminder-repository.js";
import { ReminderDispatcher } from "./reminder-dispatcher.js";
import type { PushClient } from "../push/push-client.js";

const now = new Date("2026-08-06T09:00:00.000Z");
const pushSubscription = { endpoint: "https://push.example/subscription", p256dh: "private-p256dh", auth: "private-auth" };

function seed(repository: InMemoryReminderRepository, input: Partial<{ id: string; scheduledAt: string; status: "pending" | "claimed" | "cancelled"; attemptCount: number; claimedAt: string | null; notificationType: "inbox_review" | "task_review" }> = {}) {
  const id = input.id ?? randomUUID();
  repository.seedDevice({ deviceId: "device-1", status: "active", subscription: pushSubscription });
  repository.seed({ id, deviceId: "device-1", scheduledAt: input.scheduledAt ?? "2026-08-06T08:59:00.000Z", notificationType: input.notificationType ?? "task_review", status: input.status ?? "pending", attemptCount: input.attemptCount ?? 0, claimedAt: input.claimedAt ?? null });
  return id;
}

function client(result: number | Error, sends: unknown[] = []): PushClient {
  return { send: async (input) => { sends.push(input); if (result instanceof Error) throw result; return { statusCode: result }; } };
}

describe("ReminderDispatcher", () => {
  it("claims no more than 100 due pending jobs and never sends future or cancelled jobs", async () => {
    const repository = new InMemoryReminderRepository();
    for (let index = 0; index < 102; index += 1) seed(repository, { id: randomUUID() });
    seed(repository, { scheduledAt: "2026-08-06T09:01:00.000Z" });
    seed(repository, { status: "cancelled" });
    const sends: unknown[] = [];
    await new ReminderDispatcher(repository, client(201, sends), () => now).dispatchDue();
    expect(sends).toHaveLength(100);
  });

  it("claims a deadline reservation up to the configured delivery lead time without claiming jobs beyond that window", async () => {
    const repository = new InMemoryReminderRepository();
    const withinLead = seed(repository, { scheduledAt: "2026-08-06T09:04:59.000Z" });
    const outsideLead = seed(repository, { scheduledAt: "2026-08-06T09:05:01.000Z" });
    const sends: unknown[] = [];

    await new ReminderDispatcher(repository, client(201, sends), () => now, 300).dispatchDue();

    expect(repository.get(withinLead)?.status).toBe("sent");
    expect(repository.get(outsideLead)?.status).toBe("pending");
    expect(sends).toHaveLength(1);
  });

  it("marks a successful generic send as sent and never includes task data", async () => {
    const repository = new InMemoryReminderRepository();
    const id = seed(repository, { scheduledAt: "2026-08-06T08:39:00.000Z" });
    const sends: Array<{ payload: Record<string, unknown> }> = [];
    await new ReminderDispatcher(repository, client(201, sends), () => now).dispatchDue();
    expect(repository.get(id)).toMatchObject({ status: "sent" });
    expect(sends[0].payload).toEqual({ type: "review_due", reminderId: id, url: `/today?reminder=${id}` });
    expect(JSON.stringify(sends[0].payload)).not.toContain("SECRET_TASK_CANARY");
  });

  it("sends an inbox reservation to the inbox without private capture data", async () => {
    const repository = new InMemoryReminderRepository();
    const id = seed(repository, { notificationType: "inbox_review" });
    const sends: Array<{ payload: Record<string, unknown> }> = [];
    await new ReminderDispatcher(repository, client(201, sends), () => now).dispatchDue();

    expect(sends[0]?.payload).toEqual({ type: "review_due", reminderId: id, url: `/inbox?reminder=${id}` });
    expect(JSON.stringify(sends[0]?.payload)).not.toContain("SECRET_CAPTURE_CANARY");
  });

  it.each([[0, 5], [1, 15], [2, 60]])("reschedules temporary failure %s after %s minutes", async (attemptCount, minutes) => {
    const repository = new InMemoryReminderRepository();
    const id = seed(repository, { attemptCount });
    await new ReminderDispatcher(repository, client(new Error("temporary")), () => now).dispatchDue();
    expect(repository.get(id)).toMatchObject({ status: "pending", attemptCount: attemptCount + 1, scheduledAt: new Date(now.getTime() + minutes * 60_000).toISOString() });
  });

  it("marks the job failed after the third temporary failure", async () => {
    const repository = new InMemoryReminderRepository();
    const id = seed(repository, { attemptCount: 3 });
    await new ReminderDispatcher(repository, client(new Error("temporary")), () => now).dispatchDue();
    expect(repository.get(id)).toMatchObject({ status: "failed", attemptCount: 4 });
  });

  it("disables a 404 subscription and fails its pending jobs", async () => {
    const repository = new InMemoryReminderRepository();
    const id = seed(repository);
    await new ReminderDispatcher(repository, client(410), () => now).dispatchDue();
    expect(repository.device("device-1")?.status).toBe("disabled");
    expect(repository.get(id)?.status).toBe("failed");
  });

  it("recovers claims older than fifteen minutes and never double-sends a concurrent claim", async () => {
    const repository = new InMemoryReminderRepository();
    const stale = seed(repository, { status: "claimed", claimedAt: "2026-08-06T08:44:59.000Z" });
    const due = seed(repository);
    const sends: unknown[] = [];
    const dispatcher = new ReminderDispatcher(repository, client(201, sends), () => now);
    await dispatcher.recoverStaleClaims();
    expect(repository.get(stale)?.status).toBe("pending");
    await Promise.all([dispatcher.dispatchDue(), dispatcher.dispatchDue()]);
    expect(sends.filter((item) => (item as { payload: { reminderId: string } }).payload.reminderId === due)).toHaveLength(1);
  });

  it("does not let a stale worker settle a newer claim after stale recovery", async () => {
    const repository = new InMemoryReminderRepository();
    const id = seed(repository, { scheduledAt: "2026-08-06T08:39:00.000Z" });
    const [firstClaim] = await repository.claimDue("2026-08-06T08:40:00.000Z", 1);
    await repository.recoverStaleClaims("2026-08-06T08:45:00.000Z", "2026-08-06T09:00:00.000Z");
    const [secondClaim] = await repository.claimDue("2026-08-06T09:00:00.000Z", 1);
    await repository.markSent(id, firstClaim!.claimedAt!, "2026-08-06T09:00:01.000Z");
    expect(repository.get(id)).toMatchObject({ status: "claimed", claimedAt: secondClaim!.claimedAt });
    await repository.markSent(id, secondClaim!.claimedAt!, "2026-08-06T09:00:02.000Z");
    expect(repository.get(id)).toMatchObject({ status: "sent" });
  });
});
