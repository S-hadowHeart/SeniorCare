import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEventStream, type StreamEvent } from "../lib/useEventStream";
import { useAuth } from "./AuthContext";

interface RealtimeContextValue {
  connected: boolean;
  lastEvent: StreamEvent | null;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  lastEvent: null,
});

/**
 * Owns the single Server-Sent Events connection for the whole application.
 *
 * Having exactly one stream (instead of one per component) keeps the number
 * of open connections low — important because every stream occupies a socket
 * on both the browser and the API — and guarantees that every component sees
 * the same events.
 *
 * The connection is only opened once the user is authenticated: an
 * unauthenticated client would otherwise retry the ticket endpoint forever.
 *
 * Events invalidate the relevant React Query caches, which is what makes the
 * dashboards update without polling.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<StreamEvent | null>(null);

  const enabled = status === "authenticated";

  useEventStream(
    (event) => {
      setLastEvent(event);
      setConnected(true);

      switch (event.type) {
        case "notification":
          void queryClient.invalidateQueries({ queryKey: ["notifications"] });
          void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          break;
        case "sos.triggered":
        case "sos.updated":
          void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          void queryClient.invalidateQueries({ queryKey: ["sos"] });
          void queryClient.invalidateQueries({ queryKey: ["elders"] });
          break;
        case "checkin.created":
          void queryClient.invalidateQueries({ queryKey: ["checkins"] });
          void queryClient.invalidateQueries({ queryKey: ["elders"] });
          void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          break;
        case "vital.created":
          void queryClient.invalidateQueries({ queryKey: ["vitals"] });
          void queryClient.invalidateQueries({ queryKey: ["elders"] });
          break;
        case "medication.updated":
          void queryClient.invalidateQueries({ queryKey: ["medications"] });
          void queryClient.invalidateQueries({ queryKey: ["schedule"] });
          void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          break;
        default:
          break;
      }
    },
    enabled,
  );

  const value = useMemo<RealtimeContextValue>(
    () => ({ connected, lastEvent }),
    [connected, lastEvent],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}
