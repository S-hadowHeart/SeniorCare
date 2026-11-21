import type { User } from "./types";

/**
 * The landing screen for a signed-in account.
 *
 * Seniors get their own one-tap dashboard; everyone else (carers, clinicians
 * and admins) works from the caregiver dashboard, which lists the people they
 * are allowed to follow.
 */
export function homePath(user: User | null): string {
  if (!user) return "/login";
  return user.role === "SENIOR" ? "/app" : "/caregiver";
}
