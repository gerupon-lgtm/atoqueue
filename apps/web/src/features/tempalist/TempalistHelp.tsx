import { useEffect, useId, useRef, useState } from "react";
import type { TempalistEnvironment } from "../../application/tempalist-environment";
import "./TempalistHelp.css";

export function TempalistHelp({
  environment,
}: {
  environment: TempalistEnvironment;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      className="tempalist-help"
      ref={root}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="tempalist-help__trigger"
        ref={trigger}
        aria-label="!=テンパリストとの連携について"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-labelledby={`${id}-title`}
          className="tempalist-help__popover"
        >
          <div className="tempalist-help__heading">
            <h2 id={`${id}-title`}>!=テンパリストとの連携</h2>
            <button
              type="button"
              ref={closeButton}
              aria-label="説明を閉じる"
              onClick={close}
            >
              ×
            </button>
          </div>
          <p>選んだタスクを!=テンパリストのチェックリストにします。</p>
          {environment !== "supported" && (
            <div className="tempalist-help__ios">
              <p>iPhone・iPadの場合</p>
              <p>
                あとキューと!=テンパリストを同じブラウザで開いてください。ホーム画面版とはデータが別です。
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
