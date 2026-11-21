import type { CareLink, Elder } from "../generated/prisma/client.js";
import { ForbiddenError, NotFoundError } from "./errors.js";
import { prisma } from "./prisma.js";
import type { AuthContext } from "../types.js";

/** An elder profile together with the account that owns it. */
export type ElderWithUser = Elder & {
  user: { id: string; name: string; email: string; timeZone: string };
};

/**
 * Authorisation for elder-scoped resources.
 *
 * Access is granted in exactly two ways:
 *   1. the caller owns the elder profile (the senior themselves), or
 *   2. an **active** `CareLink` connects the caller to the elder.
 *
 * The link carries explicit capability flags (`canViewVitals`,
 * `canManageMedicines`, …) so a doctor can be given read-only access
 * without creating a second role system.
 */

export type ElderScope =
  | "view"
  | "manage_medications"
  | "manage_contacts"
  | "acknowledge_sos"
  | "manage_caregivers";

export interface ElderAccess {
  elder: ElderWithUser;
  /** `true` when the caller is the senior the profile belongs to. */
  isOwner: boolean;
  /** The care link that granted access, if any. */
  link: CareLink | null;
}

function scopeAllowed(link: CareLink, scope: ElderScope): boolean {
  switch (scope) {
    case "view":
      return link.canViewVitals || link.canManageMedicines || link.canManageContacts;
    case "manage_medications":
      return link.canManageMedicines;
    case "manage_contacts":
      return link.canManageContacts;
    case "acknowledge_sos":
      return link.canAcknowledgeSos;
    case "manage_caregivers":
      return link.canManageContacts && link.relation === "FAMILY";
    default:
      return false;
  }
}

/**
 * Resolve the caller's access to an elder profile.
 *
 * Throws `NotFoundError` when the profile does not exist and
 * `ForbiddenError` when the caller has no (or insufficient) link.
 */
export async function getElderAccess(
  actor: AuthContext,
  elderId: string,
  scope: ElderScope = "view",
): Promise<ElderAccess> {
  const elder = await prisma.elder.findUnique({
    where: { id: elderId },
    include: { user: { select: { id: true, name: true, email: true, timeZone: true } } },
  });

  if (!elder) {
    throw new NotFoundError("This care record", "elder_not_found");
  }

  // 1. The senior themselves.
  if (elder.userId === actor.userId) {
    return { elder, isOwner: true, link: null };
  }

  // 2. Platform administrators.
  if (actor.role === "ADMIN") {
    return { elder, isOwner: false, link: null };
  }

  // 3. Active care link.
  const link = await prisma.careLink.findUnique({
    where: { elderId_caregiverId: { elderId, caregiverId: actor.userId } },
  });

  if (!link || link.status !== "ACTIVE" || !scopeAllowed(link, scope)) {
    throw new ForbiddenError("You do not have access to this person's care record.");
  }

  return { elder, isOwner: false, link };
}

/**
 * All elder ids the caller may read, together with the matching links.
 * Used by the caregiver dashboard, which aggregates several elders.
 */
export async function listAccessibleElders(actor: AuthContext): Promise<
  Array<{ elder: ElderWithUser; link: CareLink | null; isOwner: boolean }>
> {
  const [owned, linked] = await Promise.all([
    prisma.elder.findMany({
      where: { userId: actor.userId },
      include: { user: { select: { id: true, name: true, email: true, timeZone: true } } },
    }),
    prisma.careLink.findMany({
      where: { caregiverId: actor.userId, status: "ACTIVE" },
      include: {
        elder: {
          include: { user: { select: { id: true, name: true, email: true, timeZone: true } } },
        },
      },
    }),
  ]);

  const results: Array<{ elder: ElderWithUser; link: CareLink | null; isOwner: boolean }> = owned.map(
    (elder) => ({ elder, link: null, isOwner: true }),
  );

  for (const item of linked) {
    results.push({ elder: item.elder, link: item, isOwner: false });
  }

  return results;
}

/** The timezone that should be used for a given elder. */
export function elderTimeZone(elder: ElderWithUser): string {
  return elder.user?.timeZone || "UTC";
}
