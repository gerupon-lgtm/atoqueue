import type { ReactNode } from "react";
import "./OverdueIndicator.css";

export function OverdueClockIcon() {
  return (
    <svg
      aria-hidden="true"
      className="overdue-clock"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function OverdueIndicator({
  ariaLabel,
  children = "期限超過",
}: {
  ariaLabel?: string;
  children?: ReactNode;
}) {
  return (
    <span className="overdue-indicator" aria-label={ariaLabel}>
      <OverdueClockIcon />
      {children}
    </span>
  );
}
