import type { ScheduleType } from "../generated/prisma/enums.js";
import {
  getLocalDayOfWeek,
  getLocalDateKey,
  getZonedParts,
  parseTimeOfDay,
  startOfLocalDay,
  zonedTimeToUtc,
  type DateParts,
} from "./time.js";

/**
 * Deterministic medication schedule expansion.
 *
 * Dose instances are *not* materialised in the database ahead of time —
 * a medication taken for years at four times a day would otherwise create
 * ~5,800 rows per year. Instead the schedule is expanded on demand for the
 * requested window and only the *actual* dose state (taken / skipped /
 * missed) is persisted in `medication_logs`.
 */

export interface SchedulableMedication {
  id: string;
  name: string;
  dosage: string;
  scheduleType: ScheduleType;
  /** Local times of day, "HH:mm". */
  times: string[];
  /** 0 = Sunday … 6 = Saturday. */
  daysOfWeek: number[];
  intervalMinutes: number | null;
  startDate: Date;
  endDate: Date | null;
  active: boolean;
}

export interface DoseInstance {
  medicationId: string;
  medicationName: string;
  dosage: string;
  /** The UTC instant the dose is due. */
  scheduledFor: Date;
  /** Stable key for the (medication, instant) pair. */
  key: string;
}

function buildKey(medicationId: string, scheduledFor: Date): string {
  return `${medicationId}:${scheduledFor.toISOString()}`;
}

function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

/**
 * Expand a medication schedule into the concrete doses due inside
 * `[from, to]`.
 */
export function expandDoses(
  medication: SchedulableMedication,
  from: Date,
  to: Date,
  timeZone: string,
): DoseInstance[] {
  if (!medication.active || medication.scheduleType === "AS_NEEDED") return [];
  if (to <= from) return [];

  const doses: DoseInstance[] = [];

  switch (medication.scheduleType) {
    case "DAILY":
    case "WEEKLY": {
      // Walk the local calendar day by day so that DST transitions are
      // resolved through the wall-clock conversion instead of by adding
      // fixed 24-hour offsets.
      let cursor = startOfLocalDay(from, timeZone);
      const guard = 400; // ~13 months of days — plenty for any sane window.

      for (let index = 0; index < guard && cursor <= to; index += 1) {
        const localKey = getLocalDateKey(cursor, timeZone);
        const { year, month, day } = parseDateKey(localKey);
        const weekday = getLocalDayOfWeek(cursor, timeZone);

        const isScheduledDay =
          medication.scheduleType === "DAILY" ||
          medication.daysOfWeek.length === 0 ||
          medication.daysOfWeek.includes(weekday);

        if (isScheduledDay) {
          for (const time of medication.times) {
            const parsed = parseTimeOfDay(time);
            if (!parsed) continue;

            const scheduledFor = zonedTimeToUtc(
              { year, month, day, hour: parsed.hour, minute: parsed.minute, second: 0 },
              timeZone,
            );

            if (scheduledFor < from || scheduledFor > to) continue;
            if (medication.startDate && scheduledFor < medication.startDate) continue;
            if (medication.endDate && scheduledFor > medication.endDate) continue;

            doses.push({
              medicationId: medication.id,
              medicationName: medication.name,
              dosage: medication.dosage,
              scheduledFor,
              key: buildKey(medication.id, scheduledFor),
            });
          }
        }

        cursor = zonedTimeToUtc(
          { year, month, day: day + 1, hour: 0, minute: 0, second: 0 },
          timeZone,
        );
      }
      break;
    }

    case "INTERVAL": {
      const interval = Math.max(1, medication.intervalMinutes ?? 60);
      const stepMs = interval * 60_000;
      const start = medication.startDate ?? from;
      // Anchor the interval on the start time, not on the Unix epoch.
      const firstOffset = Math.ceil((from.getTime() - start.getTime()) / stepMs);
      let index = Math.max(0, firstOffset);

      for (
        let current = start.getTime() + index * stepMs;
        current <= to.getTime();
        current += stepMs, index += 1
      ) {
        const scheduledFor = new Date(current);
        if (scheduledFor < from) continue;
        if (medication.endDate && scheduledFor > medication.endDate) break;

        doses.push({
          medicationId: medication.id,
          medicationName: medication.name,
          dosage: medication.dosage,
          scheduledFor,
          key: buildKey(medication.id, scheduledFor),
        });
      }
      break;
    }

    default:
      break;
  }

  return doses.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}

/** Convenience helper: the doses that fall on one local calendar day. */
export function dosesForLocalDay(
  medication: SchedulableMedication,
  day: Date,
  timeZone: string,
): DoseInstance[] {
  const from = startOfLocalDay(day, timeZone);
  const to = new Date(from.getTime() + 26 * 60 * 60 * 1000);
  return expandDoses(medication, from, to, timeZone).filter(
    (dose) => getLocalDateKey(dose.scheduledFor, timeZone) === getLocalDateKey(day, timeZone),
  );
}

/** Exposed for tests: the wall-clock parts of an instant. */
export function localPartsOf(date: Date, timeZone: string): DateParts {
  return getZonedParts(date, timeZone);
}
