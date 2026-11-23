import { z } from "zod";
import { uuidSchema } from "../../lib/validation.js";

export const elderIdParamSchema = z.object({ elderId: uuidSchema });

export const createCheckInSchema = z.object({
  status: z.enum(["SAFE", "NEEDS_HELP"]),
  /** Self-reported wellbeing, 1 (poor) … 5 (great). */
  mood: z.number().int().min(1).max(5).nullish(),
  note: z.string().trim().max(1000).nullish(),
  /**
   * Client timestamp; defaults to the server time. A small skew is tolerated
   * for clock drift, but a check-in cannot be pre-recorded for a future day
   * (that would satisfy the watchdog before the day has even started).
   */
  recordedAt: z.coerce
    .date()
    .refine((value) => value.getTime() <= Date.now() + 5 * 60_000, {
      message: "A check-in cannot be recorded in the future.",
    })
    .optional(),
});

export const listCheckInsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

export type CreateCheckInInput = z.infer<typeof createCheckInSchema>;
export type ListCheckInsQuery = z.infer<typeof listCheckInsQuerySchema>;
