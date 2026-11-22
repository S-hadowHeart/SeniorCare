import { z } from "zod";
import { uuidSchema } from "../../lib/validation.js";

export const elderIdParamSchema = z.object({ elderId: uuidSchema });
export const medicationIdParamSchema = z.object({ medicationId: uuidSchema });
export const medicationItemParamSchema = z.object({ id: uuidSchema });

const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]?\d|2[0-3]):([0-5]\d)$/, "Use a 24-hour time such as 08:30.");

const medicationFields = z.object({
  name: z.string().trim().min(1, "Enter the medication name.").max(120),
  dosage: z.string().trim().min(1, "Enter the dosage.").max(60),
  instructions: z.string().trim().max(1000).nullish(),
  activeIngredient: z.string().trim().max(120).nullish(),
  scheduleType: z.enum(["DAILY", "WEEKLY", "INTERVAL", "AS_NEEDED"]).default("DAILY"),
  times: z.array(timeOfDaySchema).max(12).default([]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  intervalMinutes: z.number().int().min(15).max(10_080).nullish(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullish(),
  notifyCaregivers: z.boolean().default(true),
});

export const createMedicationSchema = medicationFields.superRefine((data, ctx) => {
  if (data.scheduleType === "DAILY" || data.scheduleType === "WEEKLY") {
    if (data.times.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["times"],
        message: "Add at least one time of day.",
      });
    }
  }

  if (data.scheduleType === "WEEKLY" && data.daysOfWeek.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["daysOfWeek"],
      message: "Select at least one weekday.",
    });
  }

  if (data.scheduleType === "INTERVAL" && !data.intervalMinutes) {
    ctx.addIssue({
      code: "custom",
      path: ["intervalMinutes"],
      message: "Set the interval between doses.",
    });
  }

  if (data.endDate && data.startDate && data.endDate < data.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "The end date must be after the start date.",
    });
  }
});

export const updateMedicationSchema = medicationFields
  .partial()
  .extend({
    // Override the create-time defaults. `partial()` alone leaves `default()`
    // in place, which would re-inject `scheduleType: "DAILY"` and `times: []`
    // into a one-field update (for example `{ dosage }`) and fail validation.
    scheduleType: z.enum(["DAILY", "WEEKLY", "INTERVAL", "AS_NEEDED"]).optional(),
    times: z.array(timeOfDaySchema).max(12).optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    notifyCaregivers: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.scheduleType === "DAILY" || data.scheduleType === "WEEKLY") {
      if (data.times !== undefined && data.times.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["times"],
          message: "Add at least one time of day.",
        });
      }
    }
    if (data.scheduleType === "WEEKLY" && data.daysOfWeek !== undefined && data.daysOfWeek.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["daysOfWeek"],
        message: "Select at least one weekday.",
      });
    }
    if (data.scheduleType === "INTERVAL" && data.intervalMinutes === null) {
      ctx.addIssue({
        code: "custom",
        path: ["intervalMinutes"],
        message: "Set the interval between doses.",
      });
    }
  });

export const scheduleQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(31).default(7),
  /** Include doses that are already in the past. */
  includePast: z.preprocess(
    (value) => (value === undefined || value === "" ? "true" : String(value).toLowerCase()),
    z.enum(["true", "false"]).transform((value) => value === "true"),
  ),
});

export const recordDoseSchema = z.object({
  scheduledFor: z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Enter a valid date and time.",
  }),
  status: z.enum(["TAKEN", "SKIPPED"]),
  note: z.string().trim().max(500).nullish(),
});

export type CreateMedicationInput = z.infer<typeof createMedicationSchema>;
export type UpdateMedicationInput = z.infer<typeof updateMedicationSchema>;
export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;
export type RecordDoseInput = z.infer<typeof recordDoseSchema>;
