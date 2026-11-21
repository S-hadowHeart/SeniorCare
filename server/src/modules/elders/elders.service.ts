import { prisma } from "../../lib/prisma.js";
import { decryptNullable } from "../../lib/crypto.js";
import { expandDoses } from "../../lib/schedule.js";
import { endOfLocalDay, startOfLocalDay } from "../../lib/time.js";
import { listAccessibleElders } from "../../lib/access.js";
import type { AuthContext } from "../../types.js";

/**
 * Aggregated view of one elder, shared by the senior's own dashboard and the
 * caregiver dashboard.
 *
 * The aggregation is intentionally done in a small number of parallel
 * queries rather than one huge join, so that PostgreSQL can use the indexes
 * on `(elderId, createdAt)` instead of materialising a large join result.
 */

export interface ElderSummary {
  elder: {
    id: string;
    displayName: string;
    dateOfBirth: Date | null;
    bloodType: string | null;
    conditions: string[];
    allergies: string[];
    medicalNotes: string | null;
    photoUrl: string | null;
    checkInDeadlineHour: number;
    canTriggerSos: boolean;
  };
  checkIn: {
    latest: {
      id: string;
      status: string;
      mood: number | null;
      note: string | null;
      createdAt: Date;
    } | null;
    checkedInToday: boolean;
    /** Consecutive days with a SAFE check-in, ending today or yesterday. */
    streak: number;
    /** Number of missed check-ins in the last 7 days. */
    missedLast7Days: number;
  };
  medications: {
    total: number;
    active: number;
    dueToday: number;
    takenToday: number;
    adherence7Days: number | null;
  };
  vitals: {
    latest: Array<{
      id: string;
      type: string;
      value: number;
      value2: number | null;
      unit: string;
      isCritical: boolean;
      warning: string | null;
      measuredAt: Date;
    }>;
    criticalCount24h: number;
  };
  sos: {
    activeCount: number;
    latest: { id: string; status: string; createdAt: Date } | null;
  };
  caregivers: {
    total: number;
    names: string[];
  };
}

export async function buildElderSummary(
  elderId: string,
  timeZone: string,
): Promise<ElderSummary> {
  const now = new Date();
  const dayStart = startOfLocalDay(now, timeZone);
  const dayEnd = endOfLocalDay(now, timeZone);
  const weekAgo = new Date(dayStart.getTime() - 6 * 24 * 60 * 60 * 1000);

  const [elder, latestCheckIn, recentCheckIns, meds, medicationLogs, latestVitals, criticalVitals, sosAlerts, careLinks] =
    await Promise.all([
      prisma.elder.findUnique({
        where: { id: elderId },
        select: {
          id: true,
          displayName: true,
          dateOfBirth: true,
          bloodType: true,
          conditions: true,
          allergies: true,
          medicalNotes: true,
          photoUrl: true,
          checkInDeadlineHour: true,
          canTriggerSos: true,
        },
      }),
      prisma.checkIn.findFirst({
        where: { elderId },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, mood: true, note: true, createdAt: true },
      }),
      prisma.checkIn.findMany({
        where: { elderId, createdAt: { gte: weekAgo } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, createdAt: true },
      }),
      prisma.medication.findMany({
        where: { elderId },
        select: {
          id: true,
          name: true,
          dosage: true,
          scheduleType: true,
          times: true,
          daysOfWeek: true,
          intervalMinutes: true,
          startDate: true,
          endDate: true,
          active: true,
        },
      }),
      prisma.medicationLog.findMany({
        where: {
          medication: { elderId },
          scheduledFor: { gte: weekAgo, lte: dayEnd },
        },
        select: { id: true, scheduledFor: true, status: true, medicationId: true },
      }),
      prisma.vital.findMany({
        where: { elderId },
        distinct: ["type"],
        orderBy: [{ type: "asc" }, { measuredAt: "desc" }],
        select: {
          id: true,
          type: true,
          value: true,
          value2: true,
          unit: true,
          isCritical: true,
          warning: true,
          measuredAt: true,
        },
      }),
      prisma.vital.count({
        where: { elderId, isCritical: true, measuredAt: { gte: new Date(now.getTime() - 24 * 3600_000) } },
      }),
      prisma.sosAlert.findFirst({
        where: { elderId },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, createdAt: true },
      }),
      prisma.careLink.findMany({
        where: { elderId, status: "ACTIVE" },
        select: { caregiver: { select: { name: true } } },
      }),
    ]);

  if (!elder) {
    throw new Error("Elder not found while building summary.");
  }

  // --- Medication adherence ---------------------------------------------
  const activeMedications = meds.filter((medication) => medication.active);
  const dueToday = activeMedications.flatMap((medication) =>
    expandDoses(
      {
        ...medication,
        startDate: medication.startDate,
        endDate: medication.endDate,
        intervalMinutes: medication.intervalMinutes,
      },
      dayStart,
      dayEnd,
      timeZone,
    ),
  );

  const logByKey = new Map(
    medicationLogs.map((log) => [`${log.medicationId}:${log.scheduledFor.toISOString()}`, log]),
  );

  const todayLogs = dueToday.map((dose) => logByKey.get(dose.key));
  const takenToday = todayLogs.filter((log) => log?.status === "TAKEN").length;

  const weekDoses = activeMedications.flatMap((medication) =>
    expandDoses(medication, weekAgo, dayEnd, timeZone),
  );
  const weekRelevant = weekDoses.filter((dose) => dose.scheduledFor <= now);
  const weekTaken = weekRelevant.filter(
    (dose) => logByKey.get(dose.key)?.status === "TAKEN",
  ).length;

  // --- Check-in streak ---------------------------------------------------
  const byDay = new Map<string, string>();
  for (const checkIn of recentCheckIns) {
    const key = checkIn.createdAt.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, checkIn.status);
  }

  const checkedInToday = recentCheckIns.some(
    (checkIn) => checkIn.createdAt >= dayStart && checkIn.status !== "MISSED",
  );

  let streak = 0;
  for (let offset = 0; offset < 60; offset += 1) {
    const day = new Date(dayStart.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = day.toISOString().slice(0, 10);
    const status = byDay.get(key);
    if (status === "SAFE") {
      streak += 1;
    } else if (offset === 0 && status === undefined) {
      // Today has not been confirmed yet — do not break the streak.
      continue;
    } else {
      break;
    }
  }

  const missedLast7Days = recentCheckIns.filter((checkIn) => checkIn.status === "MISSED").length;

  return {
    elder: {
      ...elder,
      medicalNotes: decryptNullable(elder.medicalNotes),
    },
    checkIn: {
      latest: latestCheckIn
        ? { ...latestCheckIn, note: decryptNullable(latestCheckIn.note) }
        : null,
      checkedInToday,
      streak,
      missedLast7Days,
    },
    medications: {
      total: meds.length,
      active: activeMedications.length,
      dueToday: dueToday.length,
      takenToday,
      adherence7Days:
        weekRelevant.length > 0 ? Math.round((weekTaken / weekRelevant.length) * 100) : null,
    },
    vitals: {
      latest: latestVitals.map((vital) => ({ ...vital, warning: vital.warning })),
      criticalCount24h: criticalVitals,
    },
    sos: {
      activeCount: sosAlerts?.status === "ACTIVE" || sosAlerts?.status === "ACKNOWLEDGED" ? 1 : 0,
      latest: sosAlerts ? { id: sosAlerts.id, status: sosAlerts.status, createdAt: sosAlerts.createdAt } : null,
    },
    caregivers: {
      total: careLinks.length,
      names: careLinks.map((link) => link.caregiver?.name ?? "Unknown"),
    },
  };
}

/** Summaries for every elder the caller may read. */
export async function buildDashboardSummaries(actor: AuthContext): Promise<ElderSummary[]> {
  const accessible = await listAccessibleElders(actor);

  const summaries = await Promise.all(
    accessible.map((item) =>
      buildElderSummary(item.elder.id, item.elder.user.timeZone || "UTC"),
    ),
  );

  // Most urgent first: active SOS, then not checked in today, then by name.
  return summaries.sort((a, b) => {
    if (a.sos.activeCount !== b.sos.activeCount) return b.sos.activeCount - a.sos.activeCount;
    if (a.checkIn.checkedInToday !== b.checkIn.checkedInToday) {
      return a.checkIn.checkedInToday ? 1 : -1;
    }
    return a.elder.displayName.localeCompare(b.elder.displayName);
  });
}
