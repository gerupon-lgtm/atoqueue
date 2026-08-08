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

  it("defaults optional listener and logging settings from the API environment contract", () => {
    const config = loadConfig({ ...productionEnvironment, ALLOWED_ORIGIN: PWA_ORIGIN });
    expect(config.port).toBe(3030);
    expect(config.logLevel).toBe("info");
    expect(config.deadlineDeliveryLeadSeconds).toBe(300);
  });

  it("validates listener and logging settings", () => {
    expect(loadConfig({ ...productionEnvironment, ALLOWED_ORIGIN: PWA_ORIGIN, PORT: "3040", LOG_LEVEL: "debug", DEADLINE_DELIVERY_LEAD_SECONDS: "120" }))
      .toMatchObject({ port: 3040, logLevel: "debug", deadlineDeliveryLeadSeconds: 120 });
    expect(() => loadConfig({ ...productionEnvironment, ALLOWED_ORIGIN: PWA_ORIGIN, PORT: "0" })).toThrow();
    expect(() => loadConfig({ ...productionEnvironment, ALLOWED_ORIGIN: PWA_ORIGIN, LOG_LEVEL: "verbose" })).toThrow();
    expect(() => loadConfig({ ...productionEnvironment, ALLOWED_ORIGIN: PWA_ORIGIN, DEADLINE_DELIVERY_LEAD_SECONDS: "-1" })).toThrow();
    expect(() => loadConfig({ ...productionEnvironment, ALLOWED_ORIGIN: PWA_ORIGIN, DEADLINE_DELIVERY_LEAD_SECONDS: "3601" })).toThrow();
  });

  it("requires the confirmed VAPID contact address", () => {
    expect(() => loadConfig({ ...productionEnvironment, ALLOWED_ORIGIN: PWA_ORIGIN, VAPID_SUBJECT: "mailto:other@example.com" })).toThrow();
    expect(loadConfig({ ...productionEnvironment, ALLOWED_ORIGIN: PWA_ORIGIN }).vapidSubject).toBe("mailto:gerupon@gmail.com");
  });
});
