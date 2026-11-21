import {
  Activity,
  Bell,
  CalendarCheck,
  CheckCircle2,
  HeartPulse,
  Pill,
  Users,
} from "lucide-react";
import type { NavItem } from "./AppShell";

/** Navigation for the senior-facing application. */
export const seniorNavItems: NavItem[] = [
  { to: "/app", label: "Today", icon: <CalendarCheck className="size-5" aria-hidden="true" /> },
  { to: "/app/check-in", label: "Check-ins", icon: <CheckCircle2 className="size-5" aria-hidden="true" /> },
  { to: "/app/health", label: "Health", icon: <Activity className="size-5" aria-hidden="true" /> },
  { to: "/app/medicines", label: "Medicines", icon: <Pill className="size-5" aria-hidden="true" /> },
  { to: "/app/contacts", label: "Contacts", icon: <Users className="size-5" aria-hidden="true" /> },
  { to: "/app/profile", label: "Profile", icon: <HeartPulse className="size-5" aria-hidden="true" /> },
];

/** Navigation for the caregiver-facing application. */
export const caregiverNavItems: NavItem[] = [
  { to: "/caregiver", label: "Dashboard", icon: <CalendarCheck className="size-5" aria-hidden="true" /> },
  { to: "/notifications", label: "Alerts", icon: <Bell className="size-5" aria-hidden="true" /> },
  { to: "/app/profile", label: "Profile", icon: <HeartPulse className="size-5" aria-hidden="true" /> },
];
