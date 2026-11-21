import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { created, ok } from "../../lib/http.js";
import { getElderAccess, listAccessibleElders } from "../../lib/access.js";
import { ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate.js";
import { sosLimiter } from "../../middleware/rateLimit.js";
import { realtimeBus } from "../../realtime/bus.js";
import { notify, resolveElderRecipients } from "../../notifications/service.js";
import { sendMail } from "../../notifications/mailer.js";
import { sosAlertEmail } from "../../notifications/templates.js";
import { writeAuditLog } from "../auth/auth.service.js";
import {
  elderIdParamSchema,
  resolveSosSchema,
  sosIdParamSchema,
  sosListQuerySchema,
  triggerSosSchema,
  type SosListQuery,
  type TriggerSosInput,
} from "./sos.schemas.js";

export const sosRouter = Router({ mergeParams: true });
export const sosItemRouter = Router();

sosRouter.use(authenticate);
sosItemRouter.use(authenticate);

/** A false alarm can be cancelled within this window. */
const CANCEL_GRACE_MINUTES = 15;
/** A second press within this window returns the existing alert. */
const DEDUPE_WINDOW_MS = 120_000;

function buildMapUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

/**
 * POST /api/v1/elders/:elderId/sos
 *
 * Raises an emergency alert. Every caregiver and emergency contact is
 * notified immediately (in-app + e-mail) and the location is attached when
 * the browser was able to share it.
 */
sosRouter.post(
  "/",
  sosLimiter,
  validate({ params: elderIdParamSchema, body: triggerSosSchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const input = validatedBody<TriggerSosInput>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    if (!elder.canTriggerSos && elder.userId !== req.auth!.userId) {
      throw new ForbiddenError("SOS alerts are disabled for this care record.");
    }

    // Idempotency: a stuck button must not create a flood of alerts.
    const recent = await prisma.sosAlert.findFirst({
      where: {
        elderId: elder.id,
        status: { in: ["ACTIVE", "ACKNOWLEDGED"] },
        createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
    });

    if (recent) {
      ok(res, { ...recent, deduplicated: true });
      return;
    }

    const alert = await prisma.sosAlert.create({
      data: {
        elderId: elder.id,
        triggeredByUserId: req.auth!.userId,
        status: "ACTIVE",
        message: input.message ?? null,
        latitude: input.location?.latitude ?? null,
        longitude: input.location?.longitude ?? null,
        accuracy: input.location?.accuracy ?? null,
        locationSource: input.location?.source ?? null,
        locationLabel: input.location?.label ?? null,
      },
    });

    if (input.location) {
      await prisma.locationPing.create({
        data: {
          elderId: elder.id,
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          accuracy: input.location.accuracy ?? null,
          source: input.location.source,
          label: input.location.label ?? null,
        },
      });
    }

    await writeAuditLog({
      actorId: req.auth!.userId,
      action: "sos.triggered",
      entity: "SosAlert",
      entityId: alert.id,
      ipAddress: req.ip,
      userAgent: req.header("user-agent"),
      metadata: { elderId: elder.id, hasLocation: Boolean(input.location) },
    });

    // --- Notify caregivers (in-app + e-mail) ----------------------------
    const { caregivers, contacts } = await resolveElderRecipients(elder.id);

    const mapUrl =
      alert.latitude !== null && alert.longitude !== null
        ? buildMapUrl(alert.latitude, alert.longitude)
        : null;

    const email = sosAlertEmail({
      elderName: elder.displayName,
      message: alert.message,
      locationUrl: mapUrl,
      occurredAt: alert.createdAt,
    });

    await Promise.all(
      caregivers.map((recipient) =>
        notify({
          userId: recipient.userId,
          type: "SOS_TRIGGERED",
          elderId: elder.id,
          sosAlertId: alert.id,
          title: `SOS — ${elder.displayName} needs help`,
          body: input.message ?? "An emergency alert was triggered.",
          metadata: {
            alertId: alert.id,
            mapUrl,
            latitude: alert.latitude,
            longitude: alert.longitude,
          },
          email,
        }),
      ),
    );

    // Emergency contacts that have no account receive the e-mail directly.
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

    realtimeBus.publish("sos.triggered", {
      elderId: elder.id,
      elderName: elder.displayName,
      alertId: alert.id,
      message: alert.message,
      location:
        alert.latitude !== null && alert.longitude !== null
          ? { latitude: alert.latitude, longitude: alert.longitude, label: alert.locationLabel }
          : null,
    });

    created(res, { ...alert, mapUrl });
  }),
);

/** GET /api/v1/elders/:elderId/sos — the alert history. */
sosRouter.get(
  "/",
  validate({ params: elderIdParamSchema, query: sosListQuerySchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const query = validatedQuery<SosListQuery>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const alerts = await prisma.sosAlert.findMany({
      where: {
        elderId: elder.id,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
    });

    ok(
      res,
      alerts.map((alert) => ({
        ...alert,
        mapUrl:
          alert.latitude !== null && alert.longitude !== null
            ? buildMapUrl(alert.latitude, alert.longitude)
            : null,
      })),
    );
  }),
);

/** GET /api/v1/sos/active — every active alert across the caller's elders. */
export const sosActiveRouter = Router();

sosActiveRouter.use(authenticate);

sosActiveRouter.get(
  "/active",
  asyncHandler(async (req, res) => {
    const accessible = await listAccessibleElders(req.auth!);

    if (accessible.length === 0) {
      ok(res, []);
      return;
    }

    const alerts = await prisma.sosAlert.findMany({
      where: {
        elderId: { in: accessible.map((item) => item.elder.id) },
        status: { in: ["ACTIVE", "ACKNOWLEDGED"] },
      },
      orderBy: { createdAt: "desc" },
      include: { elder: { select: { displayName: true } } },
    });

    ok(
      res,
      alerts.map((alert) => ({
        ...alert,
        elderName: alert.elder.displayName,
        mapUrl:
          alert.latitude !== null && alert.longitude !== null
            ? buildMapUrl(alert.latitude, alert.longitude)
            : null,
      })),
    );
  }),
);

/** POST /api/v1/sos/:id/acknowledge — a caregiver confirms they are on it. */
sosItemRouter.post(
  "/:id/acknowledge",
  validate({ params: sosIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);

    const alert = await prisma.sosAlert.findUnique({
      where: { id },
      select: { id: true, elderId: true, status: true },
    });

    if (!alert) throw new NotFoundError("That emergency alert", "sos_not_found");

    const { elder } = await getElderAccess(req.auth!, alert.elderId, "acknowledge_sos");

    if (alert.status === "RESOLVED" || alert.status === "CANCELLED") {
      throw new ForbiddenError("This alert has already been closed.");
    }

    const updated = await prisma.sosAlert.update({
      where: { id },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedAt: new Date(),
        acknowledgedById: req.auth!.userId,
      },
    });

    await notify({
      userId: elder.userId,
      type: "SOS_ACKNOWLEDGED",
      elderId: elder.id,
      sosAlertId: alert.id,
      title: "Help is on the way",
      body: `${req.auth!.name} acknowledged your emergency alert.`,
    });

    realtimeBus.publish("sos.updated", {
      elderId: elder.id,
      alertId: alert.id,
      status: updated.status,
    });

    ok(res, updated);
  }),
);

/** POST /api/v1/sos/:id/resolve — close the alert. */
sosItemRouter.post(
  "/:id/resolve",
  validate({ params: sosIdParamSchema, body: resolveSosSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const input = validatedBody<{ note?: string | null }>(req);

    const alert = await prisma.sosAlert.findUnique({
      where: { id },
      select: { id: true, elderId: true, status: true },
    });

    if (!alert) throw new NotFoundError("That emergency alert", "sos_not_found");

    const { elder } = await getElderAccess(req.auth!, alert.elderId, "acknowledge_sos");

    const updated = await prisma.sosAlert.update({
      where: { id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedById: req.auth!.userId,
        resolutionNote: input.note ?? null,
      },
    });

    await notify({
      userId: elder.userId,
      type: "SOS_RESOLVED",
      elderId: elder.id,
      sosAlertId: alert.id,
      title: "Your alert was closed",
      body: `${req.auth!.name} marked the emergency as resolved.`,
    });

    realtimeBus.publish("sos.updated", {
      elderId: elder.id,
      alertId: alert.id,
      status: updated.status,
    });

    ok(res, updated);
  }),
);

/**
 * POST /api/v1/sos/:id/cancel — the senior cancels a false alarm.
 * Only allowed within the grace window and only by the person themselves.
 */
sosItemRouter.post(
  "/:id/cancel",
  validate({ params: sosIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);

    const alert = await prisma.sosAlert.findUnique({
      where: { id },
      select: { id: true, elderId: true, status: true, createdAt: true },
    });

    if (!alert) throw new NotFoundError("That emergency alert", "sos_not_found");

    const { elder } = await getElderAccess(req.auth!, alert.elderId, "view");

    if (elder.userId !== req.auth!.userId) {
      throw new ForbiddenError("Only the person who raised the alert can cancel it.");
    }

    const ageMinutes = (Date.now() - alert.createdAt.getTime()) / 60_000;
    if (ageMinutes > CANCEL_GRACE_MINUTES) {
      throw new ForbiddenError(
        `An alert can only be cancelled within ${CANCEL_GRACE_MINUTES} minutes.`,
      );
    }

    if (alert.status === "RESOLVED" || alert.status === "CANCELLED") {
      throw new ForbiddenError("This alert has already been closed.");
    }

    const updated = await prisma.sosAlert.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    realtimeBus.publish("sos.updated", {
      elderId: elder.id,
      alertId: alert.id,
      status: updated.status,
    });

    ok(res, updated);
  }),
);
