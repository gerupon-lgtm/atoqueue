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
});
