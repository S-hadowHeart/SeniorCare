import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";

/** Coerce an API value into a valid Date, or null when it is missing/invalid. */
function parseDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Locale-aware, human friendly date/time formatting. */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return format(date, "d MMM yyyy 'at' HH:mm");
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return format(date, "d MMM yyyy");
}

export function formatTime(value: string | Date | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return format(date, "HH:mm");
}

/** "just now", "3 minutes ago", "2 days ago" */
export function relativeTime(value: string | Date | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return `${formatDistanceToNowStrict(date)} ago`;
}

/** "Today at 09:15" / "Yesterday at 18:00" / "12 Mar at 08:00" */
export function smartDateTime(value: string | Date | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";

  if (isToday(date)) return `Today at ${format(date, "HH:mm")}`;
  if (isYesterday(date)) return `Yesterday at ${format(date, "HH:mm")}`;
  return format(date, "d MMM 'at' HH:mm");
}

/** Human readable age from a date of birth. */
export function ageFrom(dateOfBirth: string | null): string | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) {
    years -= 1;
  }
  return years >= 0 ? `${years} years old` : null;
}

/** Format a vital value, hiding the trailing `.0` for integers. */
export function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits }).format(value);
}

/** "22:00" → "10:00 pm" */
export function formatClockTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  if (hours === undefined || minutes === undefined) return time;
  const suffix = hours >= 12 ? "pm" : "am";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** Initials for an avatar. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
