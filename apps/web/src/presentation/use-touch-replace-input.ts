import {
  useRef,
  type ChangeEvent,
  type FocusEvent,
  type PointerEvent,
  type TouchEvent,
} from "react";

/**
 * Keeps desktop select-all editing while avoiding Android's selection menu.
 * A touch-focused field replaces its current value only when the first input
 * event inserts text; deletion and later edits keep the browser's normal flow.
 */
export function useTouchReplaceInput() {
  const touchFocusPending = useRef(false);
  const replacementPending = useRef(false);

  return {
    onPointerDown(event: PointerEvent<HTMLInputElement>): void {
      if (
        event.pointerType === "touch" &&
        document.activeElement !== event.currentTarget
      ) {
        touchFocusPending.current = true;
      }
    },
    onTouchStart(event: TouchEvent<HTMLInputElement>): void {
      if (document.activeElement !== event.currentTarget) {
        touchFocusPending.current = true;
      }
    },
    onFocus(event: FocusEvent<HTMLInputElement>): void {
      if (touchFocusPending.current) {
        touchFocusPending.current = false;
        replacementPending.current = true;
        return;
      }
      event.currentTarget.select();
    },
    onBlur(): void {
      touchFocusPending.current = false;
      replacementPending.current = false;
    },
    valueForChange(event: ChangeEvent<HTMLInputElement>): string {
      const value = event.currentTarget.value;
      if (!replacementPending.current) return value;

      replacementPending.current = false;
      const inputEvent = event.nativeEvent as InputEvent;
      return inputEvent.inputType.startsWith("insert") && inputEvent.data
        ? inputEvent.data
        : value;
    },
  };
}
