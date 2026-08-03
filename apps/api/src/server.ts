import Fastify from "fastify";

export interface BuildAppOptions {
  version: string;
}

export function buildApp({ version }: BuildAppOptions) {
  const app = Fastify();

  app.get("/healthz", () => ({
    status: "ok",
    version,
    time: new Date().toISOString(),
  }));

  return app;
}
