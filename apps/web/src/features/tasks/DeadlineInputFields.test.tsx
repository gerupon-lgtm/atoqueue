// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeadlineInputFields } from "./DeadlineInputFields";

describe("DeadlineInputFields", () => {
  afterEach(cleanup);

  it.each(["", "2026", "20260230"])("F-007 opens a date picker from %j using the current day only for an empty field", (initialDate) => {
    let today = "2026-10-15";
    function DateInput() {
      const [date, setDate] = useState(initialDate);
      return <DeadlineInputFields dateDigits={date} defaultDeadlineTime="23:59" getTodayDate={() => today} idPrefix="test" onDateDigitsChange={setDate} onTimeDigitsChange={vi.fn()} onTimeEnabledChange={vi.fn()} timeDigits="" timeEnabled={false} />;
    }
    const { container } = render(<DateInput />);
    const date = screen.getByLabelText("期限日（8桁）") as HTMLInputElement;
    expect(date.placeholder).toBe("例: 2026/10/15");
    const picker = container.querySelector<HTMLInputElement>('input[type="date"]')!;
    const showPicker = vi.fn();
    picker.showPicker = showPicker;
    const originalValue = date.value;
    today = "2026-10-16";
    fireEvent.click(screen.getByRole("button", { name: "カレンダーで期限日を選ぶ" }));
    expect(showPicker).toHaveBeenCalledOnce();
    expect(date.value).toBe(initialDate ? originalValue : "2026/10/16");
    if (!initialDate) expect(picker.value).toBe("2026-10-16");
  });

  it("formats typed date and time values while keeping one picker button per field", () => {
    render(
      <DeadlineInputFields
        dateDigits="20260808"
        getTodayDate={() => "2026-10-16"}
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

  it("selects the formatted date on focus and enables a time input", async () => {
    const onDateDigitsChange = vi.fn();
    const onTimeEnabledChange = vi.fn();
    const onTimeDigitsChange = vi.fn();
    const { rerender } = render(
      <DeadlineInputFields
        dateDigits="20260810"
        getTodayDate={() => "2026-10-16"}
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
    await waitFor(() => {
      expect(date.selectionStart).toBe(0);
      expect(date.selectionEnd).toBe(10);
    });
    fireEvent.click(screen.getByLabelText("期限時刻を指定する"));
    expect(onTimeEnabledChange).toHaveBeenCalledWith(true);
    rerender(
      <DeadlineInputFields
        dateDigits="20260810"
        getTodayDate={() => "2026-10-16"}
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

  it("selects the whole touch-focused value after a short delay and accepts a new time", async () => {
    function ControlledDeadlineInput() {
      const [dateDigits, setDateDigits] = useState("20260810");
      const [timeDigits, setTimeDigits] = useState("2359");
      return (
        <DeadlineInputFields
          dateDigits={dateDigits}
          getTodayDate={() => "2026-10-16"}
          defaultDeadlineTime="18:30"
          idPrefix="candidate"
          onDateDigitsChange={setDateDigits}
          onTimeDigitsChange={setTimeDigits}
          onTimeEnabledChange={vi.fn()}
          timeDigits={timeDigits}
          timeEnabled
        />
      );
    }

    render(<ControlledDeadlineInput />);
    const date = screen.getByLabelText("期限日（8桁）") as HTMLInputElement;

    fireEvent.pointerDown(date, { pointerType: "touch" });
    fireEvent.focus(date);
    await waitFor(() => {
      expect(date.selectionStart).toBe(0);
      expect(date.selectionEnd).toBe(10);
    });

    const time = screen.getByLabelText("期限時刻（4桁）") as HTMLInputElement;
    fireEvent.pointerDown(time, { pointerType: "touch" });
    fireEvent.focus(time);
    await waitFor(() => {
      expect(time.selectionStart).toBe(0);
      expect(time.selectionEnd).toBe(5);
    });

    fireEvent.input(time, { inputType: "insertText", target: { value: "1" } });
    fireEvent.input(time, { inputType: "insertText", target: { value: "18" } });
    fireEvent.input(time, {
      inputType: "insertText",
      target: { value: "18:3" },
    });
    fireEvent.input(time, {
      inputType: "insertText",
      target: { value: "18:30" },
    });
    expect(time.value).toBe("18:30");
  });
});
