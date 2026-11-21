import { env } from "../config/env.js";
import { childLogger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { endOfLocalDay, getZonedParts, startOfLocalDay } from "../lib/time.js";
import { notify, resolveElderRecipients } from "../notifications/service.js";
import { sendMail } from "../notifications/mailer.js";
import { missedCheckInEmail } from "../notifications/templates.js";
import { realtimeBus } from "../realtime/bus.js";

const log = childLogger("job:checkin-watchdog");

/**
 * Daily check-in watchdog.
 *
 * If a senior has not confirmed that they are safe before their personal
 * deadline hour, the absence itself becomes an alert:
 *
 *  - a synthetic `MISSED` check-in is recorded (flagged `autoEscalated`);
 *  - the caregivers receive an in-app notification and an e-mail;
 *  - the emergency contacts that opted in are e-mailed as well.
 *
 * The job is idempotent: the synthetic check-in for the day is only created
 * once, so re-running the job never produces duplicate alerts.
 */
export async function runCheckInWatchdogJob(): Promise<void> {
  const now = new Date();

  const elders = await prisma.elder.findMany({
    select: {
      id: true,
      displayName: true,
      checkInDeadlineHour: true,
      userId: true,
      user: { select: { id: true, name: true, email: true, timeZone: true } },
    },
  });

  for (const elder of elders) {
    const timeZone = elder.user.timeZone || "UTC";
    const { hour } = getZonedParts(now, timeZone);

    if (hour < elder.checkInDeadlineHour) continue;

    const dayStart = startOfLocalDay(now, timeZone);
    const dayEnd = endOfLocalDay(now, timeZone);

    const todaysCheckIns = await prisma.checkIn.findMany({
      where: { elderId: elder.id, createdAt: { gte: dayStart, lte: dayEnd } },
      select: { id: true, status: true },
    });

    const confirmed = todaysCheckIns.some((checkIn) => checkIn.status !== "MISSED");
    if (confirmed) continue;

    const alreadyEscalated = todaysCheckIns.some((checkIn) => checkIn.status === "MISSED");
    if (alreadyEscalated) continue;

    await prisma.checkIn.create({
      data: {
        elderId: elder.id,
        status: "MISSED",
        autoEscalated: true,
        note: "No safety check-in was recorded before the daily deadline.",
      },
    });

    const { caregivers } = await resolveElderRecipients(elder.id);

    await Promise.all(
      caregivers.map((recipient) =>
        notify({
          userId: recipient.userId,
          type: "CHECK_IN_MISSED",
          elderId: elder.id,
          title: `${elder.displayName} has not checked in`,
          body: `No safety confirmation was recorded before ${String(elder.checkInDeadlineHour).padStart(2, "0")}:00.`,
        }),
      ),
    );

    const email = missedCheckInEmail({
      elderName: elder.displayName,
      deadlineHour: elder.checkInDeadlineHour,
    });

    const optedInContacts = await prisma.emergencyContact.findMany({
      where: { elderId: elder.id, isActive: true, receivesMissedCheckInAlerts: true, email: { not: null } },
      select: { email: true },
    });

    await Promise.all(
      optedInContacts.map((contact) => {
        if (!contact.email) return Promise.resolve();
        return sendMail({
          to: contact.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
        });
      }),
    );

    realtimeBus.publish("checkin.created", {
      elderId: elder.id,
      elderName: elder.displayName,
      checkInId: "",
      status: "MISSED",
      createdAt: now.toISOString(),
    });

    log.warn({ elderId: elder.id, deadlineHour: elder.checkInDeadlineHour }, "missed daily check-in");
  }
}

/** The hour (local time) before which the watchdog must not fire. */
export const WATCHDOG_DEADLINE_HOUR = env.CHECKIN_DEADLINE_HOUR;
