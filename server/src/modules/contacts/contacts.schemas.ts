import { z } from "zod";
import { uuidSchema } from "../../lib/validation.js";

export const elderIdParamSchema = z.object({ elderId: uuidSchema });
export const contactIdParamSchema = z.object({ id: uuidSchema });

export const contactRelationSchema = z.enum(["FAMILY", "CAREGIVER", "DOCTOR", "NEIGHBOUR", "OTHER"]);

export const createContactSchema = z.object({
  name: z.string().trim().min(1, "Enter the contact's name.").max(80),
  phone: z
    .string()
    .trim()
    .min(5, "Enter a phone number.")
    .max(32)
    .regex(/^[+()\-\s\d]+$/, "Enter a valid phone number."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Enter a valid e-mail address.")
    .nullish(),
  relation: contactRelationSchema.default("FAMILY"),
  /** Lower number = contacted first. */
  priority: z.number().int().min(1).max(100).default(10),
  isDoctor: z.boolean().default(false),
  receivesMedicationReminders: z.boolean().default(false),
  receivesMissedCheckInAlerts: z.boolean().default(true),
  notes: z.string().trim().max(1000).nullish(),
});

export const updateContactSchema = createContactSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
