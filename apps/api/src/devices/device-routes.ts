import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CreateDeviceRequestSchema,
  CreateDeviceResponseSchema,
  DeviceIdSchema,
  DeviceSubscriptionResponseSchema,
  PublicPushKeyResponseSchema,
  UpdateDeviceSubscriptionRequestSchema,
} from "@atoqueue/contracts";
import { ApiError } from "../errors/api-error.js";
import type { DeviceService } from "./device-service.js";

const ParamsSchema = z.object({ deviceId: DeviceIdSchema }).strict();

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ApiError(400, "INVALID_REQUEST", "Request validation failed.", result.error.issues.map((issue) => ({
    path: issue.path.join("."), reason: issue.message,
  })));
}

function bearer(request: FastifyRequest): string | undefined {
  const value = request.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : undefined;
}

function idempotencyKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key === "string" && key.trim()) return key;
  throw new ApiError(400, "INVALID_REQUEST", "Request validation failed.", [{ path: "Idempotency-Key", reason: "is required" }]);
}

export function registerDeviceRoutes(app: FastifyInstance, input: { publicPushKey: string; deviceService: DeviceService }): void {
  app.get("/v1/push/public-key", () => PublicPushKeyResponseSchema.parse({ publicKey: input.publicPushKey }));

  app.post("/v1/devices", async (request, reply) => {
    const { subscription } = parseOrThrow(CreateDeviceRequestSchema, request.body);
    const response = await input.deviceService.register(subscription);
    return reply.code(201).send(CreateDeviceResponseSchema.parse(response));
  });

  app.put("/v1/devices/:deviceId/subscription", async (request) => {
    const { deviceId } = parseOrThrow(ParamsSchema, request.params);
    const { subscription } = parseOrThrow(UpdateDeviceSubscriptionRequestSchema, request.body);
    const response = await input.deviceService.updateSubscription(deviceId, bearer(request), subscription, idempotencyKey(request));
    return DeviceSubscriptionResponseSchema.parse(response);
  });

  app.delete("/v1/devices/:deviceId", async (request, reply) => {
    const { deviceId } = parseOrThrow(ParamsSchema, request.params);
    await input.deviceService.deactivate(deviceId, bearer(request), idempotencyKey(request));
    return reply.code(204).send();
  });
}
