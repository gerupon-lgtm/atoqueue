import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors/api-error.js";

type RateLimitState = { count: number; windowStartedAt: number };

export interface DeviceRateLimiter {
  consumeDevice(deviceId: string): void;
}

export function installSecurity(app: FastifyInstance, allowedOrigin: string): DeviceRateLimiter {
  void app.register(cors, { origin: allowedOrigin, methods: ["GET", "POST", "PUT", "DELETE"] });
  const limits = new Map<string, RateLimitState>();
  const consume = (key: string, max: number, windowMs: number) => {
    const now = Date.now();
    const previous = limits.get(key);
    const state = !previous || now - previous.windowStartedAt >= windowMs
      ? { count: 0, windowStartedAt: now }
      : previous;
    state.count += 1;
    limits.set(key, state);
    if (state.count > max) {
      throw new ApiError(429, "RATE_LIMITED", "Rate limit exceeded.", undefined, Math.max(1, Math.ceil((windowMs - (now - state.windowStartedAt)) / 1000)));
    }
  };
  app.addHook("preHandler", async (request, reply) => {
    const route = request.routeOptions.url;
    if (request.method === "POST" && route === "/v1/devices") {
      consume(`registration-ip:${request.ip}`, 10, 60 * 60 * 1000);
      const endpoint = (request.body as { subscription?: { endpoint?: unknown } } | undefined)?.subscription?.endpoint;
      if (typeof endpoint === "string") consume(`registration-endpoint:${endpoint}`, 3, 60 * 60 * 1000);
    }
  });
  return { consumeDevice: (deviceId) => consume(`device:${deviceId}`, 60, 60 * 1000) };
}
