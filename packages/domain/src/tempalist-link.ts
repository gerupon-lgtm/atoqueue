const TEMPALIST_ORIGIN = "https://tempalist.sikumilab.com/";
const MAX_URL_LENGTH = 8000;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYLOAD_KEYS = [
  "schemaVersion",
  "kind",
  "source",
  "requestId",
  "title",
  "items",
] as const;
const ITEM_KEYS = ["sourceTaskId", "label"] as const;

export interface TempalistPayload {
  schemaVersion: 1;
  kind: "checklist-create";
  source: "atoqueue";
  requestId: string;
  title: string;
  items: Array<{ sourceTaskId: string; label: string }>;
}

export function validateTempalistPayload(value: unknown): TempalistPayload {
  const payload = requireRecord(value, "payload");
  requireExactKeys(payload, PAYLOAD_KEYS, "payload");

  if (payload.schemaVersion !== 1) throw new Error("schemaVersion must be 1.");
  if (payload.kind !== "checklist-create")
    throw new Error("kind must be checklist-create.");
  if (payload.source !== "atoqueue")
    throw new Error("source must be atoqueue.");

  const requestId = requireText(payload.requestId, "requestId");
  if (!UUID_V4_PATTERN.test(requestId))
    throw new Error("requestId must be a UUID v4.");

  const title = requireText(payload.title, "title");
  if (!Array.isArray(payload.items) || payload.items.length === 0)
    throw new Error("items must contain at least one item.");

  const seenTaskIds = new Set<string>();
  const items = payload.items.map((value, index) => {
    const item = requireRecord(value, `items[${index}]`);
    requireExactKeys(item, ITEM_KEYS, `items[${index}]`);
    const sourceTaskId = requireText(
      item.sourceTaskId,
      `items[${index}].sourceTaskId`,
    );
    const label = requireText(item.label, `items[${index}].label`);
    if (seenTaskIds.has(sourceTaskId))
      throw new Error("sourceTaskId must be unique.");
    seenTaskIds.add(sourceTaskId);
    return { sourceTaskId, label };
  });

  return {
    schemaVersion: 1,
    kind: "checklist-create",
    source: "atoqueue",
    requestId: requestId.toLowerCase(),
    title,
    items,
  };
}

export function buildTempalistUrl(value: unknown): string {
  const payload = validateTempalistPayload(value);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const url = `${TEMPALIST_ORIGIN}#create=${encoded}`;
  if (url.length > MAX_URL_LENGTH)
    throw new Error("項目を分けて送ってください。");
  return url;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error(`${label} contains an unknown field.`);
  if (allowedKeys.some((key) => !Object.hasOwn(value, key)))
    throw new Error(`${label} is missing a required field.`);
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${label} must be a non-blank string.`);
  return value;
}
