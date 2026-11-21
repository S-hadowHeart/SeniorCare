import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { childLogger } from "../lib/logger.js";
import { realtimeBus, type RealtimeEventName } from "./bus.js";

const log = childLogger("sse");

/**
 * Server-Sent Events hub.
 *
 * SSE was chosen over WebSockets because the dashboard only needs a
 * one-way channel, SSE reconnects automatically (with `Last-Event-ID`
 * semantics), it works through every HTTP proxy without an upgrade dance and
 * it needs no extra dependency on the client.
 *
 * ### Ticket based handshake
 *
 * `EventSource` cannot send an `Authorization` header, and putting a bearer
 * token in the query string would leak it into proxy logs and browser
 * history. Instead the client exchanges its access token for a short lived,
 * single-use *ticket* over a normal authenticated `POST`, and then connects
 * to the stream with the ticket in the query string.
 */

const TICKET_TTL_MS = 60_000;

interface Ticket {
  userId: string;
  expiresAt: number;
}

interface Client {
  id: string;
  userId: string;
  res: Response;
  connectedAt: number;
}

class SseHub {
  private readonly clients = new Map<string, Client>();
  private readonly tickets = new Map<string, Ticket>();
  private heartbeat: NodeJS.Timeout | null = null;

  /** Issue a single-use ticket for the SSE handshake. */
  issueTicket(userId: string): { ticket: string; expiresInSeconds: number } {
    this.sweepTickets();
    const ticket = randomUUID();
    this.tickets.set(ticket, { userId, expiresAt: Date.now() + TICKET_TTL_MS });
    return { ticket, expiresInSeconds: Math.floor(TICKET_TTL_MS / 1000) };
  }

  /** Consume a ticket. Returns the user id, or `null` when invalid. */
  consumeTicket(ticket: string): string | null {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) return null;
    return entry.userId;
  }

  /** Register a response stream as an SSE client. */
  attach(res: Response, userId: string): string {
    const id = randomUUID();

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Disable proxy buffering (nginx) so events are flushed immediately.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    res.write("retry: 5000\n\n");
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId: id })}\n\n`);

    const client: Client = { id, userId, res, connectedAt: Date.now() };
    this.clients.set(id, client);

    log.info({ clientId: id, userId, total: this.clients.size }, "sse client connected");

    const heartbeat = setInterval(() => {
      this.writeTo(client, "ping", { at: new Date().toISOString() });
    }, 25_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      this.clients.delete(id);
      log.info({ clientId: id, userId, total: this.clients.size }, "sse client disconnected");
    };

    res.on("close", cleanup);
    res.on("error", cleanup);

    this.ensureHeartbeat();

    return id;
  }

  /** Send an event to every stream belonging to `userId`. */
  sendToUser(userId: string, event: string, data: unknown): void {
    for (const client of this.clients.values()) {
      if (client.userId === userId) {
        this.writeTo(client, event, data);
      }
    }
  }

  /** Number of currently connected streams (exposed for metrics/health). */
  get connectionCount(): number {
    return this.clients.size;
  }

  private writeTo(client: Client, event: string, data: unknown): void {
    try {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      log.warn({ err: error, clientId: client.id }, "failed to write sse event");
    }
  }

  /** Global keep-alive so that proxies do not drop idle connections. */
  private ensureHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      const now = Date.now();
      for (const client of this.clients.values()) {
        if (now - client.connectedAt > 0) {
          // `ping` events keep the socket warm and let the client detect a
          // dropped connection quickly.
          this.writeTo(client, "ping", { at: new Date(now).toISOString() });
        }
      }
    }, 25_000);
    this.heartbeat.unref?.();
  }

  private sweepTickets(): void {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt < now) this.tickets.delete(ticket);
    }
  }

  /** Close all streams — used during graceful shutdown. */
  closeAll(): void {
    for (const client of this.clients.values()) {
      try {
        client.res.end();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}

export const sseHub = new SseHub();

/**
 * Bridge the domain event bus to the SSE hub.
 *
 * Every event that carries a `userId` is forwarded to that user's streams.
 * Events that concern a whole care team (e.g. "an SOS was triggered") are
 * handled explicitly by the services that publish them.
 */
realtimeBus.subscribe("notification.created", (payload) => {
  sseHub.sendToUser(payload.userId, "notification", {
    id: payload.notificationId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    elderId: payload.elderId ?? null,
    metadata: payload.metadata ?? {},
    createdAt: new Date().toISOString(),
  });
});

export const realtimeEventNames: RealtimeEventName[] = [
  "notification.created",
  "sos.triggered",
  "sos.updated",
  "checkin.created",
  "vital.created",
  "medication.updated",
  "link.updated",
];

/** Express handler that opens the SSE stream. */
export function openStream(req: Request, res: Response): void {
  const ticket = typeof req.query.ticket === "string" ? req.query.ticket : "";
  const userId = sseHub.consumeTicket(ticket);

  if (!userId) {
    res.status(401).json({
      type: "https://seniorcare.app/problems/invalid_ticket",
      title: "UnauthorizedError",
      status: 401,
      detail: "The stream ticket is missing, expired or already used.",
      code: "invalid_ticket",
      requestId: req.requestId,
    });
    return;
  }

  sseHub.attach(res, userId);
}

export const sseConfig = {
  retryMs: 5000,
  env: env.NODE_ENV,
};
