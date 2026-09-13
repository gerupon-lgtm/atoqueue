/** Only the existing anonymous v1 notification routes are allowed. */
export function validReminderUrl(url: unknown, reminderId: unknown): url is string {
  if (typeof url !== "string" || typeof reminderId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reminderId)) return false;
  try {
    const parsed = new URL(url, "https://atoqueue.invalid");
    return parsed.origin === "https://atoqueue.invalid"
      && (parsed.pathname === "/today" || parsed.pathname === "/inbox")
      && parsed.searchParams.size === 1
      && parsed.searchParams.get("reminder") === reminderId;
  } catch { return false; }
}
