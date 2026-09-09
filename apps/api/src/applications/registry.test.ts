import { createECDH } from "node:crypto";
import { expect, it } from "vitest";
import { ApplicationRegistry } from "./registry.js";
function validKeys() {
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  return {
    vapidPublicKey: ec.getPublicKey().toString("base64url"),
    vapidPrivateKey: ec.getPrivateKey().toString("base64url"),
  };
}
const entry = () => ({
  appId: "sample",
  origins: ["https://sample.example"],
  ...validKeys(),
  vapidSubject: "mailto:test@example.com",
  notificationKeys: ["review_due"],
  routeKeys: ["review"],
});
it("validates actual canonical P-256 VAPID pairs at startup without exposing them", () => {
  const valid = entry();
  expect(new ApplicationRegistry([valid]).get("sample")).toEqual(valid);
  for (const invalid of [
    { ...valid, vapidPrivateKey: "A".repeat(43) },
    { ...valid, vapidPublicKey: "B".repeat(87) },
    { ...valid, vapidPrivateKey: validKeys().vapidPrivateKey },
    { ...valid, vapidPrivateKey: Buffer.alloc(32, 255).toString("base64url") },
    { ...valid, vapidPublicKey: valid.vapidPublicKey.slice(0, -1) + "B" },
  ]) {
    let failure: unknown;
    try {
      new ApplicationRegistry([invalid]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(invalid.vapidPrivateKey);
    expect(String(failure)).not.toContain(invalid.vapidPublicKey);
  }
});
