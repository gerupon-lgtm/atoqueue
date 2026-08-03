import { describe, expect, it } from "vitest";
import { PWA_ORIGIN, loadConfig } from "./config.js";

const productionEnvironment = {
  DATABASE_URL: "postgres://atoqueue_notify_app@localhost/atoqueue_notify",
  VAPID_PUBLIC_KEY: "public-key",
  VAPID_PRIVATE_KEY: "private-key",
  VAPID_SUBJECT: "mailto:gerupon@gmail.com",
};

describe("production API configuration", () => {
  it("requires the exact documented ALLOWED_ORIGIN", () => {
    expect(() => loadConfig(productionEnvironment)).toThrow();
    expect(() => loadConfig({ ...productionEnvironment, ALLOWED_ORIGIN: "https://wrong.example" })).toThrow();
    expect(loadConfig({ ...productionEnvironment, ALLOWED_ORIGIN: PWA_ORIGIN }).allowedOrigin).toBe(PWA_ORIGIN);
  });
});
