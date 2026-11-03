import { useRef, type FocusEvent } from "react";

const SELECTION_DELAY_MS = 50;

/**
 * Selects the complete text value just after focus, matching mobile browsers
 * that show the selection highlight without opening Android's edit toolbar.
 */
export function useDelayedSelectInput() {
  const selectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  function clearSelectTimer(): void {
    if (selectTimer.current === undefined) return;
    clearTimeout(selectTimer.current);
    selectTimer.current = undefined;
  }

  return {
    onFocus(event: FocusEvent<HTMLInputElement>): void {
      const input = event.currentTarget;
      clearSelectTimer();
      selectTimer.current = setTimeout(() => {
        selectTimer.current = undefined;
        input.select();
      }, SELECTION_DELAY_MS);
    },
    onBlur(): void {
      clearSelectTimer();
    },
  };
}
