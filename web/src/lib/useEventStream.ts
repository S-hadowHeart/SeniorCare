import { useEffect, useRef } from "react";
import { api } from "./api";

/**
 * Server-Sent Events client.
 *
 * `EventSource` cannot send an `Authorization` header, so the stream is
 * protected with a single-use ticket obtained from an authenticated `POST`.
 * The ticket expires after 60 seconds and can only be redeemed once, which
 * keeps the bearer token out of the URL and out of the proxy logs.
 *
 * The browser's native `EventSource` already reconnects automatically; the
 * hook only has to keep the ticket fresh — after a reconnect the original
 * ticket has already been spent, so the stream is re-opened with a new one.
 */
export interface StreamEvent {
  type: string;
  data: Record<string, unknown>;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export function useEventStream(
  onEvent: (event: StreamEvent) => void,
  enabled = true,
): void {
  // Keep the callback in a ref so that re-renders do not tear down the
  // connection.
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    let source: EventSource | null = null;
    let ticket: string | null = null;
    let closed = false;
    let retryTimer: number | undefined;

    const connect = async (): Promise<void> => {
      if (closed) return;

      try {
        const { ticket: newTicket } = await api.post<{ ticket: string }>("/events/ticket");
        if (closed) return;
        ticket = newTicket;

        source = new EventSource(`${API_BASE}/events/stream?ticket=${encodeURIComponent(ticket)}`);

        const forward = (type: string) => (event: MessageEvent<string>) => {
          try {
            handlerRef.current({ type, data: JSON.parse(event.data) as Record<string, unknown> });
          } catch {
            handlerRef.current({ type, data: {} });
          }
        };

        source.addEventListener("notification", forward("notification"));
        source.addEventListener("connected", forward("connected"));

        source.onerror = () => {
          source?.close();
          source = null;
          if (closed) return;

          // The ticket is single use, so a reconnect needs a fresh one.
          // Retry with a small backoff so a server restart does not turn into
          // a reconnect storm.
          retryTimer = window.setTimeout(() => void connect(), 3000);
        };
      } catch {
        if (closed) return;
        retryTimer = window.setTimeout(() => void connect(), 5000);
      }
    };

    void connect();

    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      source?.close();
      source = null;
      ticket = null;
    };
  }, [enabled]);
}
