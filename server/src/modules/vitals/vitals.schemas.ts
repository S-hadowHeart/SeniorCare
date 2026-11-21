import { z } from "zod";
import { uuidSchema } from "../../lib/validation.js";

export const elderIdParamSchema = z.object({ elderId: uuidSchema });

export const vitalTypeSchema = z.enum([
  "BLOOD_PRESSURE",
  "BLOOD_SUGAR",
  "HEART_RATE",
  "TEMPERATURE",
  "OXYGEN_SATURATION",
  "WEIGHT",
]);

export const createVitalSchema = z.object({
  type: vitalTypeSchema,
  value: z.number().finite(),
  /** Diastolic pressure for BLOOD_PRESSURE; ignored for other types. */
  value2: z.number().finite().nullish(),
  unit: z.string().trim().max(16).optional(),
  measuredAt: z.coerce.date().optional(),
  note: z.string().trim().max(1000).nullish(),
});

export const listVitalsQuerySchema = z.object({
  type: vitalTypeSchema.optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const vitalSummaryQuerySchema = z.object({
  type: vitalTypeSchema.optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export type CreateVitalInput = z.infer<typeof createVitalSchema>;
export type ListVitalsQuery = z.infer<typeof listVitalsQuerySchema>;
export type VitalSummaryQuery = z.infer<typeof vitalSummaryQuerySchema>;
