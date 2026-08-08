export function formatTimeZone(timeZone: string, now = new Date()): string {
  const offset = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value;
  return offset ? `${timeZone}（${offset.replace("GMT", "UTC")}）` : timeZone;
}
