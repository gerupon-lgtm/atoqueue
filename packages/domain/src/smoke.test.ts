import { describe, expect, it } from "vitest";
import { DOMAIN_SCHEMA_VERSION } from "./index";

describe("domain package", () => {
  it("exports the current schema version 11", () => {
    expect(DOMAIN_SCHEMA_VERSION).toBe(11);
  });
});
