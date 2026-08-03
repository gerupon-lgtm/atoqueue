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
});
