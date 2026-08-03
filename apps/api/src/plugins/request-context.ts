import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest { requestId: string }
}

export function installRequestContext(app: FastifyInstance): void {
  app.decorateRequest("requestId", "");
  app.addHook("onRequest", async (request) => {
    request.requestId = `req_${randomUUID()}`;
  });
}
