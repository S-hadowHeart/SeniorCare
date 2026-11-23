/**
 * Time-zone aware helpers.
 *
 * Medication schedules and daily check-in deadlines are expressed in the
 * *elder's* local wall-clock time, while every timestamp is stored as UTC.
 * The conversion is implemented on top of the ICU `Intl.DateTimeFormat`
 * (available in every modern Node.js runtime) to avoid pulling in an extra
 * date library for what is essentially one well-defined algorithm.
 */

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Decompose an instant into wall-clock parts of the given time zone. */
export function getZonedParts(date: Date, timeZone: string): DateParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const lookup: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }

  return {
    year: Number(lookup.year ?? 1970),
    month: Number(lookup.month ?? 1),
    day: Number(lookup.day ?? 1),
    hour: Number(lookup.hour ?? 0) % 24,
    minute: Number(lookup.minute ?? 0),
    second: Number(lookup.second ?? 0),
  };
}

/**
 * Offset of the given time zone relative to UTC, in milliseconds, at the
 * given instant (positive east of Greenwich). Handles DST transitions
 * because the offset is computed for the specific instant.
 */
export function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Drop the milliseconds that the formatter cannot represent.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Convert a wall-clock date/time in `timeZone` to the corresponding UTC
 * instant.
 *
 * Ambiguous times (the hour that repeats when DST ends) resolve to the
 * earlier offset; non-existent times (the hour that is skipped when DST
 * starts) resolve to the instant right after the gap.
 */
export function zonedTimeToUtc(
  {
    year,
    month,
    day,
    hour,
    minute,
    second = 0,
  }: Omit<DateParts, "second"> & { second?: number },
  timeZone: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstGuess = new Date(naiveUtc);
  const firstOffset = getTimeZoneOffsetMs(firstGuess, timeZone);
  let result = new Date(naiveUtc - firstOffset);

  // Re-check with the offset that applies at the candidate instant; if it
  // changed (DST boundary) the local time does not exist — keep the earlier.
  const secondOffset = getTimeZoneOffsetMs(result, timeZone);
  if (secondOffset !== firstOffset) {
    const corrected = new Date(naiveUtc - secondOffset);
    const correctedOffset = getTimeZoneOffsetMs(corrected, timeZone);
    result = correctedOffset === secondOffset ? corrected : result;
  }

  return result;
}

/** "YYYY-MM-DD" for the given instant in the given time zone. */
export function getLocalDateKey(date: Date, timeZone: string): string {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The UTC instant of local midnight for the day containing `date`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const { year, month, day } = getZonedParts(date, timeZone);
  return zonedTimeToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** The UTC instant of the *next* local midnight after `date`. */
export function endOfLocalDay(date: Date, timeZone: string): Date {
  const { year, month, day } = getZonedParts(date, timeZone);
  return zonedTimeToUtc({ year, month, day: day + 1, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** Day of week (0 = Sunday … 6 = Saturday) of the given instant in a zone. */
export function getLocalDayOfWeek(date: Date, timeZone: string): number {
  const { year, month, day } = getZonedParts(date, timeZone);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Parse "HH:mm" into hour/minute, validating the format. */
export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Format an instant for display in a specific time zone. */
export function formatInTimeZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(date);
}

/** Add whole days to a `DateParts` value, normalising month/year overflow. */
export function addDays(parts: DateParts, days: number): DateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}
