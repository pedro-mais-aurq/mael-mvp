export type TemporalValueBinding =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "instant"; iso: string }>
  | Readonly<{ kind: "date_only"; localDate: string }>
  | Readonly<{ kind: "unresolved" }>;

export interface TemporalBindingContext {
  now: Date;
  timezone: string;
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const NONE: TemporalValueBinding = Object.freeze({ kind: "none" });
const UNRESOLVED: TemporalValueBinding = Object.freeze({ kind: "unresolved" });

function normalizedTemporalText(value: string): string {
  const withoutControls = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  return withoutControls
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/:-]+/g, " ")
    .trim();
}

function localParts(date: Date, timezone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function zonedDateTimeToUtc(target: LocalDateTimeParts, timezone: string): number | null {
  const targetAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );
  let instant = targetAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localParts(new Date(instant), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    instant += targetAsUtc - actualAsUtc;
  }
  const roundTrip = localParts(new Date(instant), timezone);
  return Object.keys(target).every(
    (key) => roundTrip[key as keyof LocalDateTimeParts] === target[key as keyof LocalDateTimeParts],
  )
    ? instant
    : null;
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function localDate(
  message: string,
  context: TemporalBindingContext,
): {
  year: number;
  month: number;
  day: number;
} | null {
  const now = localParts(context.now, context.timezone);
  if (/\b(?:hoje|amanha)\b/.test(message)) {
    const date = new Date(Date.UTC(now.year, now.month - 1, now.day));
    if (/\bamanha\b/.test(message)) date.setUTCDate(date.getUTCDate() + 1);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }

  const iso = message.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return validCalendarDate(year, month, day) ? { year, month, day } : null;
  }

  const brazilian = message.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b/);
  if (!brazilian) return null;
  const day = Number(brazilian[1]);
  const month = Number(brazilian[2]);
  let year = brazilian[3] ? Number(brazilian[3]) : now.year;
  if (!brazilian[3] && validCalendarDate(year, month, day)) {
    const requested = Date.UTC(year, month - 1, day);
    const today = Date.UTC(now.year, now.month - 1, now.day);
    if (requested < today) year += 1;
  }
  return validCalendarDate(year, month, day) ? { year, month, day } : null;
}

function localTime(message: string): { hour: number; minute: number } | null {
  const afterAt = message.match(/\bas\s+(\d{1,2})(?::(\d{2}))?(?:\s*h(?:oras?)?)?\b/);
  const compact = message.match(/\b(\d{1,2})h(?:(\d{2}))?\b/);
  const match = afterAt ?? compact;
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : null;
}

function hasTemporalSignal(message: string): boolean {
  return (
    /\b(?:hoje|amanha)\b/.test(message) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(message) ||
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?\b/.test(message) ||
    /\bas\s+\d{1,2}(?::\d{2})?\b/.test(message) ||
    /\b\d{1,2}h(?:\d{2})?\b/.test(message)
  );
}

/**
 * Interpreta apenas formas temporais determinísticas aceitas pela P3. O valor
 * nasce da mensagem original e de relógio/timezone fornecidos pelo backend.
 */
export function resolveTemporalValue(
  originalMessage: string,
  context?: TemporalBindingContext,
): TemporalValueBinding {
  const message = normalizedTemporalText(originalMessage);
  if (!hasTemporalSignal(message)) return NONE;
  if (!context) return UNRESOLVED;

  try {
    const date = localDate(message, context);
    if (!date) return UNRESOLVED;
    const time = localTime(message);
    const pad = (value: number) => String(value).padStart(2, "0");
    const localDateValue = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
    if (!time) return Object.freeze({ kind: "date_only", localDate: localDateValue });

    const instant = zonedDateTimeToUtc(
      { ...date, hour: time.hour, minute: time.minute, second: 0 },
      context.timezone,
    );
    return instant === null
      ? UNRESOLVED
      : Object.freeze({ kind: "instant", iso: new Date(instant).toISOString() });
  } catch {
    return UNRESOLVED;
  }
}

export function requireTemporalValue(binding: TemporalValueBinding): TemporalValueBinding {
  return binding.kind === "none" ? UNRESOLVED : binding;
}

export function sameTemporalInstant(actual: string, expected: string): boolean {
  const actualMs = Date.parse(actual);
  const expectedMs = Date.parse(expected);
  return Number.isFinite(actualMs) && Number.isFinite(expectedMs) && actualMs === expectedMs;
}
