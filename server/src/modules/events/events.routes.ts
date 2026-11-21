import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ok } from "../../lib/http.js";
import { authenticate } from "../../middleware/authenticate.js";
import { openStream, sseHub } from "../../realtime/sse.js";

export const eventsRouter = Router();

/**
 * POST /api/v1/events/ticket
 *
 * Exchanges the access token for a single-use ticket that the browser can
 * pass to `EventSource` (which cannot set an `Authorization` header).
 */
eventsRouter.post(
  "/ticket",
  authenticate,
  asyncHandler(async (req, res) => {
    const { ticket, expiresInSeconds } = sseHub.issueTicket(req.auth!.userId);
    ok(res, { ticket, expiresInSeconds });
  }),
);

/**
 * GET /api/v1/events/stream
 *
 * The Server-Sent Events stream. Long lived: the connection is held open
 * and the server sends a heartbeat every 25 seconds.
 */
eventsRouter.get("/stream", openStream);
