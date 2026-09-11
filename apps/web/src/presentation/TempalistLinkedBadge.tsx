import "./TempalistLinkedBadge.css";

export function TempalistLinkedBadge({
  linked,
  iconSrc,
}: {
  linked: boolean;
  iconSrc?: string;
}) {
  if (!linked) return null;
  return (
    <span
      className="tempalist-linked-badge"
      aria-label="テンパリストへ開く操作済み"
    >
      {iconSrc ? <img src={iconSrc} alt="" width={14} height={14} /> : null}
      {iconSrc ? "連携済" : "テンパリスト連携済"}
    </span>
  );
}
