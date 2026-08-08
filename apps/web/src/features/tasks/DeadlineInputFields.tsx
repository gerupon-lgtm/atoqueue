import type { FocusEvent } from "react";

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
  const datePickerValue = dateFromDigits(dateDigits) ?? "";
  const timePickerValue = timeFromDigits(timeDigits) ?? "";
  const touchTarget = { minHeight: "44px", minWidth: "44px" };
  return (
    <div className="deadline-input-fields">
      {showDate ? (
        <>
          <label htmlFor={`${idPrefix}-date-digits`}>期限日（8桁）</label>
          <input
            autoComplete="off"
            id={`${idPrefix}-date-digits`}
            inputMode="numeric"
            maxLength={8}
            onChange={(event) => onDateDigitsChange(digits(event.target.value, 8))}
            onFocus={selectAll}
            pattern="[0-9]*"
            placeholder="例: 20260810"
            style={touchTarget}
            value={dateDigits}
          />
          <label htmlFor={`${idPrefix}-date-picker`}>カレンダーから日付を選ぶ</label>
          <input
            id={`${idPrefix}-date-picker`}
            onChange={(event) => onDateDigitsChange(event.target.value.replaceAll("-", ""))}
            type="date"
            style={touchTarget}
            value={datePickerValue}
          />
        </>
      ) : null}
      <label className="deadline-input-fields__toggle" htmlFor={`${idPrefix}-time-enabled`}>
        <input
          checked={timeEnabled}
          id={`${idPrefix}-time-enabled`}
          onChange={(event) => onTimeEnabledChange(event.target.checked)}
          style={touchTarget}
          type="checkbox"
        />
        期限時刻を指定する
      </label>
      {timeEnabled ? (
        <>
          <label htmlFor={`${idPrefix}-time-digits`}>期限時刻（4桁）</label>
          <input
            autoComplete="off"
            id={`${idPrefix}-time-digits`}
            inputMode="numeric"
            maxLength={4}
            onChange={(event) => onTimeDigitsChange(digits(event.target.value, 4))}
            onFocus={selectAll}
            pattern="[0-9]*"
            placeholder="例: 0930"
            style={touchTarget}
            value={timeDigits}
          />
          <label htmlFor={`${idPrefix}-time-picker`}>時計から時刻を選ぶ</label>
          <input
            id={`${idPrefix}-time-picker`}
            onChange={(event) => onTimeDigitsChange(event.target.value.replace(":", ""))}
            type="time"
            style={touchTarget}
            value={timePickerValue}
          />
        </>
      ) : null}
      <p>時刻を指定しない場合は、設定の既定時刻（{defaultDeadlineTime}）を使います。</p>
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
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
  return `${match[1]}:${match[2]}`;
}

export function digits(value: string, maxLength: number): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function selectAll(event: FocusEvent<HTMLInputElement>): void {
  event.currentTarget.select();
}
