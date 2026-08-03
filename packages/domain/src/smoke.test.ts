import { describe, expect, it } from "vitest";
import { DOMAIN_SCHEMA_VERSION } from "./index";

describe("domain package", () => {
  it("starts at schema version 2", () => {
    expect(DOMAIN_SCHEMA_VERSION).toBe(2);
  });
});
