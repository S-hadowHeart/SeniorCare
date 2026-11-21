import { z } from "zod";
import { uuidSchema } from "../../lib/validation.js";

export const elderIdParamSchema = z.object({ elderId: uuidSchema });

export const createCheckInSchema = z.object({
  status: z.enum(["SAFE", "NEEDS_HELP"]),
  /** Self-reported wellbeing, 1 (poor) … 5 (great). */
  mood: z.number().int().min(1).max(5).nullish(),
  note: z.string().trim().max(1000).nullish(),
  /** Client timestamp; defaults to the server time. */
  recordedAt: z.coerce.date().optional(),
});

export const listCheckInsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

export type CreateCheckInInput = z.infer<typeof createCheckInSchema>;
export type ListCheckInsQuery = z.infer<typeof listCheckInsQuerySchema>;
