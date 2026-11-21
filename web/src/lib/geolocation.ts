/**
 * Browser Geolocation helpers.
 *
 * The SOS flow must never block on a slow or denied GPS fix: the alert is
 * raised immediately and the location is attached when (and if) it arrives.
 */

export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export type GeoErrorReason =
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "unsupported";

export class GeoError extends Error {
  readonly reason: GeoErrorReason;

  constructor(reason: GeoErrorReason, message: string) {
    super(message);
    this.name = "GeoError";
    this.reason = reason;
  }
}

function toReason(code: number): GeoErrorReason {
  switch (code) {
    case 1:
      return "permission_denied";
    case 2:
      return "position_unavailable";
    case 3:
      return "timeout";
    default:
      return "unsupported";
  }
}

/**
 * Resolve the current position.
 *
 * @param timeout maximum time to wait for a fix (milliseconds)
 */
export function getCurrentPosition(timeout = 10_000): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new GeoError("unsupported", "This device does not support location sharing."));
      return;
    }

    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new GeoError("timeout", "The location request timed out."));
    }, timeout);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new GeoError(toReason(error.code), error.message));
      },
      {
        enableHighAccuracy: true,
        timeout,
        maximumAge: 30_000,
      },
    );
  });
}

/** Human readable explanation for a geolocation failure. */
export function describeGeoError(error: unknown): string {
  if (!(error instanceof GeoError)) return "Your location could not be determined.";

  switch (error.reason) {
    case "permission_denied":
      return "Location sharing is blocked. You can still send the alert and say where you are in your message.";
    case "position_unavailable":
      return "Your location could not be determined. The alert was still sent.";
    case "timeout":
      return "It took too long to find your location. The alert was still sent.";
    default:
      return "This device does not support location sharing. The alert was still sent.";
  }
}

/** Open the device's map application for a set of coordinates. */
export function openInMaps(latitude: number, longitude: number): void {
  const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
