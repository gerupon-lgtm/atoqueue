import { createECDH } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ApplicationPushClient } from "./application-push-client.js";
import { ApplicationRegistry } from "../applications/registry.js";
import { loadConfig, PWA_ORIGIN } from "../config.js";
const createDatabasePool = vi.fn();
vi.mock("../db/connection.js", () => ({ createDatabasePool }));
const keys = () => {
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  return {
    publicKey: ec.getPublicKey().toString("base64url"),
    privateKey: Buffer.from(
      ec.getPrivateKey().toString("hex").padStart(64, "0"),
      "hex",
    ).toString("base64url"),
  };
};
it("rejects invalid legacy credentials before allocating production resources", async () => {
  const { buildProductionApp } = await import("../server.js");
  const environment = {
    DATABASE_URL: "postgres://unused",
    ALLOWED_ORIGIN: PWA_ORIGIN,
    VAPID_SUBJECT: "mailto:gerupon@gmail.com",
    VAPID_PUBLIC_KEY: "PRIVATE_INVALID_PUBLIC",
    VAPID_PRIVATE_KEY: "PRIVATE_INVALID_SECRET",
  };
  expect(() => loadConfig(environment)).toThrow("Invalid VAPID credentials.");
  await expect(
    buildProductionApp({ version: "test", environment }),
  ).rejects.toThrow("Invalid VAPID credentials.");
  expect(createDatabasePool).not.toHaveBeenCalled();
});
it("validates legacy key pairs and accepts mailto and HTTPS subjects without global state", () => {
  for (const subject of [
    "mailto:owner@example.com",
    "https://example.com/contact",
  ])
    expect(
      () =>
        new ApplicationPushClient(
          { ...keys(), subject },
          new ApplicationRegistry(),
        ),
    ).not.toThrow();
  for (const details of [
    { ...keys(), subject: "http://example.com" },
    { ...keys(), subject: "invalid" },
    {
      ...keys(),
      subject: "mailto:owner@example.com",
      privateKey: "A".repeat(43),
    },
    {
      ...keys(),
      subject: "mailto:owner@example.com",
      publicKey: keys().publicKey,
    },
  ])
    expect(
      () => new ApplicationPushClient(details, new ApplicationRegistry()),
    ).toThrow("Invalid VAPID credentials.");
});
