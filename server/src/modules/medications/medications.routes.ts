import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { created, ok } from "../../lib/http.js";
import { getElderAccess } from "../../lib/access.js";
import { encryptNullable, decryptNullable } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate.js";
import { uuidSchema } from "../../lib/validation.js";
import { expandDoses } from "../../lib/schedule.js";
import { startOfLocalDay } from "../../lib/time.js";
import { realtimeBus } from "../../realtime/bus.js";
import {
  createMedicationSchema,
  elderIdParamSchema,
  medicationItemParamSchema,
  recordDoseSchema,
  scheduleQuerySchema,
  updateMedicationSchema,
  type CreateMedicationInput,
  type RecordDoseInput,
  type ScheduleQuery,
  type UpdateMedicationInput,
} from "./medications.schemas.js";

/** Routes mounted under `/elders/:elderId/medications`. */
export const medicationsRouter = Router({ mergeParams: true });
/** Routes mounted under `/medications`. */
export const medicationItemRouter = Router();

medicationsRouter.use(authenticate);
medicationItemRouter.use(authenticate);

const MEDICATION_SELECT = {
  id: true,
  elderId: true,
  name: true,
  dosage: true,
  instructions: true,
  activeIngredient: true,
  scheduleType: true,
  times: true,
  daysOfWeek: true,
  intervalMinutes: true,
  startDate: true,
  endDate: true,
  active: true,
  notifyCaregivers: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** GET /api/v1/elders/:elderId/medications — the medication list. */
medicationsRouter.get(
  "/",
  validate({ params: elderIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const medications = await prisma.medication.findMany({
      where: { elderId: elder.id },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: MEDICATION_SELECT,
    });

    ok(
      res,
      medications.map((medication) => ({
        ...medication,
        instructions: decryptNullable(medication.instructions),
      })),
    );
  }),
);

/** POST /api/v1/elders/:elderId/medications — create a medication. */
medicationsRouter.post(
  "/",
  validate({ params: elderIdParamSchema, body: createMedicationSchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const input = validatedBody<CreateMedicationInput>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "manage_medications");

    const medication = await prisma.medication.create({
      data: {
        elderId: elder.id,
        name: input.name,
        dosage: input.dosage,
        instructions: encryptNullable(input.instructions),
        activeIngredient: input.activeIngredient ?? null,
        scheduleType: input.scheduleType,
        times: input.times,
        daysOfWeek: input.daysOfWeek,
        intervalMinutes: input.intervalMinutes ?? null,
        startDate: input.startDate ?? new Date(),
        endDate: input.endDate ?? null,
        notifyCaregivers: input.notifyCaregivers,
      },
      select: MEDICATION_SELECT,
    });

    realtimeBus.publish("medication.updated", {
      elderId: elder.id,
      elderName: elder.displayName,
      medicationId: medication.id,
    });

    created(res, { ...medication, instructions: decryptNullable(medication.instructions) });
  }),
);

/**
 * GET /api/v1/elders/:elderId/medications/schedule
 *
 * Expands the medication plan into concrete doses for the requested window
 * and joins them with the recorded dose state.
 */
medicationsRouter.get(
  "/schedule",
  validate({ params: elderIdParamSchema, query: scheduleQuerySchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const query = validatedQuery<ScheduleQuery>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "view");
    const timeZone = elder.user.timeZone || "UTC";

    const now = new Date();
    const from = startOfLocalDay(now, timeZone);
    const to = new Date(from.getTime() + query.days * 24 * 60 * 60 * 1000);

    const [medications, logs] = await Promise.all([
      prisma.medication.findMany({
        where: { elderId: elder.id, active: true },
        select: MEDICATION_SELECT,
      }),
      prisma.medicationLog.findMany({
        where: {
          medication: { elderId: elder.id },
          scheduledFor: { gte: from, lte: to },
        },
        select: {
          id: true,
          medicationId: true,
          scheduledFor: true,
          status: true,
          takenAt: true,
          note: true,
          remindedAt: true,
        },
      }),
    ]);

    const logByKey = new Map(
      logs.map((log) => [`${log.medicationId}:${log.scheduledFor.toISOString()}`, log]),
    );

    const doses = medications
      .flatMap((medication) => expandDoses(medication, from, to, timeZone))
      .map((dose) => {
        const log = logByKey.get(dose.key);
        return {
          key: dose.key,
          medicationId: dose.medicationId,
          medicationName: dose.medicationName,
          dosage: dose.dosage,
          scheduledFor: dose.scheduledFor,
          status: log?.status ?? "PENDING",
          takenAt: log?.takenAt ?? null,
          note: log?.note ?? null,
          remindedAt: log?.remindedAt ?? null,
        };
      })
      .filter((dose) => (query.includePast ? true : dose.scheduledFor >= now));

    ok(res, {
      timeZone,
      from,
      to,
      doses,
      adherence: {
        taken: doses.filter((dose) => dose.status === "TAKEN").length,
        skipped: doses.filter((dose) => dose.status === "SKIPPED").length,
        missed: doses.filter((dose) => dose.status === "MISSED").length,
        pending: doses.filter((dose) => dose.status === "PENDING").length,
      },
    });
  }),
);

/**
 * POST /api/v1/elders/:elderId/medications/:medicationId/doses
 *
 * Records that a dose was taken or skipped.
 */
medicationsRouter.post(
  "/:medicationId/doses",
  validate({
    // Both parameters are needed: Zod strips unknown keys, so `elderId`
    // must be declared here as well or it would be dropped.
    params: z.object({ elderId: uuidSchema, medicationId: uuidSchema }),
    body: recordDoseSchema,
  }),
  asyncHandler(async (req, res) => {
    const { elderId, medicationId } = validatedParams<{
      elderId: string;
      medicationId: string;
    }>(req);
    const input = validatedBody<RecordDoseInput>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const medication = await prisma.medication.findFirst({
      where: { id: medicationId, elderId: elder.id },
      select: { id: true, name: true },
    });

    if (!medication) {
      res.status(404).json({
        type: "https://seniorcare.app/problems/not_found",
        title: "NotFoundError",
        status: 404,
        detail: "That medication was not found.",
        code: "not_found",
        requestId: req.requestId,
      });
      return;
    }

    const scheduledFor = new Date(input.scheduledFor);
    const log = await prisma.medicationLog.upsert({
      where: {
        medicationId_scheduledFor: { medicationId: medication.id, scheduledFor },
      },
      create: {
        medicationId: medication.id,
        scheduledFor,
        status: input.status,
        takenAt: input.status === "TAKEN" ? new Date() : null,
        note: input.note ?? null,
      },
      update: {
        status: input.status,
        takenAt: input.status === "TAKEN" ? new Date() : null,
        note: input.note ?? null,
      },
    });

    realtimeBus.publish("medication.updated", {
      elderId: elder.id,
      elderName: elder.displayName,
      medicationId: medication.id,
      doseKey: `${medication.id}:${scheduledFor.toISOString()}`,
      status: log.status,
    });

    ok(res, log);
  }),
);

/** PATCH /api/v1/medications/:id — update a medication. */
medicationItemRouter.patch(
  "/:id",
  validate({ params: medicationItemParamSchema, body: updateMedicationSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const input = validatedBody<UpdateMedicationInput>(req);

    const existing = await prisma.medication.findUnique({
      where: { id },
      select: { id: true, elderId: true, name: true },
    });

    if (!existing) {
      res.status(404).json({
        type: "https://seniorcare.app/problems/not_found",
        title: "NotFoundError",
        status: 404,
        detail: "That medication was not found.",
        code: "not_found",
        requestId: req.requestId,
      });
      return;
    }

    const { elder } = await getElderAccess(req.auth!, existing.elderId, "manage_medications");

    const updated = await prisma.medication.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        dosage: input.dosage ?? undefined,
        instructions:
          input.instructions === undefined ? undefined : encryptNullable(input.instructions),
        activeIngredient: input.activeIngredient ?? undefined,
        scheduleType: input.scheduleType ?? undefined,
        times: input.times ?? undefined,
        daysOfWeek: input.daysOfWeek ?? undefined,
        intervalMinutes: input.intervalMinutes === undefined ? undefined : input.intervalMinutes,
        startDate: input.startDate ?? undefined,
        endDate: input.endDate === undefined ? undefined : input.endDate,
        notifyCaregivers: input.notifyCaregivers ?? undefined,
        active: input.active ?? undefined,
      },
      select: MEDICATION_SELECT,
    });

    realtimeBus.publish("medication.updated", {
      elderId: elder.id,
      elderName: elder.displayName,
      medicationId: updated.id,
    });

    ok(res, { ...updated, instructions: decryptNullable(updated.instructions) });
  }),
);

/** DELETE /api/v1/medications/:id — stop a medication (soft delete). */
medicationItemRouter.delete(
  "/:id",
  validate({ params: medicationItemParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);

    const existing = await prisma.medication.findUnique({
      where: { id },
      select: { id: true, elderId: true },
    });

    if (!existing) {
      res.status(404).json({
        type: "https://seniorcare.app/problems/not_found",
        title: "NotFoundError",
        status: 404,
        detail: "That medication was not found.",
        code: "not_found",
        requestId: req.requestId,
      });
      return;
    }

    await getElderAccess(req.auth!, existing.elderId, "manage_medications");

    const updated = await prisma.medication.update({
      where: { id },
      data: { active: false },
      select: MEDICATION_SELECT,
    });

    ok(res, updated);
  }),
);
