import { z } from "zod";

/**
 * Shared validation primitives.
 *
 * Identifiers are validated with an explicit pattern rather than a
 * platform specific helper so that the API behaves identically on every
 * runtime.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const uuidSchema = z
  .string()
  .trim()
  .regex(UUID_PATTERN, "Invalid identifier.")
  .refine((value) => value === value.toLowerCase(), "Identifiers must be lowercase.");

export const idParamSchema = z.object({ id: uuidSchema });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

/** Normalise the paging values into Prisma's `skip` / `take`. */
export function toPrismaPage({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/** `days` query parameter used by the vitals / check-in endpoints. */
export const rangeQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  type: z.string().optional(),
});

/** ISO-8601 instant. */
export const isoDateSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date and time.");

/** Latitude / longitude pair with sane bounds. */
export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10_000).optional(),
});
