import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { created, ok } from "../../lib/http.js";
import { getElderAccess, listAccessibleElders } from "../../lib/access.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../lib/errors.js";
import { normalizeEmail } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validate, validatedBody, validatedParams } from "../../middleware/validate.js";
import { realtimeBus } from "../../realtime/bus.js";
import { notify } from "../../notifications/service.js";
import { writeAuditLog } from "../auth/auth.service.js";
import {
  elderIdParamSchema,
  inviteCaregiverSchema,
  linkIdParamSchema,
  updateLinkSchema,
  type InviteCaregiverInput,
  type UpdateLinkInput,
} from "./careLinks.schemas.js";

export const careLinksRouter = Router({ mergeParams: true });
export const careLinkItemRouter = Router();

careLinksRouter.use(authenticate);
careLinkItemRouter.use(authenticate);

const LINK_SELECT = {
  id: true,
  elderId: true,
  caregiverId: true,
  invitedEmail: true,
  relation: true,
  status: true,
  isPrimary: true,
  canViewVitals: true,
  canManageMedicines: true,
  canManageContacts: true,
  canAcknowledgeSos: true,
  invitedAt: true,
  acceptedAt: true,
  revokedAt: true,
  caregiver: { select: { id: true, name: true, email: true } },
} as const;

/** GET /api/v1/elders/:elderId/care-links — who can see this person's data. */
careLinksRouter.get(
  "/",
  validate({ params: elderIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const links = await prisma.careLink.findMany({
      where: { elderId: elder.id },
      orderBy: [{ status: "asc" }, { invitedAt: "asc" }],
      select: LINK_SELECT,
    });

    ok(res, links);
  }),
);

/**
 * POST /api/v1/elders/:elderId/care-links
 *
 * Grants a family member or professional caregiver access to the care record.
 * If the person already has an account the link is created immediately;
 * otherwise a pending invitation is stored and can be accepted after they
 * sign up.
 */
careLinksRouter.post(
  "/",
  validate({ params: elderIdParamSchema, body: inviteCaregiverSchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const input = validatedBody<InviteCaregiverInput>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "manage_caregivers");

    const email = normalizeEmail(input.email);

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, role: true },
    });

    if (existingUser?.id === elder.userId) {
      throw new ValidationError({ field: "email" }, "You cannot link the account to itself.");
    }

    // Reject a duplicate invitation or an active link for the same person, but
    // allow somebody whose access was revoked to be invited again.
    const existingLink = await prisma.careLink.findFirst({
      where: {
        elderId: elder.id,
        OR: [
          ...(existingUser ? [{ caregiverId: existingUser.id }] : []),
          { invitedEmail: email },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });

    if (existingLink && existingLink.status !== "REVOKED") {
      throw new ConflictError("That person already has access to this care record.");
    }

    const linkData = {
      caregiverId: existingUser?.id ?? null,
      invitedEmail: email,
      relation: input.relation,
      status: existingUser ? ("ACTIVE" as const) : ("PENDING" as const),
      isPrimary: input.isPrimary,
      canViewVitals: input.canViewVitals,
      canManageMedicines: input.canManageMedicines,
      canManageContacts: input.canManageContacts,
      canAcknowledgeSos: input.canAcknowledgeSos,
      invitedAt: new Date(),
      acceptedAt: existingUser ? new Date() : null,
      revokedAt: null,
    };

    const link = existingLink
      ? await prisma.careLink.update({
          where: { id: existingLink.id },
          data: linkData,
          select: LINK_SELECT,
        })
      : await prisma.careLink.create({
          data: { elderId: elder.id, ...linkData },
          select: LINK_SELECT,
        });

    await writeAuditLog({
      actorId: req.auth!.userId,
      action: "careLink.created",
      entity: "CareLink",
      entityId: link.id,
      ipAddress: req.ip,
      metadata: { elderId: elder.id, email },
    });

    if (existingUser) {
      await notify({
        userId: existingUser.id,
        type: "CARE_LINK_INVITED",
        elderId: elder.id,
        title: `You can now follow ${elder.displayName}'s health`,
        body: `${req.auth!.name} gave you access to ${elder.displayName}'s care record.`,
        metadata: { careLinkId: link.id },
      });

      realtimeBus.publish("link.updated", {
        elderId: elder.id,
        caregiverId: existingUser.id,
        status: link.status,
      });
    }

    created(res, {
      ...link,
      pending: !existingUser,
      message: existingUser
        ? "Access granted."
        : "Invitation recorded. They can accept it once they create an account with that e-mail address.",
    });
  }),
);

/**
 * PATCH /api/v1/care-links/:id
 *
 * Accept a pending invitation or adjust the permissions of an active link.
 */
careLinkItemRouter.patch(
  "/:id",
  validate({ params: linkIdParamSchema, body: updateLinkSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const input = validatedBody<UpdateLinkInput>(req);

    const link = await prisma.careLink.findUnique({
      where: { id },
      include: { elder: { select: { id: true, displayName: true, userId: true } } },
    });

    if (!link) {
      throw new NotFoundError("That care link", "care_link_not_found");
    }

    const actorId = req.auth!.userId;
    const isOwner = link.elder.userId === actorId;
    const isCaregiver = link.caregiverId === actorId;
    // A pending invitation belongs to whoever the e-mail address belongs to,
    // even though the link has no caregiverId yet.
    const isInvitee =
      link.status === "PENDING" &&
      Boolean(link.invitedEmail) &&
      link.invitedEmail === normalizeEmail(req.auth!.email);

    if (!isOwner && !isCaregiver && !isInvitee) {
      throw new NotFoundError("That care link", "care_link_not_found");
    }

    // A pending invitation is accepted by the invited person, or by the
    // owner when the invited e-mail already matches an account.
    if (link.status === "PENDING") {
      const invitedUser = await prisma.user.findUnique({
        where: { email: link.invitedEmail ?? "" },
        select: { id: true },
      });

      if (!invitedUser) {
        throw new ConflictError("No account exists for that e-mail address yet.");
      }

      const updated = await prisma.careLink.update({
        where: { id },
        data: { caregiverId: invitedUser.id, status: "ACTIVE", acceptedAt: new Date() },
        select: LINK_SELECT,
      });

      await notify({
        userId: invitedUser.id,
        type: "CARE_LINK_INVITED",
        elderId: link.elderId,
        title: `You can now follow ${link.elder.displayName}'s health`,
        body: "Your access to this care record is active.",
      });

      realtimeBus.publish("link.updated", {
        elderId: link.elderId,
        caregiverId: invitedUser.id,
        status: "ACTIVE",
      });

      ok(res, updated);
      return;
    }

    // Owners manage the permissions; caregivers may only revoke themselves.
    // Any other body (including an empty one) is a permission change, which is
    // reserved for the owner — silently revoking the caller would be a
    // surprising and destructive way to answer an unauthorised request.
    if (!isOwner) {
      if (input.status !== "REVOKED") {
        throw new ForbiddenError(
          "Only the account owner can change a care link's permissions.",
        );
      }

      const revoked = await prisma.careLink.update({
        where: { id },
        data: { status: "REVOKED", revokedAt: new Date() },
        select: LINK_SELECT,
      });

      realtimeBus.publish("link.updated", {
        elderId: revoked.elderId,
        caregiverId: revoked.caregiverId,
        status: "REVOKED",
      });

      ok(res, revoked);
      return;
    }

    const updated = await prisma.careLink.update({
      where: { id },
      data: {
        status: input.status ?? undefined,
        revokedAt: input.status === "REVOKED" ? new Date() : undefined,
        canViewVitals: input.canViewVitals ?? undefined,
        canManageMedicines: input.canManageMedicines ?? undefined,
        canManageContacts: input.canManageContacts ?? undefined,
        canAcknowledgeSos: input.canAcknowledgeSos ?? undefined,
        isPrimary: input.isPrimary ?? undefined,
      },
      select: LINK_SELECT,
    });

    realtimeBus.publish("link.updated", {
      elderId: updated.elderId,
      caregiverId: updated.caregiverId,
      status: updated.status,
    });

    ok(res, updated);
  }),
);

/**
 * GET /api/v1/care-links/invitations
 *
 * Pending invitations addressed to the signed-in user's e-mail address.
 */
export const careLinkInvitationsRouter = Router();

careLinkInvitationsRouter.use(authenticate);

careLinkInvitationsRouter.get(
  "/invitations",
  asyncHandler(async (req, res) => {
    const links = await prisma.careLink.findMany({
      where: { invitedEmail: normalizeEmail(req.auth!.email), status: "PENDING" },
      select: { ...LINK_SELECT, elder: { select: { displayName: true } } },
      orderBy: { invitedAt: "desc" },
    });

    ok(res, links);
  }),
);

/** GET /api/v1/care-links — every elder the caller can follow. */
export const careLinkListRouter = Router();

careLinkListRouter.use(authenticate);

careLinkListRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const accessible = await listAccessibleElders(req.auth!);
    ok(
      res,
      accessible.map((item) => ({
        elderId: item.elder.id,
        displayName: item.elder.displayName,
        photoUrl: item.elder.photoUrl,
        relation: item.link?.relation ?? "SELF",
        status: item.link?.status ?? "ACTIVE",
        permissions: {
          canViewVitals: item.isOwner || Boolean(item.link?.canViewVitals),
          canManageMedicines: item.isOwner || Boolean(item.link?.canManageMedicines),
          canManageContacts: item.isOwner || Boolean(item.link?.canManageContacts),
          canAcknowledgeSos: item.isOwner || Boolean(item.link?.canAcknowledgeSos),
        },
      })),
    );
  }),
);
