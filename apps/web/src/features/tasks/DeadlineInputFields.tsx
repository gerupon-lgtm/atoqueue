import { useRef, type FocusEvent } from "react";

export interface DeadlineInputFieldsProps {
  idPrefix: string;
  dateDigits: string;
  timeDigits: string;
  timeEnabled: boolean;
  defaultDeadlineTime: string;
  showDate?: boolean;
  onDateDigitsChange(value: string): void;
  onTimeDigitsChange(value: string): void;
  onTimeEnabledChange(value: boolean): void;
}

/** Mobile-friendly deadline controls keep manual entry and native pickers together. */
export function DeadlineInputFields({
  idPrefix,
  dateDigits,
  timeDigits,
  timeEnabled,
  defaultDeadlineTime,
  showDate = true,
  onDateDigitsChange,
  onTimeDigitsChange,
  onTimeEnabledChange,
}: DeadlineInputFieldsProps) {
  const datePicker = useRef<HTMLInputElement>(null);
  const timePicker = useRef<HTMLInputElement>(null);
  const datePickerValue = dateFromDigits(dateDigits) ?? "";
  const timePickerValue = timeFromDigits(timeDigits) ?? "";
  const touchTarget = { minHeight: "44px", minWidth: "44px" };
  return (
    <div className="deadline-input-fields">
      {showDate ? (
        <>
          <label htmlFor={`${idPrefix}-date-digits`}>期限日（8桁）</label>
          <div className="deadline-input-fields__input-with-picker">
            <input
              autoComplete="off"
              id={`${idPrefix}-date-digits`}
              inputMode="numeric"
              maxLength={10}
              onChange={(event) =>
                onDateDigitsChange(digits(event.currentTarget.value, 8))
              }
              onFocus={selectAll}
              pattern="[0-9/]*"
              placeholder="例: 2026/08/10"
              style={touchTarget}
              value={formatDateDigits(dateDigits)}
            />
            <button
              aria-label="カレンダーで期限日を選ぶ"
              className="deadline-input-fields__picker-button"
              onClick={() => openPicker(datePicker.current)}
              style={touchTarget}
              type="button"
            >
              <CalendarIcon />
            </button>
          </div>
          <input
            aria-hidden="true"
            className="deadline-input-fields__native-picker"
            onChange={(event) =>
              onDateDigitsChange(event.target.value.replaceAll("-", ""))
            }
            ref={datePicker}
            tabIndex={-1}
            type="date"
            value={datePickerValue}
          />
        </>
      ) : null}
      <label
        className="deadline-input-fields__toggle"
        htmlFor={`${idPrefix}-time-enabled`}
      >
        <input
          checked={timeEnabled}
          id={`${idPrefix}-time-enabled`}
          onChange={(event) => onTimeEnabledChange(event.target.checked)}
          type="checkbox"
        />
        期限時刻を指定する
      </label>
      {timeEnabled ? (
        <>
          <label htmlFor={`${idPrefix}-time-digits`}>期限時刻（4桁）</label>
          <div className="deadline-input-fields__input-with-picker">
            <input
              autoComplete="off"
              id={`${idPrefix}-time-digits`}
              inputMode="numeric"
              maxLength={5}
              onChange={(event) =>
                onTimeDigitsChange(digits(event.currentTarget.value, 4))
              }
              onFocus={selectAll}
              pattern="[0-9:]*"
              placeholder="例: 09:30"
              style={touchTarget}
              value={formatTimeDigits(timeDigits)}
            />
            <button
              aria-label="時計で期限時刻を選ぶ"
              className="deadline-input-fields__picker-button"
              onClick={() => openPicker(timePicker.current)}
              style={touchTarget}
              type="button"
            >
              <ClockIcon />
            </button>
          </div>
          <input
            aria-hidden="true"
            className="deadline-input-fields__native-picker"
            onChange={(event) =>
              onTimeDigitsChange(event.target.value.replace(":", ""))
            }
            ref={timePicker}
            tabIndex={-1}
            type="time"
            value={timePickerValue}
          />
        </>
      ) : null}
      <p>
        時刻を指定しない場合は、設定の既定時刻（{defaultDeadlineTime}
        ）を使います。
      </p>
    </div>
  );
}

export function dateFromDigits(value: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  )
    return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function timeFromDigits(value: string): string | undefined {
  const match = /^(\d{2})(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59)
    return undefined;
  return `${match[1]}:${match[2]}`;
}

export function digits(value: string, maxLength: number): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

export function formatDateDigits(value: string): string {
  if (value.length <= 4) return value;
  if (value.length <= 6) return `${value.slice(0, 4)}/${value.slice(4)}`;
  return `${value.slice(0, 4)}/${value.slice(4, 6)}/${value.slice(6)}`;
}

export function formatTimeDigits(value: string): string {
  return value.length <= 2 ? value : `${value.slice(0, 2)}:${value.slice(2)}`;
}

function openPicker(input: HTMLInputElement | null): void {
  if (!input) return;
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
      return;
    } catch {
      // Some browsers only permit opening a picker during an allowed gesture.
    }
  }
  input.click();
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function selectAll(event: FocusEvent<HTMLInputElement>): void {
  event.currentTarget.select();
}
