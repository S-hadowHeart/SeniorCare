import { useCallback, useRef, useState } from "react";
import { api } from "../../lib/api";
import { describeGeoError, getCurrentPosition, type GeoPosition } from "../../lib/geolocation";
import type { SosAlert } from "../../lib/types";

export type SosPhase = "idle" | "locating" | "sending" | "sent" | "error";

export interface SosState {
  phase: SosPhase;
  alert: SosAlert | null;
  error: string | null;
  geoNote: string | null;
}

/**
 * The SOS flow.
 *
 * Design goals, in order of importance:
 *
 *  1. **Never delay the alert.** The request is fired as soon as the button is
 *     pressed; the GPS fix is attached when (and if) it arrives. The alert
 *     is never blocked on a slow or denied location permission.
 *  2. **Make a mistake recoverable.** A false alarm can be cancelled by the
 *     person themselves for 15 minutes (enforced server-side).
 *  3. **Tell the family what happened.** The confirmation screen names who
 *     was notified.
 */
export function useSos(elderId: string | undefined) {
  const [state, setState] = useState<SosState>({
    phase: "idle",
    alert: null,
    error: null,
    geoNote: null,
  });

  const positionRef = useRef<GeoPosition | null>(null);
  const timerRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setState({ phase: "idle", alert: null, error: null, geoNote: null });
  }, []);

  const trigger = useCallback(
    async (message?: string) => {
      if (!elderId) return;

      setState({ phase: "locating", alert: null, error: null, geoNote: null });

      // Start the GPS lookup but do not await it yet.
      const positionPromise = getCurrentPosition(8000)
        .then((position) => {
          positionRef.current = position;
          return position;
        })
        .catch((error: unknown) => {
          setState((current) => ({
            ...current,
            geoNote: describeGeoError(error),
          }));
          return null;
        });

      // The alert goes out immediately with whatever we know.
      setState((current) => ({ ...current, phase: "sending" }));

      const initial = await api
        .post<SosAlert>(`/elders/${elderId}/sos`, {
          message: message ?? null,
        })
        .catch((error: unknown) => {
          const description =
            error instanceof Error ? error.message : "The alert could not be sent.";
          setState({
            phase: "error",
            alert: null,
            error: description,
            geoNote: null,
          });
          return null;
        });

      if (!initial) return;

      setState((current) => ({ ...current, phase: "sent", alert: initial }));

      // When the position arrives, send a second, location-enriched update
      // so that the caregivers get the position without the first alert being
      // delayed.
      const position = await positionPromise;
      if (position && initial.latitude === null) {
        await api.post<SosAlert>(`/elders/${elderId}/sos`, {
          message: message ?? null,
          location: {
            latitude: position.latitude,
            longitude: position.longitude,
            accuracy: position.accuracy ?? null,
            source: "GPS",
          },
        });
      }
    },
    [elderId],
  );

  const cancel = useCallback(async () => {
    if (!state.alert) return;
    await api.post(`/sos/${state.alert.id}/cancel`).catch(() => undefined);
    reset();
  }, [state.alert, reset]);

  const shareLocation = useCallback(
    async (label?: string) => {
      if (!elderId) return;
      const position = await getCurrentPosition(8000).catch(() => null);
      if (!position) {
        setState((current) => ({
          ...current,
          geoNote: describeGeoError(new Error("unavailable")),
        }));
        return;
      }

      await api.post(`/elders/${elderId}/locations`, {
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy ?? null,
        source: "GPS",
        label: label ?? null,
      });
    },
    [elderId],
  );

  return { state, trigger, cancel, reset, shareLocation };
}
