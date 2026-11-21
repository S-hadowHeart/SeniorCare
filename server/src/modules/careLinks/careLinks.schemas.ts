import { z } from "zod";
import { uuidSchema } from "../../lib/validation.js";

export const elderIdParamSchema = z.object({ elderId: uuidSchema });
export const linkIdParamSchema = z.object({ id: uuidSchema });

export const inviteCaregiverSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Enter a valid e-mail address."),
  relation: z.enum(["FAMILY", "CAREGIVER", "DOCTOR", "NEIGHBOUR", "OTHER"]).default("FAMILY"),
  canViewVitals: z.boolean().default(true),
  canManageMedicines: z.boolean().default(false),
  canManageContacts: z.boolean().default(false),
  canAcknowledgeSos: z.boolean().default(true),
  isPrimary: z.boolean().default(false),
});

export const updateLinkSchema = z.object({
  status: z.enum(["ACTIVE", "REVOKED"]).optional(),
  canViewVitals: z.boolean().optional(),
  canManageMedicines: z.boolean().optional(),
  canManageContacts: z.boolean().optional(),
  canAcknowledgeSos: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
});

export type InviteCaregiverInput = z.infer<typeof inviteCaregiverSchema>;
export type UpdateLinkInput = z.infer<typeof updateLinkSchema>;
