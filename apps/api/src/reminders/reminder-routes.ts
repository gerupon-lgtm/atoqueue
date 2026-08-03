import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { CreateReminderRequestSchema, DeviceIdSchema, ReminderResponseSchema } from "@atoqueue/contracts";
import { ApiError } from "../errors/api-error.js";
import type { ReminderService } from "./reminder-service.js";

const ParamsSchema = z.object({ reminderId: z.string().uuid() }).strict();
function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (parsed.success) return parsed.data; throw new ApiError(400, "INVALID_REQUEST", "Request validation failed.", parsed.error.issues.map((issue) => ({ path: issue.path.join("."), reason: issue.message }))); }
function bearer(request: FastifyRequest): string | undefined { const value = request.headers.authorization; return value?.startsWith("Bearer ") ? value.slice(7) : undefined; }
function idempotencyKey(request: FastifyRequest): string { const key = request.headers["idempotency-key"]; if (typeof key === "string" && key.trim()) return key; throw new ApiError(400, "INVALID_REQUEST", "Request validation failed.", [{ path: "Idempotency-Key", reason: "is required" }]); }

export function registerReminderRoutes(app: FastifyInstance, service: ReminderService): void {
  app.put("/v1/reminders/:reminderId", async (request, reply) => {
    const { reminderId } = parseOrThrow(ParamsSchema, request.params);
    const body = parseOrThrow(CreateReminderRequestSchema, request.body);
    const result = await service.upsert({ ...body, reminderId, bearer: bearer(request), idempotencyKey: idempotencyKey(request) });
    return reply.code(result.created ? 201 : 200).send(ReminderResponseSchema.parse(result.response));
  });
  app.delete("/v1/reminders/:reminderId", async (request, reply) => {
    const { reminderId } = parseOrThrow(ParamsSchema, request.params);
    const deviceId = parseOrThrow(z.object({ deviceId: DeviceIdSchema }).strict(), request.query).deviceId;
    await service.cancel({ deviceId, reminderId, bearer: bearer(request) });
    return reply.code(204).send();
  });
}
