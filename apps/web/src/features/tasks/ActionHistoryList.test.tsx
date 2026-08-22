// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActionHistoryList } from "./ActionHistoryList";

describe("ActionHistoryList", () => {
  it("shows event times in the configured device time zone without UTC seconds", () => {
    render(
      <ActionHistoryList
        events={[
          {
            id: "event-1",
            entityType: "task",
            entityId: "task-1",
            action: "task_created",
            occurredAt: "2026-08-08T13:30:27.501Z",
          },
        ]}
        timeZone="Asia/Tokyo"
      />,
    );

    expect(screen.getByText(/2026\/8\/8 22:30/)).toBeTruthy();
    expect(screen.queryByText(/T13:30:27/)).toBeNull();
  });
});
