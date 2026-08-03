import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
    requestStartedAt: bigint;
  }
}

export function installRequestContext(app: FastifyInstance): void {
  app.decorateRequest("requestId", "");
  app.decorateRequest("requestStartedAt", 0n);
  app.addHook("onRequest", async (request) => {
    request.requestId = `req_${randomUUID()}`;
    request.requestStartedAt = process.hrtime.bigint();
  });
}
