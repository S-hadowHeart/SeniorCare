import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Shared helpers for the integration suites.
 *
 * The application under test is the real Express app — the same middleware
 * stack, the same routers and the same Prisma client used in production.
 */

export const API = "/api/v1";

/** One instance per test file; the app itself holds no mutable state. */
export function buildApp(): Express {
  return createApp();
}

const TABLES = [
  "users",
  "elders",
  "care_links",
  "emergency_contacts",
  "check_ins",
  "vitals",
  "medications",
  "medication_logs",
  "sos_alerts",
  "location_pings",
  "notifications",
  "refresh_tokens",
  "audit_logs",
] as const;

/**
 * Truncate every table (and restart identities) so each test starts from a
 * known-empty database. `CASCADE` follows foreign keys in the right order.
 */
export async function resetDatabase(): Promise<void> {
  const tables = TABLES.map((table) => `"${table}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`,
  );
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export const DEMO_PASSWORD = "SeniorCare2024";

export interface RegisterOverrides {
  email?: string;
  password?: string;
  name?: string;
  role?: "SENIOR" | "CAREGIVER";
  timeZone?: string;
  elder?: Record<string, unknown>;
}

export function registrationPayload(overrides: RegisterOverrides = {}) {
  return {
    email: overrides.email ?? "margaret@example.com",
    password: overrides.password ?? DEMO_PASSWORD,
    name: overrides.name ?? "Margaret Whitfield",
    role: overrides.role ?? "SENIOR",
    timeZone: overrides.timeZone ?? "Europe/London",
    ...(overrides.elder ? { elder: overrides.elder } : {}),
  };
}

/** Create an account and return the response plus a cookie-persisting agent. */
export async function registerUser(
  app: Express,
  overrides: RegisterOverrides = {},
) {
  const agent = request.agent(app);
  const response = await agent
    .post(`${API}/auth/register`)
    .send(registrationPayload(overrides));
  return { agent, response };
}

/** Sign in with an existing account. */
export async function loginUser(
  app: Express,
  email: string,
  password: string = DEMO_PASSWORD,
) {
  const agent = request.agent(app);
  const response = await agent.post(`${API}/auth/login`).send({ email, password });
  return { agent, response };
}

/**
 * Extract the refresh-token cookie from a response. It is intentionally the
 * only place the raw refresh token can be observed — the API never returns it
 * in a JSON body.
 */
export function refreshCookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"] as unknown;
  const cookies = Array.isArray(header) ? (header as string[]) : header ? [String(header)] : [];
  const cookie = cookies.find((value) => value.startsWith("sc_refresh="));
  if (!cookie) {
    throw new Error("Expected a sc_refresh cookie on the response.");
  }
  return cookie.split(";")[0]!;
}

export function accessTokenFrom(response: request.Response): string {
  const token = (response.body as { data?: { accessToken?: string } }).data?.accessToken;
  if (!token) {
    throw new Error("Expected an access token in the response body.");
  }
  return token;
}

/** Authorization header value for a session. */
export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Register a senior and return the session plus their elder profile id. */
export async function createSenior(app: Express, overrides: RegisterOverrides = {}) {
  const { agent, response } = await registerUser(app, overrides);
  return {
    agent,
    response,
    token: accessTokenFrom(response),
    userId: (response.body as { data: { user: { id: string } } }).data.user.id,
    elderId: (response.body as { data: { user: { elderId: string } } }).data.user.elderId,
  };
}

/** Register a caregiver account. */
export async function createCaregiver(
  app: Express,
  overrides: RegisterOverrides = {},
) {
  const { agent, response } = await registerUser(app, {
    role: "CAREGIVER",
    ...overrides,
  });
  return {
    agent,
    response,
    token: accessTokenFrom(response),
    userId: (response.body as { data: { user: { id: string } } }).data.user.id,
  };
}

