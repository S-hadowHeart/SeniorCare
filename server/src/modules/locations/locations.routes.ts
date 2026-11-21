import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { created, ok } from "../../lib/http.js";
import { getElderAccess } from "../../lib/access.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate.js";
import { uuidSchema } from "../../lib/validation.js";

export const locationsRouter = Router({ mergeParams: true });

locationsRouter.use(authenticate);

const elderIdParamSchema = z.object({ elderId: uuidSchema });

const shareLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10_000).nullish(),
  source: z.enum(["GPS", "MANUAL"]).default("GPS"),
  label: z.string().trim().max(120).nullish(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

function buildMapUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

/**
 * POST /api/v1/elders/:elderId/locations
 *
 * Stores a location breadcrumb. Location is only ever captured when the
 * person explicitly asks for help (or explicitly shares their position) —
 * the app never tracks in the background.
 */
locationsRouter.post(
  "/",
  validate({ params: elderIdParamSchema, body: shareLocationSchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const input = validatedBody<z.infer<typeof shareLocationSchema>>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const ping = await prisma.locationPing.create({
      data: {
        elderId: elder.id,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy ?? null,
        source: input.source,
        label: input.label ?? null,
      },
    });

    created(res, { ...ping, mapUrl: buildMapUrl(ping.latitude, ping.longitude) });
  }),
);

/** GET /api/v1/elders/:elderId/locations/latest — the most recent position. */
locationsRouter.get(
  "/latest",
  validate({ params: elderIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const ping = await prisma.locationPing.findFirst({
      where: { elderId: elder.id },
      orderBy: { createdAt: "desc" },
    });

    ok(res, ping ? { ...ping, mapUrl: buildMapUrl(ping.latitude, ping.longitude) } : null);
  }),
);

/** GET /api/v1/elders/:elderId/locations — the location history. */
locationsRouter.get(
  "/",
  validate({ params: elderIdParamSchema, query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const query = validatedQuery<z.infer<typeof listQuerySchema>>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const pings = await prisma.locationPing.findMany({
      where: { elderId: elder.id },
      orderBy: { createdAt: "desc" },
      take: query.limit,
    });

    ok(
      res,
      pings.map((ping) => ({ ...ping, mapUrl: buildMapUrl(ping.latitude, ping.longitude) })),
    );
  }),
);
