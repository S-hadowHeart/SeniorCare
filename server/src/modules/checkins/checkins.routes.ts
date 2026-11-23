import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { created, ok } from "../../lib/http.js";
import { getElderAccess } from "../../lib/access.js";
import { ForbiddenError } from "../../lib/errors.js";
import { encryptNullable, decryptNullable } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate.js";
import { endOfLocalDay, startOfLocalDay } from "../../lib/time.js";
import { realtimeBus } from "../../realtime/bus.js";
import { notify, resolveElderRecipients } from "../../notifications/service.js";
import { sendMail } from "../../notifications/mailer.js";
import { needsHelpEmail } from "../../notifications/templates.js";
import {
  createCheckInSchema,
  elderIdParamSchema,
  listCheckInsQuerySchema,
  type CreateCheckInInput,
  type ListCheckInsQuery,
} from "./checkins.schemas.js";

export const checkInsRouter = Router({ mergeParams: true });

checkInsRouter.use(authenticate);

/**
 * POST /api/v1/elders/:elderId/checkins
 *
 * Records the daily "I am safe" confirmation. A `NEEDS_HELP` status is
 * escalated to every caregiver straight away.
 */
checkInsRouter.post(
  "/",
  validate({ params: elderIdParamSchema, body: createCheckInSchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const input = validatedBody<CreateCheckInInput>(req);

    const { elder, isOwner } = await getElderAccess(req.auth!, elderId, "view");

    // The daily check-in is the senior's own safety confirmation. If a
    // caregiver could submit one on their behalf, it would silently satisfy
    // the missed check-in watchdog and hide a real emergency.
    if (!isOwner) {
      throw new ForbiddenError("Only the senior can record their own daily check-in.");
    }

    const checkIn = await prisma.checkIn.create({
      data: {
        elderId: elder.id,
        status: input.status,
        mood: input.mood ?? null,
        note: encryptNullable(input.note),
        createdAt: input.recordedAt ?? new Date(),
      },
    });

    realtimeBus.publish("checkin.created", {
      elderId: elder.id,
      elderName: elder.displayName,
      checkInId: checkIn.id,
      status: checkIn.status,
      createdAt: checkIn.createdAt.toISOString(),
    });

    if (input.status === "NEEDS_HELP") {
      const { caregivers, contacts } = await resolveElderRecipients(elder.id);

      await Promise.all(
        caregivers.map((recipient) =>
          notify({
            userId: recipient.userId,
            type: "CHECK_IN_NEEDS_HELP",
            elderId: elder.id,
            title: `${elder.displayName} says they need help`,
            body: input.note
              ? `They wrote: "${input.note}"`
              : "They confirmed their daily check-in and asked for help.",
          }),
        ),
      );

      // Contacts without an account still receive an e-mail.
      const email = needsHelpEmail({
        elderName: elder.displayName,
        note: input.note ?? null,
      });

      await Promise.all(
        contacts.map(async (contact) => {
          if (!contact.email) return;
          await sendMail({
            to: contact.email,
            subject: email.subject,
            html: email.html,
            text: email.text,
          });
        }),
      );
    }

    created(res, {
      ...checkIn,
      note: decryptNullable(checkIn.note),
    });
  }),
);

/** GET /api/v1/elders/:elderId/checkins — the check-in history. */
checkInsRouter.get(
  "/",
  validate({ params: elderIdParamSchema, query: listCheckInsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const query = validatedQuery<ListCheckInsQuery>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);

    const checkIns = await prisma.checkIn.findMany({
      where: { elderId: elder.id, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: query.limit,
      select: {
        id: true,
        status: true,
        mood: true,
        note: true,
        autoEscalated: true,
        createdAt: true,
      },
    });

    ok(
      res,
      checkIns.map((checkIn) => ({ ...checkIn, note: decryptNullable(checkIn.note) })),
      { days: query.days },
    );
  }),
);

/** GET /api/v1/elders/:elderId/checkins/today — today's status. */
checkInsRouter.get(
  "/today",
  validate({ params: elderIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const timeZone = elder.user.timeZone || "UTC";
    const dayStart = startOfLocalDay(new Date(), timeZone);
    const dayEnd = endOfLocalDay(new Date(), timeZone);

    const checkIn = await prisma.checkIn.findFirst({
      where: { elderId: elder.id, createdAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: "desc" },
    });

    ok(res, {
      checkedInToday: Boolean(checkIn && checkIn.status !== "MISSED"),
      checkIn: checkIn ? { ...checkIn, note: decryptNullable(checkIn.note) } : null,
      dayStart,
      dayEnd,
    });
  }),
);
