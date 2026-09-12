import "./TempalistLinkedBadge.css";
import tempalistIcon from "../assets/tempalist-icon.svg";

export function TempalistLinkedBadge({
  linked,
  iconSrc = tempalistIcon,
}: {
  linked: boolean;
  iconSrc?: string;
}) {
  if (!linked) return null;
  return (
    <span
      className="tempalist-linked-badge"
      aria-label="!=テンパリストへ開く操作済み"
      title="!=テンパリストへ開く操作済み（受信・保存の成功ではありません）"
    >
      {iconSrc ? <img src={iconSrc} alt="" width={14} height={14} /> : null}
      {iconSrc ? "連携済" : "!=テンパリスト連携済"}
    </span>
  );
}
