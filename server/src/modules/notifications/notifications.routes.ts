import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ok } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validate, validatedParams, validatedQuery } from "../../middleware/validate.js";
import { uuidSchema } from "../../lib/validation.js";

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

const idParamSchema = z.object({ id: uuidSchema });

const listQuerySchema = z.object({
  unreadOnly: z.preprocess(
    (value) => (value === undefined || value === "" ? "false" : String(value).toLowerCase()),
    z.enum(["true", "false"]).transform((value) => value === "true"),
  ),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Keyset cursor — the `createdAt` of the last item of the previous page. */
  cursor: z.string().trim().optional(),
});

/**
 * GET /api/v1/notifications
 *
 * The in-app inbox. Uses a keyset cursor rather than an offset because the
 * feed grows continuously and offset pagination would skip or repeat rows
 * while new notifications arrive.
 */
notificationsRouter.get(
  "/",
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = validatedQuery<z.infer<typeof listQuerySchema>>(req);

    const where = {
      userId: req.auth!.userId,
      channel: "IN_APP" as const,
      ...(query.unreadOnly ? { readAt: null } : {}),
      ...(query.cursor ? { createdAt: { lt: new Date(query.cursor) } } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
      }),
      prisma.notification.count({
        where: { userId: req.auth!.userId, channel: "IN_APP" },
      }),
      prisma.notification.count({
        where: { userId: req.auth!.userId, channel: "IN_APP", readAt: null },
      }),
    ]);

    ok(res, items, {
      total,
      unreadCount,
      nextCursor: items.length === query.limit ? (items[items.length - 1]?.createdAt.toISOString() ?? null) : null,
    });
  }),
);

/** GET /api/v1/notifications/unread-count — the badge number. */
notificationsRouter.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const unreadCount = await prisma.notification.count({
      where: { userId: req.auth!.userId, channel: "IN_APP", readAt: null },
    });
    ok(res, { unreadCount });
  }),
);

/** POST /api/v1/notifications/:id/read — mark one as read. */
notificationsRouter.post(
  "/:id/read",
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);

    // The `userId` in the filter makes the update idempotent and prevents a
    // user from marking somebody else's notification as read.
    const result = await prisma.notification.updateMany({
      where: { id, userId: req.auth!.userId, readAt: null },
      data: { readAt: new Date() },
    });

    ok(res, { id, updated: result.count > 0 });
  }),
);

/** POST /api/v1/notifications/read-all — clear the badge. */
notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const result = await prisma.notification.updateMany({
      where: { userId: req.auth!.userId, channel: "IN_APP", readAt: null },
      data: { readAt: new Date() },
    });

    ok(res, { updated: result.count });
  }),
);
