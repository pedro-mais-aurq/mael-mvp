export function isValidIanaTimezone(value: string | null | undefined): value is string {
  if (!value || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(
  browserTimezone: string | null | undefined,
  profileTimezone: string | null | undefined,
): string {
  if (isValidIanaTimezone(browserTimezone)) return browserTimezone;
  if (isValidIanaTimezone(profileTimezone)) return profileTimezone;
  return "UTC";
}

export function formatLocalDateTime(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(now);
}
