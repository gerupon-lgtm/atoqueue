// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeadlineInputFields } from "./DeadlineInputFields";

describe("DeadlineInputFields", () => {
  it("lets a user type an eight-digit date, enable a four-digit time, and select the text on focus", () => {
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
    expect(date.selectionEnd).toBe(8);
    fireEvent.change(date, { target: { value: "20260811" } });
    expect(onDateDigitsChange).toHaveBeenLastCalledWith("20260811");

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
    fireEvent.change(screen.getByLabelText("期限時刻（4桁）"), {
      target: { value: "0930" },
    });
    expect(onTimeDigitsChange).toHaveBeenLastCalledWith("0930");
    expect(screen.getByText("時刻を指定しない場合は、設定の既定時刻（18:30）を使います。"))
      .toBeTruthy();
  });
});
