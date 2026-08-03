import { describe, expect, it } from "vitest";
import { createReviewCalendar } from "./review-calendar";

describe("createReviewCalendar", () => {
  it("adapts the configured local calendar with absolute-time reminder operations", () => {
    const calendar = createReviewCalendar("Asia/Tokyo");

    expect(calendar.today("2026-08-03T00:00:00.000Z")).toBe("2026-08-03");
    expect(calendar.addHours("2026-08-03T00:00:00.000Z", -24)).toBe("2026-08-02T00:00:00.000Z");
    expect(calendar.compareInstants("2026-08-02T00:00:00.000Z", "2026-08-03T00:00:00.000Z")).toBeLessThan(0);
    expect(calendar.elapsedDays("2026-08-01T00:00:00.000Z", "2026-08-03T00:00:00.000Z")).toBe(2);
  });

  it("counts a local calendar day across the spring DST transition even when it is only 23 hours", () => {
    const calendar = createReviewCalendar("America/New_York");

    expect(calendar.elapsedDays("2026-03-07T17:00:00.000Z", "2026-03-08T16:00:00.000Z")).toBe(1);
  });
});
