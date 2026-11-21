/**
 * Shared domain types.
 *
 * These mirror the JSON contract of the API. Keeping them in one file makes
 * it obvious when the server contract changes and avoids scattering
 * `any` across the components.
 */

export type Role = "SENIOR" | "CAREGIVER" | "ADMIN";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  timeZone: string;
  elderId: string | null;
}

export type CheckInStatus = "SAFE" | "NEEDS_HELP" | "MISSED";

export interface CheckIn {
  id: string;
  status: CheckInStatus;
  mood: number | null;
  note: string | null;
  autoEscalated: boolean;
  createdAt: string;
}

export type VitalType =
  | "BLOOD_PRESSURE"
  | "BLOOD_SUGAR"
  | "HEART_RATE"
  | "TEMPERATURE"
  | "OXYGEN_SATURATION"
  | "WEIGHT";

export interface Vital {
  id: string;
  type: VitalType;
  value: number;
  value2: number | null;
  unit: string;
  isCritical: boolean;
  warning: string | null;
  note: string | null;
  measuredAt: string;
  createdAt: string;
}

export interface VitalSeriesPoint {
  id: string;
  value: number;
  value2: number | null;
  measuredAt: string;
  isCritical: boolean;
}

export interface VitalSeries {
  type: VitalType;
  label: string;
  unit: string;
  count: number;
  average: number;
  min: number;
  max: number;
  first: number;
  last: number;
  trend: number;
  criticalCount: number;
  points: VitalSeriesPoint[];
}

export interface VitalSummary {
  days: number;
  criticalCount: number;
  series: VitalSeries[];
}

export interface Medication {
  id: string;
  elderId: string;
  name: string;
  dosage: string;
  instructions: string | null;
  activeIngredient: string | null;
  scheduleType: "DAILY" | "WEEKLY" | "INTERVAL" | "AS_NEEDED";
  times: string[];
  daysOfWeek: number[];
  intervalMinutes: number | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
  notifyCaregivers: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DoseStatus = "PENDING" | "TAKEN" | "SKIPPED" | "MISSED";

export interface Dose {
  key: string;
  medicationId: string;
  medicationName: string;
  dosage: string;
  scheduledFor: string;
  status: DoseStatus;
  takenAt: string | null;
  note: string | null;
  remindedAt: string | null;
}

export interface Schedule {
  timeZone: string;
  from: string;
  to: string;
  doses: Dose[];
  adherence: {
    taken: number;
    skipped: number;
    missed: number;
    pending: number;
  };
}

export type ContactRelation = "FAMILY" | "CAREGIVER" | "DOCTOR" | "NEIGHBOUR" | "OTHER";

export interface EmergencyContact {
  id: string;
  elderId: string;
  name: string;
  phone: string;
  email: string | null;
  relation: ContactRelation;
  priority: number;
  isDoctor: boolean;
  receivesMedicationReminders: boolean;
  receivesMissedCheckInAlerts: boolean;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SosStatus = "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED" | "CANCELLED";

export interface SosAlert {
  id: string;
  elderId: string;
  triggeredByUserId: string;
  status: SosStatus;
  message: string | null;
  cancelledAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  locationSource: "GPS" | "MANUAL" | null;
  locationLabel: string | null;
  createdAt: string;
  mapUrl?: string | null;
  elderName?: string;
  elderPhotoUrl?: string | null;
}

export interface LocationPing {
  id: string;
  elderId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  source: "GPS" | "MANUAL";
  label: string | null;
  createdAt: string;
  mapUrl?: string;
}

export interface ElderSummary {
  elder: {
    id: string;
    displayName: string;
    dateOfBirth: string | null;
    bloodType: string | null;
    conditions: string[];
    allergies: string[];
    medicalNotes: string | null;
    photoUrl: string | null;
    checkInDeadlineHour: number;
    canTriggerSos: boolean;
  };
  checkIn: {
    latest: {
      id: string;
      status: CheckInStatus;
      mood: number | null;
      note: string | null;
      createdAt: string;
    } | null;
    checkedInToday: boolean;
    streak: number;
    missedLast7Days: number;
  };
  medications: {
    total: number;
    active: number;
    dueToday: number;
    takenToday: number;
    adherence7Days: number | null;
  };
  vitals: {
    latest: Array<{
      id: string;
      type: VitalType;
      value: number;
      value2: number | null;
      unit: string;
      isCritical: boolean;
      warning: string | null;
      measuredAt: string;
    }>;
    criticalCount24h: number;
  };
  sos: {
    activeCount: number;
    latest: { id: string; status: SosStatus; createdAt: string } | null;
  };
  caregivers: {
    total: number;
    names: string[];
  };
}

export interface CareLink {
  id: string;
  elderId: string;
  caregiverId: string | null;
  invitedEmail: string | null;
  relation: ContactRelation;
  status: "PENDING" | "ACTIVE" | "REVOKED";
  isPrimary: boolean;
  canViewVitals: boolean;
  canManageMedicines: boolean;
  canManageContacts: boolean;
  canAcknowledgeSos: boolean;
  invitedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  caregiver: { id: string; name: string; email: string } | null;
}

/** A pending invitation addressed to the signed-in caregiver's e-mail. */
export interface CareLinkInvitation extends CareLink {
  elder: { displayName: string };
}

export type NotificationType =
  | "SOS_TRIGGERED"
  | "SOS_ACKNOWLEDGED"
  | "SOS_RESOLVED"
  | "CHECK_IN_MISSED"
  | "CHECK_IN_NEEDS_HELP"
  | "VITALS_CRITICAL"
  | "MEDICATION_DUE"
  | "MEDICATION_MISSED"
  | "CARE_LINK_INVITED"
  | "SYSTEM";

export interface AppNotification {
  id: string;
  userId: string;
  elderId: string | null;
  sosAlertId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface DashboardPayload {
  elders: ElderSummary[];
  activeAlerts: SosAlert[];
  recentNotifications: AppNotification[];
  unreadCount: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
