/* global URL, process, console */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// F-019 / NF-014: execute real migrations and repository SQL in an owned schema.
// No production connection is accepted; no existing schema is modified.
const connectionString = process.env.ATOQUEUE_TEST_DATABASE_URL;
if (!connectionString)
  throw new Error(
    "Set ATOQUEUE_TEST_DATABASE_URL to a local atoqueue_v2_test database.",
  );
const target = new URL(connectionString);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
assert.equal(target.pathname, "/atoqueue_v2_test");
const requireApi = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const { Pool } = requireApi("pg");
const argon2 = requireApi("argon2");
const webpush = requireApi("web-push");
const schema = `atoqueue_test_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^atoqueue_test_[a-f0-9]{32}$/);
const admin = new Pool({ connectionString });
let pool;
let app;
let schemaCreated = false;
const now = "2026-09-09T12:00:00.000Z";
const oldDeviceId = randomUUID();
const oldReminderId = randomUUID();
const oldSecret = randomUUID();
const logs = [];

try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  pool = new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
    max: 5,
  });
  for (const name of [
    "001_initial",
    "002_recurring_reminders",
    "003_daily_reminders",
  ]) {
    await pool.query(
      await readFile(
        new URL(
          `../../apps/api/src/db/migrations/${name}.sql`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  }
  const oldHash = await argon2.hash(oldSecret, { type: argon2.argon2id });
  await pool.query(
    "INSERT INTO device_subscriptions (id,device_id,endpoint,p256dh,auth,secret_hash,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$7)",
    [
      randomUUID(),
      oldDeviceId,
      "https://push.example/legacy",
      "old-key",
      "old-auth",
      oldHash,
      now,
    ],
  );
  await pool.query(
    "INSERT INTO reminder_jobs (id,device_id,scheduled_at,notification_type,status,idempotency_key,attempt_count,created_at,updated_at) VALUES ($1,$2,$3,'inbox_review','pending',$4,0,$3,$3)",
    [oldReminderId, oldDeviceId, now, randomUUID()],
  );
  const { applyInitialMigration } =
    await import("../../apps/api/dist/db/migrate.js");
  await applyInitialMigration(pool);
  await applyInitialMigration(pool);
  const migrated = (
    await pool.query("SELECT * FROM device_subscriptions WHERE device_id=$1", [
      oldDeviceId,
    ])
  ).rows[0];
  assert.equal(migrated.app_id, "atoqueue");
  assert.equal(migrated.protocol_version, 1);
  assert.equal(migrated.secret_hash, oldHash);
  assert.equal(migrated.endpoint, "https://push.example/legacy");
  assert.equal(
    (
      await pool.query("SELECT route_key FROM reminder_jobs WHERE id=$1", [
        oldReminderId,
      ])
    ).rows[0].route_key,
    null,
  );
  console.log(
    "PASS existing v1 rows, secrets and reservations survive repeatable additive migration",
  );

  const { buildApp } = await import("../../apps/api/dist/server.js");
  const { ApplicationRegistry } =
    await import("../../apps/api/dist/applications/registry.js");
  const { PgDeviceRepository } =
    await import("../../apps/api/dist/devices/device-repository.js");
  const { PgReminderRepository } =
    await import("../../apps/api/dist/reminders/reminder-repository.js");
  const { ReminderDispatcher } =
    await import("../../apps/api/dist/scheduler/reminder-dispatcher.js");
  const configs = ["sample-a", "sample-b"].map((appId) => {
    const keys = webpush.generateVAPIDKeys();
    return {
      appId,
      origins: [`https://${appId}.example`],
      vapidPublicKey: keys.publicKey,
      vapidPrivateKey: keys.privateKey,
      vapidSubject: "mailto:test@example.com",
      notificationKeys: ["review_due"],
      routeKeys: ["review", "home"],
    };
  });
  const applications = new ApplicationRegistry(configs);
  const repository = new PgDeviceRepository(pool);
  const reminders = new PgReminderRepository(pool);
  app = buildApp({
    version: "test",
    applications,
    v2Enabled: true,
    repository,
    reminderRepository: reminders,
    now: () => now,
    logger: { write: (line) => logs.push(line) },
  });
  const call = (appId, method, path, payload, device, key) =>
    app.inject({
      method,
      url: `/v2/apps/${appId}${path}`,
      headers: {
        origin: `https://${appId}.example`,
        ...(device ? { authorization: `Bearer ${device.deviceSecret}` } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(payload === undefined ? {} : { payload }),
    });
  const subscription = (suffix) => ({
    endpoint: `https://push.example/${suffix}`,
    expirationTime: null,
    keys: { p256dh: "test-p256dh", auth: "test-auth" },
  });
  const aResponse = await call("sample-a", "POST", "/devices", {
    subscription: subscription("a"),
  });
  assert.equal(aResponse.statusCode, 201, aResponse.body);
  const a = aResponse.json();
  const bResponse = await call("sample-b", "POST", "/devices", {
    subscription: subscription("b"),
  });
  assert.equal(bResponse.statusCode, 201, bResponse.body);
  const b = bResponse.json();
  const storedA = await repository.findByDeviceId(a.deviceId);
  assert.equal(storedA.appId, "sample-a");
  assert.equal(storedA.protocolVersion, 2);
  assert.ok(await argon2.verify(storedA.secretHash, a.deviceSecret));

  const id = randomUUID();
  const key = randomUUID();
  const body = {
    deviceId: a.deviceId,
    scheduledAt: now,
    notificationKey: "review_due",
    routeKey: "review",
    repeatCadence: "daily",
  };
  const created = await call(
    "sample-a",
    "PUT",
    `/reminders/${id}`,
    body,
    a,
    key,
  );
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(
    (await pool.query("SELECT route_key FROM reminder_jobs WHERE id=$1", [id]))
      .rows[0].route_key,
    "review",
  );
  const replay = await call(
    "sample-a",
    "PUT",
    `/reminders/${id}`,
    body,
    a,
    key,
  );
  assert.equal(replay.statusCode, created.statusCode, replay.body);
  assert.deepEqual(replay.json(), created.json());
  assert.equal(
    (
      await call(
        "sample-a",
        "PUT",
        `/reminders/${id}`,
        { ...body, routeKey: "home" },
        a,
        key,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "sample-b",
        "PUT",
        `/reminders/${id}`,
        { ...body, deviceId: b.deviceId },
        b,
        randomUUID(),
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "sample-b",
        "DELETE",
        `/devices/${a.deviceId}`,
        undefined,
        a,
        randomUUID(),
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "sample-b",
        "DELETE",
        `/reminders/${id}?deviceId=${b.deviceId}`,
        undefined,
        b,
      )
    ).statusCode,
    404,
  );
  const privateCanary = "PRIVATE_TASK_CONTENT_NEVER_STORE";
  assert.equal(
    (
      await call(
        "sample-a",
        "PUT",
        `/reminders/${id}`,
        { ...body, body: privateCanary },
        a,
        randomUUID(),
      )
    ).statusCode,
    400,
  );
  console.log(
    "PASS v2 PostgreSQL registration, route key persistence, replay, conflict and app isolation",
  );

  // Simultaneous claims must never return the same reservation twice.
  const claims = await Promise.all([
    reminders.claimDue(now, 100),
    reminders.claimDue(now, 100),
  ]);
  const claimed = claims.flat();
  assert.equal(claimed.length, 2);
  assert.equal(new Set(claimed.map((job) => job.id)).size, 2);
  const v1Job = claimed.find((job) => job.id === oldReminderId);
  const v2Job = claimed.find((job) => job.id === id);
  assert.equal(v1Job.protocolVersion, 1);
  assert.equal(v2Job.appId, "sample-a");
  assert.equal(v2Job.routeKey, "review");
  await reminders.recoverStaleClaims("2026-09-09T12:16:00.000Z", now);
  const delivered = [];
  const push = {
    send: async (input) => {
      delivered.push(input);
      return { statusCode: 201 };
    },
  };
  await new ReminderDispatcher(
    reminders,
    push,
    () => new Date(now),
    0,
    applications,
  ).dispatchDue();
  assert.equal(delivered.length, 2);
  const oldPayload = delivered.find(
    (input) => input.payload.reminderId === oldReminderId,
  ).payload;
  assert.deepEqual(oldPayload, {
    type: "review_due",
    reminderId: oldReminderId,
    url: `/inbox?reminder=${oldReminderId}`,
    groupId: createHash("sha256")
      .update(`inbox_review\0${now}`)
      .digest("hex")
      .slice(0, 16),
  });
  const newPayload = delivered.find(
    (input) => input.payload.reminderId === id,
  ).payload;
  assert.deepEqual(newPayload, {
    version: 2,
    appId: "sample-a",
    type: "reminder_due",
    reminderId: id,
    notificationKey: "review_due",
    routeKey: "review",
    groupId: createHash("sha256")
      .update(`sample-a\0review_due\0${now}`)
      .digest("hex")
      .slice(0, 16),
  });
  const repeated = (
    await pool.query("SELECT * FROM reminder_jobs WHERE id=$1", [id])
  ).rows[0];
  assert.equal(repeated.scheduled_at, "2026-09-10T12:00:00.000Z");
  assert.equal(repeated.status, "pending");
  assert.equal(
    (
      await call(
        "sample-a",
        "DELETE",
        `/reminders/${id}?deviceId=${a.deviceId}`,
        undefined,
        a,
      )
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await call(
        "sample-a",
        "DELETE",
        `/reminders/${id}?deviceId=${a.deviceId}`,
        undefined,
        a,
      )
    ).statusCode,
    204,
  );
  assert.equal(
    (await pool.query("SELECT status FROM reminder_jobs WHERE id=$1", [id]))
      .rows[0].status,
    "cancelled",
  );
  console.log(
    "PASS concurrent SKIP LOCKED claims, v1/v2 payloads, daily recurrence and idempotent cancellation",
  );

  const updateKey = randomUUID();
  const update = await call(
    "sample-a",
    "PUT",
    `/devices/${a.deviceId}/subscription`,
    { subscription: subscription("a-updated") },
    a,
    updateKey,
  );
  assert.equal(update.statusCode, 200, update.body);
  assert.deepEqual(
    (
      await call(
        "sample-a",
        "PUT",
        `/devices/${a.deviceId}/subscription`,
        { subscription: subscription("a-updated") },
        a,
        updateKey,
      )
    ).json(),
    update.json(),
  );
  const queuedId = randomUUID();
  assert.equal(
    (
      await call(
        "sample-a",
        "PUT",
        `/reminders/${queuedId}`,
        body,
        a,
        randomUUID(),
      )
    ).statusCode,
    201,
  );
  assert.equal(
    (
      await call(
        "sample-a",
        "DELETE",
        `/devices/${a.deviceId}`,
        undefined,
        a,
        randomUUID(),
      )
    ).statusCode,
    204,
  );
  assert.equal(
    (await repository.findByDeviceId(a.deviceId)).status,
    "disabled",
  );
  assert.equal(
    (
      await pool.query("SELECT status FROM reminder_jobs WHERE id=$1", [
        queuedId,
      ])
    ).rows[0].status,
    "cancelled",
  );
  const persisted = [];
  for (const table of [
    "device_subscriptions",
    "reminder_jobs",
    "device_idempotency_operations",
    "reminder_idempotency_operations",
  ])
    persisted.push((await pool.query(`SELECT * FROM ${table}`)).rows);
  assert.ok(!JSON.stringify(persisted).includes(privateCanary));
  assert.ok(!JSON.stringify(persisted).includes(a.deviceSecret));
  assert.ok(!logs.join("\n").includes(privateCanary));
  assert.ok(!logs.join("\n").includes(a.deviceSecret));
  console.log(
    "PASS PostgreSQL subscription replay, atomic device cancellation and privacy canaries",
  );

  const cadenceJobs = [];
  for (const [cadence, expected] of [
    ["daily", "2026-09-10T12:00:00.000Z"],
    ["weekly", "2026-09-16T12:00:00.000Z"],
    ["monthly", "2026-10-09T12:00:00.000Z"],
  ]) {
    const reminderId = randomUUID();
    assert.equal(
      (
        await call(
          "sample-b",
          "PUT",
          `/reminders/${reminderId}`,
          { ...body, deviceId: b.deviceId, repeatCadence: cadence },
          b,
          randomUUID(),
        )
      ).statusCode,
      201,
    );
    cadenceJobs.push({ reminderId, expected });
  }
  const failedPayloads = [];
  await new ReminderDispatcher(
    reminders,
    {
      send: async (input) => {
        failedPayloads.push(input.payload);
        return { statusCode: 503 };
      },
    },
    () => new Date(now),
    0,
    applications,
  ).dispatchDue();
  const retriedPayloads = [];
  await new ReminderDispatcher(
    reminders,
    {
      send: async (input) => {
        retriedPayloads.push(input.payload);
        return { statusCode: 201 };
      },
    },
    () => new Date("2026-09-09T12:05:00.000Z"),
    0,
    applications,
  ).dispatchDue();
  assert.equal(failedPayloads.length, 3);
  assert.equal(retriedPayloads.length, 3);
  for (const job of cadenceJobs) {
    const stored = (
      await pool.query("SELECT * FROM reminder_jobs WHERE id=$1", [
        job.reminderId,
      ])
    ).rows[0];
    assert.equal(stored.scheduled_at, job.expected);
    assert.equal(stored.status, "pending");
    assert.equal(stored.repeat_anchor_at, null);
    assert.equal(
      failedPayloads.find((payload) => payload.reminderId === job.reminderId)
        .groupId,
      retriedPayloads.find((payload) => payload.reminderId === job.reminderId)
        .groupId,
    );
  }
  console.log(
    "PASS actual PostgreSQL retry preserves daily/weekly/monthly occurrence time and notification group",
  );
} finally {
  await app?.close();
  await pool?.end();
  if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
