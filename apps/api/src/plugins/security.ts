import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { PWA_ORIGIN } from "../config.js";
import { ApiError } from "../errors/api-error.js";

type RateLimitState = { count: number; windowStartedAt: number };

export function installSecurity(app: FastifyInstance): void {
  void app.register(cors, { origin: PWA_ORIGIN, methods: ["GET", "POST", "PUT", "DELETE"] });
  const limits = new Map<string, RateLimitState>();
  const consume = (key: string, max: number, windowMs: number, reply: { header(name: string, value: number): unknown }) => {
    const now = Date.now();
    const previous = limits.get(key);
    const state = !previous || now - previous.windowStartedAt >= windowMs
      ? { count: 0, windowStartedAt: now }
      : previous;
    state.count += 1;
    limits.set(key, state);
    if (state.count > max) {
      reply.header("Retry-After", Math.max(1, Math.ceil((windowMs - (now - state.windowStartedAt)) / 1000)));
      throw new ApiError(429, "RATE_LIMITED", "Rate limit exceeded.");
    }
  };
  app.addHook("preHandler", async (request, reply) => {
    const route = request.routeOptions.url;
    if (request.method === "POST" && route === "/v1/devices") {
      consume(`registration-ip:${request.ip}`, 10, 60 * 60 * 1000, reply);
      const endpoint = (request.body as { subscription?: { endpoint?: unknown } } | undefined)?.subscription?.endpoint;
      if (typeof endpoint === "string") consume(`registration-endpoint:${endpoint}`, 3, 60 * 60 * 1000, reply);
      return;
    }
    if ((request.method === "PUT" || request.method === "DELETE") && route?.startsWith("/v1/devices/")) {
      const deviceId = (request.params as { deviceId?: unknown }).deviceId;
      if (typeof deviceId === "string") consume(`device:${deviceId}`, 60, 60 * 1000, reply);
    }
  });
}
