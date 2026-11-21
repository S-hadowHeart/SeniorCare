import { z } from "zod";
import { uuidSchema } from "../../lib/validation.js";

export const updateElderSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  dateOfBirth: z.coerce.date().max(new Date(), "Date of birth cannot be in the future.").nullish(),
  bloodType: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "UNKNOWN"]).optional(),
  conditions: z.array(z.string().trim().min(1).max(80)).max(25).optional(),
  allergies: z.array(z.string().trim().min(1).max(80)).max(25).optional(),
  medicalNotes: z.string().trim().max(4000).nullish(),
  photoUrl: z.string().trim().url().max(500).nullish(),
  checkInDeadlineHour: z.number().int().min(0).max(23).optional(),
  canTriggerSos: z.boolean().optional(),
  timeZone: z.string().trim().min(1).max(64).optional(),
});

export const elderParamsSchema = z.object({ id: uuidSchema });

export type UpdateElderInput = z.infer<typeof updateElderSchema>;
