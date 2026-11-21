import { z } from "zod";
import { uuidSchema } from "../../lib/validation.js";

export const elderIdParamSchema = z.object({ elderId: uuidSchema });
export const sosIdParamSchema = z.object({ id: uuidSchema });

export const sosLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Accuracy in metres, as reported by the browser. */
  accuracy: z.number().min(0).max(10_000).nullish(),
  /** Human readable place, e.g. "Home" or "Tesco, High Street". */
  label: z.string().trim().max(120).nullish(),
  source: z.enum(["GPS", "MANUAL"]).default("GPS"),
});

export const triggerSosSchema = z.object({
  message: z.string().trim().max(500).nullish(),
  location: sosLocationSchema.nullish(),
});

export const resolveSosSchema = z.object({
  note: z.string().trim().max(500).nullish(),
});

export const sosListQuerySchema = z.object({
  status: z.enum(["ACTIVE", "ACKNOWLEDGED", "RESOLVED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type TriggerSosInput = z.infer<typeof triggerSosSchema>;
export type SosListQuery = z.infer<typeof sosListQuerySchema>;
