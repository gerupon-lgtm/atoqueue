import { describe, expect, it, vi } from "vitest";
import { prepareTempalistRequest } from "../../../../../packages/domain/src";
import { makeTempalistFixture } from "../../../../../packages/domain/src/tempalist-test-fixture";
import { createBrowserTempalistLauncher } from "./browser-tempalist-launcher";

describe("provisional browser Tempalist launcher", () => {
  it("assigns the validated canonical URL only on explicit open", () => {
    const assign = vi.fn();
    const launcher = createBrowserTempalistLauncher({ assign });
    expect(assign).not.toHaveBeenCalled();
    const { url } = prepareTempalistRequest(makeTempalistFixture());
    launcher.open(url);
    expect(assign).toHaveBeenCalledExactlyOnceWith(url);
  });

  it.each([
    "https://example.com/#create=abc",
    "https://tempalist.sikumilab.com.evil.test/#create=abc",
    "https://tempalist.sikumilab.com/?private=1#create=abc",
    "https://tempalist.sikumilab.com/other#create=abc",
    "javascript:alert(1)",
    "https://tempalist.sikumilab.com/#create=abc",
    `https://tempalist.sikumilab.com/#create=${"x".repeat(8000)}`,
  ])("rejects invalid targets without navigation", (url) => {
    const assign = vi.fn();
    expect(() =>
      createBrowserTempalistLauncher({ assign }).open(url),
    ).toThrow();
    expect(assign).not.toHaveBeenCalled();
  });
});
