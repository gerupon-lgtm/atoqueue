import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import type { DeviceService } from "./device-service.js";

const SubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }).strict(),
}).strict();
const CreateDeviceSchema = z.object({ subscription: SubscriptionSchema }).strict();
const ParamsSchema = z.object({ deviceId: z.string().uuid() }).strict();

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

export function registerDeviceRoutes(app: FastifyInstance, input: { publicPushKey: string; deviceService: DeviceService }): void {
  app.get("/v1/push/public-key", () => ({ publicKey: input.publicPushKey }));

  app.post("/v1/devices", async (request, reply) => {
    const { subscription } = parseOrThrow(CreateDeviceSchema, request.body);
    const response = await input.deviceService.register(subscription);
    return reply.code(201).send(response);
  });

  app.put("/v1/devices/:deviceId/subscription", async (request) => {
    const { deviceId } = parseOrThrow(ParamsSchema, request.params);
    const { subscription } = parseOrThrow(CreateDeviceSchema, request.body);
    return input.deviceService.updateSubscription(deviceId, bearer(request), subscription);
  });

  app.delete("/v1/devices/:deviceId", async (request, reply) => {
    const { deviceId } = parseOrThrow(ParamsSchema, request.params);
    await input.deviceService.deactivate(deviceId, bearer(request));
    return reply.code(204).send();
  });
}
