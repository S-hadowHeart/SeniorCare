import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ok } from "../../lib/http.js";
import { listAccessibleElders } from "../../lib/access.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { buildDashboardSummaries } from "../elders/elders.service.js";

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

/**
 * GET /api/v1/dashboard
 *
 * The caregiver dashboard payload: one card per elder plus the cross-cutting
 * alerts and the most recent notifications.
 *
 * Everything is fetched in parallel so the dashboard renders from a single
 * round-trip (one waterfall instead of six).
 */
dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const actor = req.auth!;

    const [summaries, accessible] = await Promise.all([
      buildDashboardSummaries(actor),
      listAccessibleElders(actor),
    ]);

    const elderIds = accessible.map((item) => item.elder.id);

    const [activeAlerts, recentNotifications, unreadCount] = await Promise.all([
      elderIds.length === 0
        ? Promise.resolve([])
        : prisma.sosAlert.findMany({
            where: { elderId: { in: elderIds }, status: { in: ["ACTIVE", "ACKNOWLEDGED"] } },
            orderBy: { createdAt: "desc" },
            include: { elder: { select: { displayName: true, photoUrl: true } } },
          }),
      prisma.notification.findMany({
        where: { userId: actor.userId, channel: "IN_APP" },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
      prisma.notification.count({
        where: { userId: actor.userId, channel: "IN_APP", readAt: null },
      }),
    ]);

    ok(res, {
      elders: summaries,
      activeAlerts: activeAlerts.map((alert) => ({
        id: alert.id,
        status: alert.status,
        message: alert.message,
        createdAt: alert.createdAt,
        acknowledgedAt: alert.acknowledgedAt,
        elderId: alert.elderId,
        elderName: alert.elder.displayName,
        elderPhotoUrl: alert.elder.photoUrl,
        latitude: alert.latitude,
        longitude: alert.longitude,
        locationLabel: alert.locationLabel,
        mapUrl:
          alert.latitude !== null && alert.longitude !== null
            ? `https://www.google.com/maps/search/?api=1&query=${alert.latitude},${alert.longitude}`
            : null,
      })),
      recentNotifications,
      unreadCount,
    });
  }),
);
