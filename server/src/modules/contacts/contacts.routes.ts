import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { created, ok } from "../../lib/http.js";
import { getElderAccess } from "../../lib/access.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validate, validatedBody, validatedParams } from "../../middleware/validate.js";
import { writeAuditLog } from "../audit/audit.service.js";
import {
  contactIdParamSchema,
  createContactSchema,
  elderIdParamSchema,
  updateContactSchema,
  type CreateContactInput,
  type UpdateContactInput,
} from "./contacts.schemas.js";

export const contactsRouter = Router({ mergeParams: true });
export const contactItemRouter = Router();

contactsRouter.use(authenticate);
contactItemRouter.use(authenticate);

/** GET /api/v1/elders/:elderId/contacts — emergency contacts. */
contactsRouter.get(
  "/",
  validate({ params: elderIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const contacts = await prisma.emergencyContact.findMany({
      where: { elderId: elder.id },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    });

    ok(res, contacts);
  }),
);

/** POST /api/v1/elders/:elderId/contacts — register an emergency contact. */
contactsRouter.post(
  "/",
  validate({ params: elderIdParamSchema, body: createContactSchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const input = validatedBody<CreateContactInput>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "manage_contacts");

    const contact = await prisma.emergencyContact.create({
      data: {
        elderId: elder.id,
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        relation: input.relation,
        priority: input.priority,
        isDoctor: input.isDoctor || input.relation === "DOCTOR",
        receivesMedicationReminders: input.receivesMedicationReminders,
        receivesMissedCheckInAlerts: input.receivesMissedCheckInAlerts,
        notes: input.notes ?? null,
      },
    });

    await writeAuditLog({
      actorId: req.auth!.userId,
      action: "contact.created",
      entity: "EmergencyContact",
      entityId: contact.id,
      ipAddress: req.ip,
      metadata: { elderId: elder.id },
    });

    created(res, contact);
  }),
);

/** PATCH /api/v1/contacts/:id — update an emergency contact. */
contactItemRouter.patch(
  "/:id",
  validate({ params: contactIdParamSchema, body: updateContactSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const input = validatedBody<UpdateContactInput>(req);

    const existing = await prisma.emergencyContact.findUnique({
      where: { id },
      select: { id: true, elderId: true },
    });

    if (!existing) {
      res.status(404).json({
        type: "https://seniorcare.app/problems/not_found",
        title: "NotFoundError",
        status: 404,
        detail: "That contact was not found.",
        code: "not_found",
        requestId: req.requestId,
      });
      return;
    }

    await getElderAccess(req.auth!, existing.elderId, "manage_contacts");

    const contact = await prisma.emergencyContact.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        phone: input.phone ?? undefined,
        email: input.email === undefined ? undefined : input.email,
        relation: input.relation ?? undefined,
        priority: input.priority ?? undefined,
        isDoctor: input.isDoctor ?? undefined,
        receivesMedicationReminders: input.receivesMedicationReminders ?? undefined,
        receivesMissedCheckInAlerts: input.receivesMissedCheckInAlerts ?? undefined,
        notes: input.notes === undefined ? undefined : input.notes,
        isActive: input.isActive ?? undefined,
      },
    });

    ok(res, contact);
  }),
);

/** DELETE /api/v1/contacts/:id — remove an emergency contact. */
contactItemRouter.delete(
  "/:id",
  validate({ params: contactIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);

    const existing = await prisma.emergencyContact.findUnique({
      where: { id },
      select: { id: true, elderId: true },
    });

    if (!existing) {
      res.status(404).json({
        type: "https://seniorcare.app/problems/not_found",
        title: "NotFoundError",
        status: 404,
        detail: "That contact was not found.",
        code: "not_found",
        requestId: req.requestId,
      });
      return;
    }

    await getElderAccess(req.auth!, existing.elderId, "manage_contacts");

    await prisma.emergencyContact.delete({ where: { id } });

    ok(res, { id, deleted: true });
  }),
);
