import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { PWA_ORIGIN } from "../config.js";
import { ApiError } from "../errors/api-error.js";

type RateLimitState = { count: number; windowStartedAt: number };

export function installSecurity(app: FastifyInstance): void {
  void app.register(cors, { origin: PWA_ORIGIN, methods: ["GET", "POST", "PUT", "DELETE"] });
  const limits = new Map<string, RateLimitState>();
  app.addHook("onRequest", async (request, reply) => {
    const isRegistration = request.method === "POST" && request.routeOptions.url === "/v1/devices";
    const max = isRegistration ? 10 : 60;
    const windowMs = isRegistration ? 60 * 60 * 1000 : 60 * 1000;
    const key = `${isRegistration ? "registration" : "device"}:${request.ip}`;
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
  });
}
