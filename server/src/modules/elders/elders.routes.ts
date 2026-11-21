import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ok } from "../../lib/http.js";
import { getElderAccess } from "../../lib/access.js";
import { encryptNullable, decryptNullable } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validate, validatedBody, validatedParams } from "../../middleware/validate.js";
import { idParamSchema } from "../../lib/validation.js";
import { updateElderSchema, type UpdateElderInput } from "./elders.schemas.js";
import { buildDashboardSummaries, buildElderSummary } from "./elders.service.js";

export const eldersRouter = Router();

eldersRouter.use(authenticate);

/** GET /api/v1/elders — every elder the caller may read. */
eldersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const summaries = await buildDashboardSummaries(req.auth!);
    ok(res, summaries);
  }),
);

/** GET /api/v1/elders/:id — the full profile of one elder. */
eldersRouter.get(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const { elder, link, isOwner } = await getElderAccess(req.auth!, id, "view");

    ok(res, {
      ...elder,
      medicalNotes: decryptNullable(elder.medicalNotes),
      relation: link?.relation ?? (isOwner ? "SELF" : null),
      permissions: {
        canViewVitals: isOwner || Boolean(link?.canViewVitals),
        canManageMedicines: isOwner || Boolean(link?.canManageMedicines),
        canManageContacts: isOwner || Boolean(link?.canManageContacts),
        canAcknowledgeSos: isOwner || Boolean(link?.canAcknowledgeSos),
      },
    });
  }),
);

/** PATCH /api/v1/elders/:id — update the health profile. */
eldersRouter.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateElderSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const input = validatedBody<UpdateElderInput>(req);

    const { elder, isOwner } = await getElderAccess(req.auth!, id, "view");

    // Only the senior themselves may edit the clinical profile. A family
    // member can suggest changes, but must not be able to overwrite the
    // medical record.
    if (!isOwner) {
      res.status(403).json({
        type: "https://seniorcare.app/problems/forbidden",
        title: "ForbiddenError",
        status: 403,
        detail: "Only the person themselves can edit their health profile.",
        code: "forbidden",
        requestId: req.requestId,
      });
      return;
    }

    const updated = await prisma.elder.update({
      where: { id: elder.id },
      data: {
        displayName: input.displayName ?? undefined,
        dateOfBirth: input.dateOfBirth === undefined ? undefined : input.dateOfBirth,
        bloodType: input.bloodType ?? undefined,
        conditions: input.conditions ?? undefined,
        allergies: input.allergies ?? undefined,
        medicalNotes:
          input.medicalNotes === undefined
            ? undefined
            : encryptNullable(input.medicalNotes),
        photoUrl: input.photoUrl === undefined ? undefined : input.photoUrl,
        checkInDeadlineHour: input.checkInDeadlineHour ?? undefined,
        canTriggerSos: input.canTriggerSos ?? undefined,
      },
    });

    if (input.timeZone) {
      await prisma.user.update({
        where: { id: req.auth!.userId },
        data: { timeZone: input.timeZone },
      });
    }

    ok(res, { ...updated, medicalNotes: decryptNullable(updated.medicalNotes) });
  }),
);

/** GET /api/v1/elders/:id/summary — the dashboard payload for one elder. */
eldersRouter.get(
  "/:id/summary",
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const { elder } = await getElderAccess(req.auth!, id, "view");

    const summary = await buildElderSummary(elder.id, elder.user.timeZone || "UTC");
    ok(res, summary);
  }),
);
