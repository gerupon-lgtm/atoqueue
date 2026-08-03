import { describe, expect, it } from "vitest";
import { buildApp } from "./server";

describe("GET /healthz", () => {
  it("returns the service status", async () => {
    const app = buildApp({ version: "0.1.0" });
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", version: "0.1.0" });
    await app.close();
  });

  it("checks its injected health dependency before reporting ready", async () => {
    let checks = 0;
    const app = buildApp({
      version: "0.1.0",
      health: { check: async () => { checks += 1; } },
    });
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(checks).toBe(1);
    await app.close();
  });

  it("returns a safe unavailable response when the health dependency fails", async () => {
    const app = buildApp({
      version: "0.1.0",
      health: { check: async () => { throw new Error("postgres://secret@db/internal"); } },
    });
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "unhealthy", version: "0.1.0" });
    expect(response.body).not.toContain("postgres://secret@db/internal");
    await app.close();
  });
});
