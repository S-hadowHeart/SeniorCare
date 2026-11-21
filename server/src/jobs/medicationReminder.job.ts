import { endOfLocalDay, formatInTimeZone, getLocalDateKey, startOfLocalDay } from "../lib/time.js";
import { expandDoses } from "../lib/schedule.js";
import { prisma } from "../lib/prisma.js";
import { childLogger } from "../lib/logger.js";
import { notify, resolveElderRecipients } from "../notifications/service.js";
import { medicationReminderEmail } from "../notifications/templates.js";
import { realtimeBus } from "../realtime/bus.js";
import { env } from "../config/env.js";

const log = childLogger("job:medication-reminder");

/**
 * Medication reminder job.
 *
 * Runs once a minute and does three things:
 *
 *  1. **Remind** — a dose that falls due within the next
 *     `MEDICATION_REMINDER_LEAD_MINUTES` produces an in-app notification and
 *     (for the senior) an e-mail.
 *  2. **Escalate** — a dose that is more than `MEDICATION_GRACE_MINUTES`
 *     overdue is marked `MISSED` and the caregivers are notified.
 *  3. **Stay idempotent** — the `remindedAt` stamp on the dose row means a
 *     reminder is never sent twice, even if the job restarts.
 */
export async function runMedicationReminderJob(): Promise<void> {
  const now = new Date();
  const leadMs = env.MEDICATION_REMINDER_LEAD_MINUTES * 60_000;
  const graceMs = env.MEDICATION_GRACE_MINUTES * 60_000;

  const medications = await prisma.medication.findMany({
    where: { active: true, scheduleType: { not: "AS_NEEDED" } },
    select: {
      id: true,
      elderId: true,
      name: true,
      dosage: true,
      scheduleType: true,
      times: true,
      daysOfWeek: true,
      intervalMinutes: true,
      startDate: true,
      endDate: true,
      active: true,
      notifyCaregivers: true,
      elder: {
        select: {
          id: true,
          displayName: true,
          userId: true,
          user: { select: { id: true, name: true, email: true, timeZone: true } },
        },
      },
    },
  });

  if (medications.length === 0) return;

  for (const medication of medications) {
    const timeZone = medication.elder.user.timeZone || "UTC";

    // Look at a window that covers "recently missed" and "about to be due".
    const from = new Date(now.getTime() - graceMs);
    const to = new Date(now.getTime() + leadMs);

    const doses = expandDoses(medication, from, to, timeZone);
    if (doses.length === 0) continue;

    const existingLogs = await prisma.medicationLog.findMany({
      where: {
        medicationId: medication.id,
        scheduledFor: { gte: from, lte: to },
      },
      select: { id: true, scheduledFor: true, status: true, remindedAt: true },
    });

    const logByKey = new Map(
      existingLogs.map((log) => [`${log.scheduledFor.toISOString()}`, log]),
    );

    for (const dose of doses) {
      const key = dose.scheduledFor.toISOString();
      const existing = logByKey.get(key);
      // People read this in a notification, so show their local clock time
      // rather than a raw ISO timestamp.
      const dueAt = formatInTimeZone(dose.scheduledFor, timeZone, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      // ---- 1. Reminder -------------------------------------------------
      const isDueSoon = dose.scheduledFor.getTime() <= now.getTime() + leadMs;
      const needsReminder =
        isDueSoon && (!existing || (existing.status === "PENDING" && !existing.remindedAt));

      if (needsReminder) {
        if (existing) {
          await prisma.medicationLog.update({
            where: { id: existing.id },
            data: { remindedAt: now },
          });
        } else {
          await prisma.medicationLog.create({
            data: {
              medicationId: medication.id,
              scheduledFor: dose.scheduledFor,
              status: "PENDING",
              remindedAt: now,
            },
          });
        }

        const email = medicationReminderEmail({
          elderName: medication.elder.displayName,
          medicationName: medication.name,
          dosage: medication.dosage,
          scheduledFor: dose.scheduledFor,
        });

        await notify({
          userId: medication.elder.user.id,
          type: "MEDICATION_DUE",
          elderId: medication.elderId,
          title: `Time for ${medication.name}`,
          body: `${medication.dosage} — due at ${dueAt}.`,
          metadata: {
            medicationId: medication.id,
            scheduledFor: dose.scheduledFor.toISOString(),
          },
          email,
        });

        if (medication.notifyCaregivers) {
          const { caregivers } = await resolveElderRecipients(medication.elderId);
          await Promise.all(
            caregivers.map((recipient) =>
              notify({
                userId: recipient.userId,
                type: "MEDICATION_DUE",
                elderId: medication.elderId,
                title: `${medication.elder.displayName} is due to take ${medication.name}`,
                body: `${medication.dosage} — due at ${dueAt}.`,
                metadata: {
                  medicationId: medication.id,
                  scheduledFor: dose.scheduledFor.toISOString(),
                },
              }),
            ),
          );
        }

        realtimeBus.publish("medication.updated", {
          elderId: medication.elderId,
          elderName: medication.elder.displayName,
          medicationId: medication.id,
          doseKey: `${medication.id}:${key}`,
          status: "PENDING",
        });

        log.info(
          { medicationId: medication.id, scheduledFor: key },
          "medication reminder sent",
        );
        continue;
      }

      // ---- 2. Missed dose ------------------------------------------------
      const overdue = dose.scheduledFor.getTime() < now.getTime() - graceMs;
      if (overdue && (!existing || existing.status === "PENDING")) {
        await prisma.medicationLog.upsert({
          where: {
            medicationId_scheduledFor: {
              medicationId: medication.id,
              scheduledFor: dose.scheduledFor,
            },
          },
          create: {
            medicationId: medication.id,
            scheduledFor: dose.scheduledFor,
            status: "MISSED",
            remindedAt: now,
          },
          update: { status: "MISSED" },
        });

        if (medication.notifyCaregivers) {
          const { caregivers } = await resolveElderRecipients(medication.elderId);
          await Promise.all(
            caregivers.map((recipient) =>
              notify({
                userId: recipient.userId,
                type: "MEDICATION_MISSED",
                elderId: medication.elderId,
                title: `${medication.elder.displayName} may have missed ${medication.name}`,
                body: `${medication.dosage} was due at ${dueAt}.`,
                metadata: { medicationId: medication.id },
              }),
            ),
          );
        }

        realtimeBus.publish("medication.updated", {
          elderId: medication.elderId,
          elderName: medication.elder.displayName,
          medicationId: medication.id,
          doseKey: `${medication.id}:${key}`,
          status: "MISSED",
        });

        log.warn({ medicationId: medication.id, scheduledFor: key }, "medication dose missed");
      }
    }
  }
}

/**
 * Helper used by the dashboard: the doses that are due today for an elder.
 * Kept here so that the schedule logic lives in exactly one place.
 */
export async function dosesDueToday(elderId: string, timeZone: string) {
  const now = new Date();
  const from = startOfLocalDay(now, timeZone);
  const to = endOfLocalDay(now, timeZone);

  const medications = await prisma.medication.findMany({
    where: { elderId, active: true },
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
  });

  return medications.flatMap((medication) => expandDoses(medication, from, to, timeZone));
}

/** Utility re-exported for the watchdog job. */
export const localDateKey = getLocalDateKey;
