import { createHash } from "node:crypto";
import Fastify from "fastify";
import type { Pool } from "pg";
import pino from "pino";
import { loadConfig, PWA_ORIGIN } from "./config.js";
import { createDatabasePool } from "./db/connection.js";
import { applyInitialMigration } from "./db/migrate.js";
import { ApiError } from "./errors/api-error.js";
import { InMemoryDeviceRepository, PgDeviceRepository, type DeviceRepository } from "./devices/device-repository.js";
import { registerDeviceRoutes } from "./devices/device-routes.js";
import { DeviceService } from "./devices/device-service.js";
import { InMemoryReminderRepository, PgReminderRepository, type ReminderRepository } from "./reminders/reminder-repository.js";
import { registerReminderRoutes } from "./reminders/reminder-routes.js";
import { ReminderService } from "./reminders/reminder-service.js";
import { installRequestContext } from "./plugins/request-context.js";
import { installSecurity } from "./plugins/security.js";

export interface BuildAppOptions {
  version: string;
  publicPushKey?: string;
  repository?: DeviceRepository;
  reminderRepository?: ReminderRepository;
  logger?: { write(line: string): void };
  allowedOrigin?: string;
  health?: HealthPort;
  now?: () => string;
}

export interface HealthPort {
  check(): Promise<void>;
}

export interface ProductionApp {
  app: ReturnType<typeof buildApp>;
  pool: Pool;
}

export function buildApp({ version, publicPushKey = "test-public-key", repository = new InMemoryDeviceRepository(), reminderRepository = new InMemoryReminderRepository(), logger, allowedOrigin = PWA_ORIGIN, health = { check: async () => undefined }, now = () => new Date().toISOString() }: BuildAppOptions) {
  const app = Fastify({ bodyLimit: 16 * 1024, logger: false, trustProxy: ["127.0.0.1", "::1"] });
  installRequestContext(app);
  const deviceRateLimiter = installSecurity(app, allowedOrigin);

  app.addHook("onResponse", async (request, reply) => {
    const durationMs = Number(process.hrtime.bigint() - request.requestStartedAt) / 1_000_000;
    logger?.write(JSON.stringify({
      requestId: request.requestId,
      endpointHashPrefix: endpointHashPrefix(request.body),
      resultCode: reply.statusCode,
      durationMs,
    }));
  });

  app.setErrorHandler((error, request, reply) => {
    const apiError = error instanceof ApiError
      ? error
      : (error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE"
        ? new ApiError(413, "PAYLOAD_TOO_LARGE", "Payload too large.")
        : (error as { code?: string }).code?.startsWith("FST_ERR_CTP_")
          ? new ApiError(400, "INVALID_REQUEST", "Request validation failed.")
        : new ApiError(500, "INTERNAL_ERROR", "Internal server error.");
    if (apiError.retryAfter) reply.header("Retry-After", apiError.retryAfter);
    return reply.code(apiError.statusCode).send({
      error: { code: apiError.code, message: apiError.message, requestId: request.requestId, ...(apiError.details ? { details: apiError.details } : {}) },
    });
  });

  app.get("/healthz", async (_request, reply) => {
    try {
      await health.check();
      return { status: "ok", version, time: new Date().toISOString() };
    } catch {
      return reply.code(503).send({ status: "unhealthy", version, time: new Date().toISOString() });
    }
  });

  registerDeviceRoutes(app, { publicPushKey, deviceService: new DeviceService(repository, undefined, deviceRateLimiter) });
  registerReminderRoutes(app, new ReminderService(repository, reminderRepository, now, deviceRateLimiter));

  return app;
}

function endpointHashPrefix(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const subscription = (body as { subscription?: unknown }).subscription;
  if (!subscription || typeof subscription !== "object") return undefined;
  const endpoint = (subscription as { endpoint?: unknown }).endpoint;
  if (typeof endpoint !== "string") return undefined;
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 12);
}

/** Parses production-only settings, applies the PostgreSQL schema, then wires the real repository. */
export async function buildProductionApp(input: { version: string; environment?: NodeJS.ProcessEnv }): Promise<ProductionApp> {
  const config = loadConfig(input.environment);
  const pool = createDatabasePool(config);
  await applyInitialMigration(pool);
  const productionLogger = pino({ level: config.logLevel, base: undefined });
  return {
    app: buildApp({
      version: input.version,
      publicPushKey: config.vapidPublicKey,
      repository: new PgDeviceRepository(pool),
      reminderRepository: new PgReminderRepository(pool),
      allowedOrigin: config.allowedOrigin,
      logger: { write: (line) => productionLogger.info(JSON.parse(line)) },
      health: { check: async () => { await pool.query("SELECT 1"); } },
    }),
    pool,
  };
}
