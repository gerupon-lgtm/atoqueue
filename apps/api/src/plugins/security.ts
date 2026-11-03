import cors from "@fastify/cors";
import type { FastifyCorsOptions } from "@fastify/cors";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError } from "../errors/api-error.js";
import type { ApplicationRegistry } from "../applications/registry.js";

type RateLimitState = { count: number; windowStartedAt: number };

export interface DeviceRateLimiter {
  consumeDevice(deviceId: string): void;
}

export function installSecurity(app: FastifyInstance, allowedOrigin: string, applications?: ApplicationRegistry, v2Enabled = false): DeviceRateLimiter {
  app.addHook("onRequest", async (request) => {
    const match = /^\/v2\/apps\/([^/?]+)/.exec(request.url);
    if (!match) return;
    const application = v2Enabled ? applications?.get(match[1]!) : undefined;
    if (!application) throw new ApiError(404, "APP_NOT_FOUND", "Application not found.");
    if (!request.headers.origin || !application.origins.includes(request.headers.origin)) throw new ApiError(403, "APP_ORIGIN_FORBIDDEN", "Application Origin forbidden.");
  });
  void app.register(cors, () => (request: FastifyRequest, callback: (error: Error | null, options?: FastifyCorsOptions) => void) => {
    const match = /^\/v2\/apps\/([^/?]+)/.exec(request.url);
    const application = match && v2Enabled ? applications?.get(match[1]!) : undefined;
    callback(null, { origin: match ? (application?.origins.includes(request.headers.origin ?? "") ? request.headers.origin! : false) : allowedOrigin, methods: ["GET", "POST", "PUT", "DELETE"], allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"], exposedHeaders: ["Retry-After"] });
  });
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
  app.addHook("preHandler", async (request) => {
    const route = request.routeOptions.url;
    if (request.method === "POST" && (route === "/v1/devices" || route === "/v2/apps/:appId/devices")) {
      const namespace = route === "/v1/devices" ? "atoqueue" : (request.params as { appId: string }).appId;
      consume(`${namespace}:registration-ip:${request.ip}`, 10, 60 * 60 * 1000);
      const endpoint = (request.body as { subscription?: { endpoint?: unknown } } | undefined)?.subscription?.endpoint;
      if (typeof endpoint === "string") consume(`${namespace}:registration-endpoint:${endpoint}`, 3, 60 * 60 * 1000);
    }
  });
  return { consumeDevice: (deviceId) => consume(`device:${deviceId}`, 60, 60 * 1000) };
}
