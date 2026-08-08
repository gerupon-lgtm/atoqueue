// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeadlineInputFields } from "./DeadlineInputFields";

describe("DeadlineInputFields", () => {
  afterEach(cleanup);

  it("formats typed date and time values while keeping one picker button per field", () => {
    render(
      <DeadlineInputFields
        dateDigits="20260808"
        defaultDeadlineTime="18:30"
        idPrefix="candidate"
        onDateDigitsChange={vi.fn()}
        onTimeDigitsChange={vi.fn()}
        onTimeEnabledChange={vi.fn()}
        timeDigits="0930"
        timeEnabled
      />,
    );

    expect(
      (screen.getByLabelText("期限日（8桁）") as HTMLInputElement).value,
    ).toBe("2026/08/08");
    expect(
      (screen.getByLabelText("期限時刻（4桁）") as HTMLInputElement).value,
    ).toBe("09:30");
    expect(
      screen.getByRole("button", { name: "カレンダーで期限日を選ぶ" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "時計で期限時刻を選ぶ" }),
    ).toBeTruthy();
    expect(screen.queryByText("カレンダーから日付を選ぶ")).toBeNull();
    expect(screen.queryByText("時計から時刻を選ぶ")).toBeNull();
  });

  it("selects the formatted date on focus and enables a time input", () => {
    const onDateDigitsChange = vi.fn();
    const onTimeEnabledChange = vi.fn();
    const onTimeDigitsChange = vi.fn();
    const { rerender } = render(
      <DeadlineInputFields
        dateDigits="20260810"
        defaultDeadlineTime="18:30"
        idPrefix="candidate"
        onDateDigitsChange={onDateDigitsChange}
        onTimeDigitsChange={onTimeDigitsChange}
        onTimeEnabledChange={onTimeEnabledChange}
        timeDigits=""
        timeEnabled={false}
      />,
    );

    const date = screen.getByLabelText("期限日（8桁）") as HTMLInputElement;
    fireEvent.focus(date);
    expect(date.selectionStart).toBe(0);
    expect(date.selectionEnd).toBe(10);
    fireEvent.click(screen.getByLabelText("期限時刻を指定する"));
    expect(onTimeEnabledChange).toHaveBeenCalledWith(true);
    rerender(
      <DeadlineInputFields
        dateDigits="20260810"
        defaultDeadlineTime="18:30"
        idPrefix="candidate"
        onDateDigitsChange={onDateDigitsChange}
        onTimeDigitsChange={onTimeDigitsChange}
        onTimeEnabledChange={onTimeEnabledChange}
        timeDigits=""
        timeEnabled={true}
      />,
    );
    expect(
      screen.getByText(
        "時刻を指定しない場合は、設定の既定時刻（18:30）を使います。",
      ),
    ).toBeTruthy();
  });
});
