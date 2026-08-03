import Fastify from "fastify";
import type { Pool } from "pg";
import { loadConfig } from "./config.js";
import { createDatabasePool } from "./db/connection.js";
import { applyInitialMigration } from "./db/migrate.js";
import { ApiError } from "./errors/api-error.js";
import { InMemoryDeviceRepository, PgDeviceRepository, type DeviceRepository } from "./devices/device-repository.js";
import { registerDeviceRoutes } from "./devices/device-routes.js";
import { DeviceService } from "./devices/device-service.js";
import { installRequestContext } from "./plugins/request-context.js";
import { installSecurity } from "./plugins/security.js";

export interface BuildAppOptions {
  version: string;
  publicPushKey?: string;
  repository?: DeviceRepository;
  logger?: { write(line: string): void };
}

export interface ProductionApp {
  app: ReturnType<typeof buildApp>;
  pool: Pool;
}

export function buildApp({ version, publicPushKey = "test-public-key", repository = new InMemoryDeviceRepository(), logger }: BuildAppOptions) {
  const app = Fastify({ bodyLimit: 16 * 1024, logger: false });
  installRequestContext(app);
  installSecurity(app);

  app.addHook("onResponse", async (request, reply) => {
    logger?.write(JSON.stringify({ requestId: request.requestId, method: request.method, statusCode: reply.statusCode }));
  });

  app.setErrorHandler((error, request, reply) => {
    const apiError = error instanceof ApiError
      ? error
      : (error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE"
        ? new ApiError(413, "PAYLOAD_TOO_LARGE", "Payload too large.")
        : new ApiError(500, "INTERNAL_ERROR", "Internal server error.");
    return reply.code(apiError.statusCode).send({
      error: { code: apiError.code, message: apiError.message, requestId: request.requestId, ...(apiError.details ? { details: apiError.details } : {}) },
    });
  });

  app.get("/healthz", () => ({
    status: "ok",
    version,
    time: new Date().toISOString(),
  }));

  registerDeviceRoutes(app, { publicPushKey, deviceService: new DeviceService(repository) });

  return app;
}

/** Parses production-only settings, applies the PostgreSQL schema, then wires the real repository. */
export async function buildProductionApp(input: { version: string; environment?: NodeJS.ProcessEnv }): Promise<ProductionApp> {
  const config = loadConfig(input.environment);
  const pool = createDatabasePool(config);
  await applyInitialMigration(pool);
  return {
    app: buildApp({ version: input.version, publicPushKey: config.vapidPublicKey, repository: new PgDeviceRepository(pool) }),
    pool,
  };
}
