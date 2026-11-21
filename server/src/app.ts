import compression from "compression";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { httpLogger } from "./middleware/httpLogger.js";
import { globalLimiter } from "./middleware/rateLimit.js";
import { requestContext } from "./middleware/requestContext.js";
import { corsMiddleware, securityHeaders } from "./middleware/security.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { careLinkInvitationsRouter, careLinkItemRouter, careLinkListRouter, careLinksRouter } from "./modules/careLinks/careLinks.routes.js";
import { checkInsRouter } from "./modules/checkins/checkins.routes.js";
import { contactItemRouter, contactsRouter } from "./modules/contacts/contacts.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { eldersRouter } from "./modules/elders/elders.routes.js";
import { eventsRouter } from "./modules/events/events.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { locationsRouter } from "./modules/locations/locations.routes.js";
import { medicationItemRouter, medicationsRouter } from "./modules/medications/medications.routes.js";
import { notificationsRouter } from "./modules/notifications/notifications.routes.js";
import { sosActiveRouter, sosItemRouter, sosRouter } from "./modules/sos/sos.routes.js";
import { vitalsRouter } from "./modules/vitals/vitals.routes.js";

/**
 * Express application factory.
 *
 * The middleware order below is deliberate and follows the principle
 * "cheapest and most security relevant first":
 *
 *   1. request id  – every later log line carries the correlation id
 *   2. logging     – access log (skips the health probes to avoid noise)
 *   3. helmet/CORS – security headers before anything can respond
 *   4. parsers     – body parsing is bounded to 100 kB
 *   5. rate limit – applied before any database work
 *   6. routes
 *   7. 404 → error handler
 */
export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy / load balancer this makes `req.ip` the real
  // client address, which the rate limiter relies on.
  app.set("trust proxy", env.TRUST_PROXY);
  app.set("etag", "strong");
  app.disable("x-powered-by");
  app.disable("x-cloak");

  app.use(requestContext);

  // The access log skips the health probes: they are hit every few seconds
  // by the orchestrator and would drown the real traffic.
  app.use(
    httpLogger({
      skip: (req) =>
        req.path === `${env.API_PREFIX}/health` || req.path === `${env.API_PREFIX}/health/ready`,
    }),
  );

  app.use(securityHeaders);
  app.use(corsMiddleware);

  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));
  app.use(cookieParser());
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) =>
        // SSE streams must never be buffered.
        req.headers.accept?.includes("text/event-stream") ? false : compression.filter(req, res),
    }),
  );

  app.use(globalLimiter);

  // --- Public routes ------------------------------------------------------
  app.use(`${env.API_PREFIX}/health`, healthRouter);

  // --- Authentication ------------------------------------------------------
  app.use(`${env.API_PREFIX}/auth`, authRouter);

  // --- Realtime ------------------------------------------------------------
  app.use(`${env.API_PREFIX}/events`, eventsRouter);

  // --- Elders -------------------------------------------------------------
  app.use(`${env.API_PREFIX}/elders`, eldersRouter);
  app.use(`${env.API_PREFIX}/elders/:elderId/checkins`, checkInsRouter);
  app.use(`${env.API_PREFIX}/elders/:elderId/vitals`, vitalsRouter);
  app.use(`${env.API_PREFIX}/elders/:elderId/medications`, medicationsRouter);
  app.use(`${env.API_PREFIX}/elders/:elderId/contacts`, contactsRouter);
  app.use(`${env.API_PREFIX}/elders/:elderId/care-links`, careLinksRouter);
  app.use(`${env.API_PREFIX}/elders/:elderId/sos`, sosRouter);
  app.use(`${env.API_PREFIX}/elders/:elderId/locations`, locationsRouter);

  // --- Item level routes ---------------------------------------------------
  app.use(`${env.API_PREFIX}/medications`, medicationItemRouter);
  app.use(`${env.API_PREFIX}/contacts`, contactItemRouter);
  app.use(`${env.API_PREFIX}/care-links`, careLinkItemRouter);
  app.use(`${env.API_PREFIX}/care-links`, careLinkListRouter);
  app.use(`${env.API_PREFIX}/care-links`, careLinkInvitationsRouter);
  app.use(`${env.API_PREFIX}/sos`, sosItemRouter);
  app.use(`${env.API_PREFIX}/sos`, sosActiveRouter);

  // --- Dashboard & notifications ------------------------------------------
  app.use(`${env.API_PREFIX}/dashboard`, dashboardRouter);
  app.use(`${env.API_PREFIX}/notifications`, notificationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
