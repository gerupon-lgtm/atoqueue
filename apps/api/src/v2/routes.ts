import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ApplicationIdSchema,
  CreateDeviceRequestV2Schema,
  CreateDeviceResponseV2Schema,
  DeviceSubscriptionResponseV2Schema,
  CreateReminderRequestV2Schema,
  ReminderResponseV2Schema,
  PublicPushKeyResponseSchema,
} from "@atoqueue/contracts";
import type { ApplicationRegistry } from "../applications/registry.js";
import type { DeviceRepository } from "../devices/device-repository.js";
import type { ReminderRepository } from "../reminders/reminder-repository.js";
import { DeviceService } from "../devices/device-service.js";
import { ReminderService } from "../reminders/reminder-service.js";
import type { DeviceRateLimiter } from "../plugins/security.js";
import { ApiError } from "../errors/api-error.js";
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApiError(400, "INVALID_REQUEST", "Request validation failed.");
  return result.data;
}
const base = "/v2/apps/:appId";
const appParams = z.object({ appId: ApplicationIdSchema }).strict();
const deviceParams = appParams.extend({ deviceId: z.string().uuid() }).strict();
const reminderParams = appParams
  .extend({ reminderId: z.string().uuid() })
  .strict();
const empty = z.object({}).strict();
const bearer = (r: FastifyRequest) =>
  r.headers.authorization?.startsWith("Bearer ")
    ? r.headers.authorization.slice(7)
    : undefined;
const key = (r: FastifyRequest) =>
  parse(z.string().uuid(), r.headers["idempotency-key"]);
export function registerV2Routes(
  app: FastifyInstance,
  registry: ApplicationRegistry,
  devices: DeviceRepository,
  reminders: ReminderRepository,
  now: () => string,
  limiter: DeviceRateLimiter,
): void {
  const services = (appId: string) => {
    const scoped = {
      consumeDevice: (id: string) => limiter.consumeDevice(`${appId}:${id}`),
    };
    return {
      device: new DeviceService(devices, now, scoped, appId, 2),
      reminder: new ReminderService(devices, reminders, now, scoped, appId, 2),
    };
  };
  app.get(base + "/push/public-key", (request) => {
    const { appId } = parse(appParams, request.params);
    parse(empty, request.query);
    return PublicPushKeyResponseSchema.parse({
      publicKey: registry.get(appId)!.vapidPublicKey,
    });
  });
  app.post(base + "/devices", async (request, reply) => {
    const { appId } = parse(appParams, request.params);
    parse(empty, request.query);
    const { subscription } = parse(CreateDeviceRequestV2Schema, request.body);
    const result = await services(appId).device.register(subscription);
    return reply
      .code(201)
      .send(
        CreateDeviceResponseV2Schema.parse({
          ...result,
          appId,
          protocolVersion: 2,
        }),
      );
  });
  app.put(base + "/devices/:deviceId/subscription", async (request) => {
    const { appId, deviceId } = parse(deviceParams, request.params);
    parse(empty, request.query);
    const { subscription } = parse(CreateDeviceRequestV2Schema, request.body);
    const response = await services(appId).device.updateSubscription(
      deviceId,
      bearer(request),
      subscription,
      key(request),
    );
    return DeviceSubscriptionResponseV2Schema.parse({ ...response, appId });
  });
  app.delete(base + "/devices/:deviceId", async (request, reply) => {
    const { appId, deviceId } = parse(deviceParams, request.params);
    parse(empty, request.query);
    if (request.body !== undefined) parse(empty, request.body);
    await services(appId).device.deactivate(
      deviceId,
      bearer(request),
      key(request),
    );
    return reply.code(204).send();
  });
  app.put(base + "/reminders/:reminderId", async (request, reply) => {
    const { appId, reminderId } = parse(reminderParams, request.params);
    parse(empty, request.query);
    const { notificationKey, ...body } = parse(
      CreateReminderRequestV2Schema,
      request.body,
    );
    const application = registry.get(appId)!;
    if (
      !application.notificationKeys.includes(notificationKey) ||
      !application.routeKeys.includes(body.routeKey)
    )
      throw new ApiError(400, "INVALID_REQUEST", "Request validation failed.");
    const result = await services(appId).reminder.upsert({
      ...body,
      notificationType: notificationKey,
      reminderId,
      bearer: bearer(request),
      idempotencyKey: key(request),
    });
    return reply
      .code(result.created ? 201 : 200)
      .send(ReminderResponseV2Schema.parse(result.response));
  });
  app.delete(base + "/reminders/:reminderId", async (request, reply) => {
    const { appId, reminderId } = parse(reminderParams, request.params);
    const { deviceId } = parse(
      z.object({ deviceId: z.string().uuid() }).strict(),
      request.query,
    );
    if (request.body !== undefined) parse(empty, request.body);
    await services(appId).reminder.cancel({
      deviceId,
      reminderId,
      bearer: bearer(request),
    });
    return reply.code(204).send();
  });
}
