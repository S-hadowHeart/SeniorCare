import { EventEmitter } from "node:events";

/**
 * In-process publish/subscribe bus.
 *
 * Every state change that a caregiver should see immediately (a check-in, an
 * SOS alert, a new reading, a dose marked as taken) is published here. The
 * SSE hub subscribes and fans the event out to the connected clients.
 *
 * The bus is intentionally an interface-free, in-memory implementation: the
 * platform is deployed as a modular monolith. To run multiple API instances
 * the only thing that has to change is this file — swap the `EventEmitter`
 * for a Redis Pub/Sub (or NATS) client and the rest of the code keeps
 * working, because everything else only uses `publish` / `subscribe`.
 */

export interface RealtimeEventMap {
  "notification.created": {
    userId: string;
    notificationId: string;
    type: string;
    title: string;
    body: string;
    elderId?: string | null;
    metadata?: Record<string, unknown>;
  };
  "sos.triggered": {
    elderId: string;
    elderName: string;
    alertId: string;
    message?: string | null;
    location?: { latitude: number; longitude: number; label?: string | null } | null;
  };
  "sos.updated": {
    elderId: string;
    alertId: string;
    status: string;
  };
  "checkin.created": {
    elderId: string;
    elderName: string;
    checkInId: string;
    status: string;
    createdAt: string;
  };
  "vital.created": {
    elderId: string;
    elderName: string;
    vitalId: string;
    type: string;
    value: number;
    isCritical: boolean;
  };
  "medication.updated": {
    elderId: string;
    elderName: string;
    medicationId: string;
    doseKey?: string;
    status?: string;
  };
  "link.updated": {
    elderId: string;
    caregiverId: string | null;
    status: string;
  };
}

export type RealtimeEventName = keyof RealtimeEventMap;

class TypedEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // One listener per registered caregiver is realistic; the default limit of
    // 10 would emit spurious warnings.
    this.emitter.setMaxListeners(1000);
  }

  publish<K extends RealtimeEventName>(event: K, payload: RealtimeEventMap[K]): void {
    this.emitter.emit(event, payload);
    this.emitter.emit("*", { event, payload });
  }

  subscribe<K extends RealtimeEventName>(
    event: K,
    listener: (payload: RealtimeEventMap[K]) => void,
  ): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return () => {
      this.emitter.off(event, listener as (...args: unknown[]) => void);
    };
  }

  subscribeAll(listener: (event: RealtimeEventName, payload: unknown) => void): () => void {
    const handler = (payload: unknown) => listener("*" as RealtimeEventName, payload);
    this.emitter.on("*", handler);
    return () => {
      this.emitter.off("*", handler);
    };
  }
}

export const realtimeBus = new TypedEventBus();
