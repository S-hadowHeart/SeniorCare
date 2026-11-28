# SeniorCare

> A production-grade platform for senior safety — daily check-ins, vital-sign tracking, medication adherence and SOS alerting, built for seniors, their families and professional caregivers.

[![CI](https://github.com/S-hadowHeart/SeniorCare/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/S-hadowHeart/SeniorCare/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A522.12-3c873a)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B-4169e1)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

---

## Table of contents

- [Overview](#overview)
- [Feature set](#feature-set)
- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [Security engineering](#security-engineering)
- [Scalability and reliability](#scalability-and-reliability)
- [Data model](#data-model)
- [API surface](#api-surface)
- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Coverage](#coverage)
- [Continuous integration](#continuous-integration)
- [Operations](#operations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Aging in place only works when someone is watching. SeniorCare gives a senior a single, low-friction daily routine — a check-in, a place to record vitals, and a clear medication schedule — while giving family members and caregivers a real-time view of what is happening and an escalation path when it is not.

The system is built as a TypeScript monorepo with a stateless REST API, a relational PostgreSQL data store with an explicit, indexed schema, and a React single-page application. It is designed around three non-negotiables:

1. **Safety-critical actions must never silently fail.** SOS delivery, missed check-ins and medication reminders are handled by explicit state machines and background jobs, with liveness/readiness probes and a graceful shutdown path.
2. **Health data is sensitive by default.** Clinical free text is encrypted at rest, access is scoped per care relationship, and the authentication flow is hardened against the common credential and session attacks.
3. **The platform must scale horizontally.** The API keeps no per-request state in memory, the database connection pool is explicit and bounded, and the realtime channel is a streaming protocol that a load balancer can route.

---

## Feature set

| Area | What it does |
| --- | --- |
| **Daily check-in** | Seniors confirm "I'm safe" or "I need help". A watchdog job escalates missed check-ins to the registered contacts. |
| **Vitals** | Blood pressure, blood sugar, heart rate, temperature, oxygen saturation and weight, with server-side clinical threshold flags and trend charts. |
| **Medication management** | Daily, weekly, interval and as-needed schedules; per-dose logging (`PENDING` / `TAKEN` / `SKIPPED` / `MISSED`); adherence reporting; caregiver reminders. |
| **SOS alerting** | One-tap emergency alert with a location snapshot, acknowledgement and resolution lifecycle, and per-caregiver notification. |
| **Care network** | Invitation-based care links with explicit capability scopes (`view vitals`, `manage medicines`, `manage contacts`, `acknowledge SOS`). No implicit access. |
| **Realtime updates** | Server-Sent Events push SOS, check-in, medication and notification events to signed-in clients. |
| **Notifications** | In-app feed plus e-mail (SMTP), with delivery status and failure reasons persisted for audit. |
| **Audit trail** | Append-only log of security-relevant actions (sign-in, registration, password change, care-link changes) with actor, IP and user agent. |

---

## Architecture

```mermaid
flowchart LR
  subgraph Client
    SPA["React 19 SPA<br/>Vite · Tailwind v4 · React Query"]
  end

  subgraph API["Express 5 API"]
    EDGE["Edge middleware<br/>request-id · logging · Helmet · CORS<br/>body limits · rate limiting"]
    AUTH["Auth<br/>JWT access + rotating refresh"]
    DOMAIN["Care domain<br/>elders · vitals · check-ins<br/>medications · contacts · SOS"]
    JOBS["Scheduled jobs<br/>check-in watchdog · reminders"]
    HUB["SSE hub"]
  end

  DB[("PostgreSQL 15+<br/>Prisma 7 · pg driver adapter")]
  SMTP[["SMTP relay"]]

  SPA -->|HTTPS · JSON + SSE| EDGE
  EDGE --> AUTH
  EDGE --> DOMAIN
  AUTH --> DB
  DOMAIN --> DB
  JOBS --> DB
  DOMAIN --> HUB
  HUB -->|event stream| SPA
  DOMAIN --> SMTP
```

**Request lifecycle.** Every request passes through, in order: request-id assignment → structured access logging → security headers → CORS allow-list → bounded body parsing → global rate limiting → route validation → controller → error handler. The ordering is deliberate: the cheapest and most security-relevant checks run first, and no database work happens for a request that is rate-limited or malformed.

**Layering.** Routes own HTTP concerns and validation; services own domain rules and transactions; `lib/access.ts` is the single authorization gateway for every elder-scoped resource. Nothing reads another person's care record without going through it.

---

## Technology stack

| Layer | Choice | Why |
| --- | --- | --- |
| API | **Node.js 24 LTS · Express 5** | Mature middleware ecosystem, first-class async error propagation. |
| Language | **TypeScript 5.9 (strict)** | End-to-end type safety across the monorepo. |
| ORM | **Prisma 7 + `@prisma/adapter-pg`** | Typed queries, migration history, and a driver adapter that removes the native engine from the deployment artifact. |
| Database | **PostgreSQL 15+** | Transactions, enums, partial indexes and `jsonb` for audit metadata. |
| Validation | **Zod 4** | One schema per boundary — environment variables, request bodies, query params. |
| Auth | **`jose` (JWT) + `@node-rs/argon2`** | Stateless short-lived access tokens; memory-hard password hashing. |
| Realtime | **Server-Sent Events** | One-way push with automatic reconnect, no extra protocol or sticky-session state. |
| Jobs | **`node-cron`** | Check-in watchdog and medication reminders. |
| Rate limiting | **`express-rate-limit` + optional Redis** | Shared counters across instances; per-process fallback when the store is unavailable. |
| Web | **React 19 · Vite · Tailwind CSS v4** | Fast iteration, modern concurrency, utility-first styling. |
| Data fetching | **TanStack Query · react-hook-form + Zod** | Cache-aware server state and schema-validated forms. |
| Charts | **Recharts** | Accessible SVG trend and adherence visualisations. |

---

## Security engineering

Security is treated as a set of enforced defaults rather than a checklist. The controls below are implemented in the codebase, not aspirational.

#### Authentication and sessions

- **Argon2id password hashing** (`server/src/lib/crypto.ts`) with OWASP-recommended parameters — 19 MiB memory, 2 iterations, 1 lane — which is memory-hard and resistant to GPU cracking. Password verification returns `false` for malformed hashes instead of throwing.
- **Short-lived HS256 access tokens** (15 minutes by default) with issuer, audience and `jti` claims, and algorithm pinning during verification (`server/src/lib/jwt.ts`).
- **Opaque, rotating refresh tokens.** The refresh credential is a 256-bit random value whose **SHA-256 hash** is the only thing stored. It is delivered in an `httpOnly`, `SameSite=Strict`, path-scoped cookie that is marked `Secure` in production (`server/src/modules/auth/auth.routes.ts`).
- **Refresh-token reuse detection.** Refresh tokens are single-use and grouped into families. Presenting an already-rotated token is treated as theft: the entire family is revoked and the user must sign in again (`rotateRefreshToken` in `auth.service.ts`).
- **Double-submit CSRF tokens.** Refresh and logout require `X-CSRF-Token` to match the random `sc_csrf` cookie in constant time. The cookie is `SameSite=Strict`, readable by the SPA, and rotated on every refresh; `SameSite=Strict` remains the first layer, not the only one (`server/src/middleware/csrf.ts`).
- **Account lockout** after a configurable number of failed attempts, with a timed lock, and **uniform response timing** for unknown accounts via a dummy Argon2 verification, which closes the user-enumeration side channel.
- **Generic authentication errors.** Expired, forged and wrong-audience tokens all return the same problem document, so an attacker learns nothing from the failure mode.
- **Password change invalidates every session** and emits a security notification.

#### Authorization

- **Two-layer model:** platform roles (`SENIOR`, `CAREGIVER`, `ADMIN`) plus **per-relationship capability flags** on each `CareLink` (`canViewVitals`, `canManageMedicines`, `canManageContacts`, `canAcknowledgeSos`). A doctor can therefore be granted read-only vitals access without inventing a new role.
- **One authorization gateway.** Every elder-scoped route resolves access through `getElderAccess()` in `server/src/lib/access.ts`; ownership, admin status and active care links are the only paths to a record.
- **No mass-assignment.** Request bodies are parsed by explicit Zod schemas; database writes name their fields explicitly.

#### Data protection

- **AES-256-GCM field-level encryption** for clinical free text — check-in notes, vital notes, medical history and medication instructions — with a random IV and authentication tag per value, and a versioned envelope (`v1:<iv>:<tag>:<ciphertext>`). Tampering is detected on read (`server/src/lib/crypto.ts`).
- **Secrets never enter the repository.** `.env`, build output, the generated Prisma client and dependencies are excluded; only `.env.example` is tracked, and production boot refuses placeholder secrets.
- **Fail-fast configuration.** `server/src/config/env.ts` validates every variable with Zod and **refuses to start in production** if the JWT secret is a placeholder or shorter than 48 characters, if `ENCRYPTION_KEY` is missing, if CORS points at localhost, or if e-mail delivery is disabled.

#### Transport and HTTP hardening

- **Helmet** with a `default-src 'none'` CSP for the JSON API, `frame-ancestors 'none'`, `referrer-policy: no-referrer`, `X-Content-Type-Options: nosniff` and HSTS (production only, with preload).
- **Strict CORS allow-list.** Only explicitly configured origins receive credentialed responses; rejected origins get a clean `403` problem document instead of a `500`, and `Vary: Origin` is emitted so shared caches cannot serve cross-origin responses.
- **Layered rate limiting** (`server/src/middleware/rateLimit.ts`): a global bucket, a strict credential bucket that skips successful logins, a generous SOS bucket (safety feature — the limit exists to stop a stuck button, not a real emergency) and an e-mail bucket. Authenticated callers are keyed by user id; anonymous callers by an IPv6-normalised IP so a /64 cannot be rotated to bypass the limit.
- **Bounded input**: JSON and URL-encoded bodies are capped at 100 kB.
- **Slowloris protection** at the HTTP server level — 20 s header timeout, 30 s request timeout, bounded requests per socket.

#### Observability and audit

- **Correlation IDs** on every request, echoed in the `X-Request-Id` header and attached to every log line and error.
- **Structured logging** with `pino`, with request bodies and credentials never logged.
- **RFC 9457 problem documents** for every error, including a stable machine-readable `code`, so clients can branch on reason without parsing prose.
- **Append-only audit log** for authentication and care-network events.

#### Threat model at a glance

| Threat | Mitigation |
| --- | --- |
| Credential stuffing / brute force | Argon2id, per-account lockout, strict auth rate limit, generic errors |
| User enumeration | Uniform timing via dummy hash, identical error documents |
| Access-token theft | 15-minute TTL, issuer/audience pinning, algorithm allow-list |
| Refresh-token theft | Hash-at-rest, single use, rotation, family-wide revocation on replay |
| XSS-driven token theft | Refresh token in an `httpOnly` cookie, no token in `localStorage` |
| CSRF | `SameSite=Strict` cookies, double-submit token on refresh/logout, explicit CORS allow-list |
| Horizontal privilege escalation | Single elder-access gateway, capability-scoped care links |
| Data-at-rest exposure | AES-256-GCM encryption of clinical free text |
| Injection | Parameterised Prisma queries, Zod-validated inputs, no dynamic SQL |
| Resource exhaustion | Body limits, rate limits, connection-pool bounds, request timeouts |

---

## Scalability and reliability

- **Stateless API.** No session state lives in process memory, so instances can be added or removed behind a load balancer at any time.
- **Bounded database pool.** The Prisma client uses the `pg` driver adapter with an explicit `DATABASE_POOL_SIZE`, connection and idle timeouts, `keepAlive`, a maximum connection lifetime, and pool error listeners that keep an idle-socket drop from crashing the process (`server/src/lib/prisma.ts`).
- **Indexed for the hot paths.** Every foreign key is indexed, and composite/descending indexes match the dashboard and timeline queries (`WHERE elder_id = ? ORDER BY created_at DESC`). See the annotations in `server/prisma/schema.prisma`.
- **Database-enforced integrity.** Enums model the SOS, dose and check-in state machines, so invalid transitions cannot be persisted even if application code regresses.
- **Probes that mean something.** `/health` is a pure liveness probe that never touches the database; `/health/ready` verifies connectivity with `SELECT 1` so a rolling deploy does not route traffic to an instance that cannot serve it.
- **Graceful shutdown.** On `SIGTERM`/`SIGINT` the server stops accepting connections, drains SSE streams, closes keep-alive sockets, disconnects the pool, and force-exits after a 15 s budget — with a handler for uncaught exceptions.
- **Realtime without polling.** SSE with compression correctly bypassed for event streams, so proxies do not buffer alerts.
- **Shared rate limits when scaled out.** `express-rate-limit` uses per-process memory by default; setting `REDIS_URL` moves every limiter's counters into Redis so limits hold across instances. A failed Redis command degrades to the local memory store with a throttled warning, so a cache outage cannot take down login or SOS.
- **Client-side efficiency.** React Query deduplicates and caches server state; strong ETags and gzip/brotli compression reduce repeat payloads.
- **Operational limits documented honestly.** Multi-instance deployments should back the SSE hub with a shared pub/sub and run scheduled jobs behind a distributed lock; both are tracked in [`docs/roadmap.md`](docs/roadmap.md).

---

## Data model

The schema (`server/prisma/schema.prisma`) is organised around a senior's **elder profile** and the people and events around it:

- `User` → one `Elder` profile (seniors) or many `CareLink`s (caregivers).
- `Elder` → `CareLink`, `EmergencyContact`, `CheckIn`, `Vital`, `Medication` → `MedicationLog`, `SosAlert`, `LocationPing`.
- `RefreshToken` (hashed, family-grouped) and `AuditLog` support the security model.
- `Notification` records every in-app/e-mail message with channel, status and failure reason.

Migrations are versioned under `server/prisma/migrations/` and applied with `prisma migrate deploy` in production.

---

## API surface

All routes are prefixed with `/api/v1`. Authentication uses `Authorization: Bearer <access-token>`; the refresh token travels only in its cookie. The cookie-authenticated `POST /auth/refresh` and `POST /auth/logout` endpoints also require `X-CSRF-Token` to match the `sc_csrf` cookie.

| Group | Representative endpoints |
| --- | --- |
| Health | `GET /health`, `GET /health/ready` |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`, `/auth/change-password`, `GET /auth/me` |
| Elders | `GET/POST /elders`, `GET/PATCH /elders/:elderId` |
| Check-ins | `GET/POST /elders/:elderId/checkins` |
| Vitals | `GET/POST /elders/:elderId/vitals` |
| Medications | `GET/POST /elders/:elderId/medications`, `PATCH/DELETE /medications/:id`, dose logging |
| Contacts | `GET/POST /elders/:elderId/contacts`, `PATCH/DELETE /contacts/:id` |
| Care links | `GET/POST /elders/:elderId/care-links`, invitation accept/revoke |
| SOS | `POST/GET /elders/:elderId/sos`, acknowledge, resolve, cancel |
| Locations | `GET/POST /elders/:elderId/locations` |
| Dashboard | `GET /dashboard` |
| Notifications | `GET /notifications`, mark read |
| Realtime | `GET /events` (SSE) |

Errors follow RFC 9457 (`application/problem+json`) and always carry a `requestId` for correlation.

---

## Getting started

**Prerequisites:** Node.js **22.12 LTS or 24 LTS** (see `.nvmrc`), PostgreSQL **15+**, npm 10+.

```bash
# 1. Install workspace dependencies
npm install

# 2. Configure the API
cp server/.env.example server/.env        # Windows PowerShell: Copy-Item server/.env.example server/.env

# 3. Generate two secrets and paste them into server/.env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" # ENCRYPTION_KEY

# 4. Create the schema and seed demo data
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed

# 5. Run the API and the web client together
npm run dev
```

- API: <http://localhost:4000/api/v1>
- Web: <http://localhost:5173>

The seed script creates a senior, two caregivers and a doctor. Demo accounts all use the password `SeniorCare2024`:

| Role | E-mail |
| --- | --- |
| Senior | `margaret@example.com` |
| Caregiver | `david@example.com` |
| Doctor | `dr.okafor@example.com` |

Useful scripts: `npm run typecheck`, `npm run build`, `npm run prisma:studio`, `npm run db:reset`.

---

## Project structure

```
.
├── server/                    # Express 5 API
│   ├── prisma/
│   │   ├── schema.prisma      # models, enums, indexes
│   │   ├── migrations/        # versioned SQL
│   │   └── seed.ts            # demo data
│   ├── scripts/smoke.ts       # end-to-end smoke suite
│   ├── tests/                 # Vitest unit + integration suites
│   └── src/
│       ├── config/env.ts      # validated configuration
│       ├── middleware/        # security, CORS, rate limit, validation, errors
│       ├── modules/           # auth, elders, vitals, meds, SOS, contacts, care-links
│       ├── jobs/              # check-in watchdog, medication reminders
│       ├── realtime/          # SSE hub and event bus
│       ├── notifications/     # in-app + SMTP delivery and templates
│       └── lib/               # crypto, jwt, access control, prisma, logging
├── web/                       # React 19 + Vite client
│   └── src/
│       ├── pages/             # senior, caregiver and auth experiences (+ form tests)
│       ├── components/        # design system, charts, layout, SOS button (+ tests)
│       ├── context/           # auth, theme, toast, realtime (+ auth tests)
│       ├── test/              # Vitest + Testing Library setup
│       └── lib/               # API client, formatting, geolocation
├── docs/roadmap.md
├── package.json               # npm workspaces
└── .env.example               # documented configuration surface
```

---

## Testing

### Test suites (Vitest)

The platform has two test layers. The server suites pair fast unit tests for pure domain logic with integration tests that run against a real PostgreSQL database through the same Express app and Prisma client as production — no mocks of the security layers. The web client runs its React components in jsdom through Testing Library.

```bash
# Point the server suite at an isolated database or schema (it truncates every table):
export TEST_DATABASE_URL="postgresql://user:pass@host:5432/seniorcare_test?schema=seniorcare_test"

npm run test --workspace server
npm run test --workspace web   # no database required
```

`npm test` at the repository root runs both. Together the suites contain **191 tests across fourteen files**.

On the first run, apply the migrations to that database (create the schema first if you are using one):

```bash
cd server
DATABASE_URL="$TEST_DATABASE_URL" DIRECT_DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
cd ..
```

`TEST_DATABASE_URL` is deliberately mandatory and has no fallback to `DATABASE_URL`, so a misconfigured run cannot destroy development data. The server suites currently contain **161 tests** across ten files. A dedicated isolation test asserts that the live connection's `current_schema()` is the schema named in that URL, so a client that ignores the parameter fails loudly instead of truncating `public`.

**Authentication (24 tests)**

- account creation for seniors and caregivers, including the elder profile;
- refresh-cookie hardening (`HttpOnly`, `SameSite=Strict`, path scope), the readable `SameSite=Strict` CSRF cookie, and the guarantee that the refresh token never appears in a JSON body;
- double-submit CSRF enforcement on refresh and logout, including a rejected request that does not consume the refresh token;
- case-insensitive login and duplicate-address rejection;
- identical error responses for unknown accounts and wrong passwords;
- account lockout after the configured number of failures, including lockout of the correct password;
- refresh-token rotation and **family-wide revocation on replay**;
- forged and malformed bearer tokens;
- logout revocation and password-change session invalidation;
- audit-log writes and request-id correlation on errors.

**Authorization (19 tests)**

- an unrelated caregiver, and an unrelated senior, are denied on every elder-scoped route;
- the owner retains full access to their own record;
- an active care link grants read access, but undelegated write capabilities are refused;
- `manage medications` and `manage contacts` are enforced independently;
- `acknowledge SOS` is enforced separately from read access;
- revoked links and permission changes take effect on the very next request;
- a caregiver cannot escalate their own permissions — the attempt returns `403` and leaves the link intact;
- a pending invitation is bound to the invited e-mail, and a third party's attempt to accept it returns `404`;
- `GET /elders` only returns records the caller can access;
- inviting another caregiver requires both family relation and contact-management rights;
- an administrator may read any record but still cannot edit the clinical profile.

**Domain logic (91 tests)**

- every clinical threshold boundary for blood pressure, heart rate, temperature, oxygen saturation and blood sugar, in both `mg/dL` and `mmol/L`;
- a blood-pressure reading without a diastolic value is classified from systolic alone instead of being coerced to zero (regression test);
- time-zone conversion, DST-aware local-day boundaries (the 23- and 25-hour days) and strict `HH:mm` parsing;
- medication expansion for daily, weekly and interval schedules, including start/end dates, malformed times and doses that straddle a DST transition.

**Check-in lifecycle (10 tests)**

- the senior records `SAFE` or `NEEDS_HELP`, and the free-text note is encrypted at rest;
- `MISSED` is system-generated only; out-of-range moods and future timestamps are rejected with `400`;
- only the senior may record their own check-in — a caregiver with read access receives `403`, because otherwise they could silently satisfy the watchdog;
- a help request notifies every active caregiver and e-mails contacts with the dedicated help-request copy, never the missed-check-in copy;
- the watchdog creates exactly one `MISSED` record and one notification per day, never duplicates on re-run, and stays silent once a real check-in exists.

**Notification templates (3 tests)**

- a help request and a missed check-in are distinct messages, so a contact is never told that someone “has not checked in” when they have just asked for help;
- optional notes are omitted cleanly, and the plain-text and HTML versions carry the same information.

**Database isolation (4 tests)**

- the client connects to the schema named by `?schema=` instead of falling back to `public`, and raw SQL such as `TRUNCATE` resolves against the same schema;
- a URL without a schema leaves the connection untouched;
- a schema name containing quotes or statement separators is rejected before it can reach the server's startup parameters.

**Rate-limit store (10 tests)**

- Redis counters are shared and reset through the store; the integration test runs whenever `REDIS_URL` is set, and CI provides a disposable Redis 7 instance;
- increment, decrement, key reset and full reset fall back to a process-local memory store when Redis throws, so a cache outage degrades instead of failing requests;
- the first command connects lazily, a failed connection is retried at most every 30 seconds, and `init`/`shutdown` are delegated to both stores;
- test runs use the memory store, so the API suites never depend on a running Redis.

### Web component tests

**30 tests across four files**, run in jsdom with Testing Library.

**HTTP client (3 tests)**

- the CSRF cookie is echoed in `X-CSRF-Token` on mutating requests and on the single-flight refresh call;
- safe GET requests omit the header, avoiding an unnecessary CORS preflight.

**Authentication state (7 tests)**

- the provider settles on anonymous when there is no refresh cookie, and restores the session when the cookie and `/auth/me` both succeed;
- sign-in and registration store the user and access token;
- signing out clears local state even when the revoke request fails;
- using `useAuth` outside the provider fails loudly.

**Sign-in and registration (13 tests)**

- required fields, e-mail format, password length, letter/number composition, password confirmation and phone format are validated before any request;
- the API's problem detail is shown when credentials are rejected, and a successful sign-in navigates to the right home (including the originally requested page);
- the caregiver role hides the elder profile and submits no elder payload, while the senior role maps preferred name, date of birth, blood type and comma-separated conditions into the API contract;
- demo-account shortcuts fill the form.

**SOS flow (7 tests)**

- the alert is sent before the GPS lookup finishes, then enriched with a second update when the position arrives;
- a denied location permission still sends the alert and explains why no map is attached;
- cancelling before sending makes no request, and an active alert can be cancelled afterwards;
- a failed send shows an explicit failure state with the emergency-services instruction;
- an account without an elder profile cannot trigger an alert;
- the confirmation dialog focuses **Cancel**, never the destructive action, and keeps focus in the message field while the user types.

### Coverage

Both Vitest suites collect V8 coverage with `npm run test:coverage`. The build fails if the global totals drop below the committed floors:

| Suite | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| API | 65.5% | 56.5% | 57.0% | 66.5% |
| Web | 21.6% | 13.7% | 17.9% | 22.5% |

CI prints the current totals in the job summary and uploads the `json-summary`, `lcov` and HTML reports as the `coverage-reports` artifact. Generated Prisma code, the process bootstrap and the test harness are excluded, so the numbers describe application code. The web floors sit close to the current totals while the remaining pages gain component coverage; they ratchet upward as tests are added.

### End-to-end smoke suite

A second suite exercises the whole platform over HTTP against a running, seeded API:

```bash
node --import tsx server/scripts/smoke.ts http://127.0.0.1:4000/api/v1
```

It covers registration and login for all roles, check-ins, vitals, medication scheduling and adherence, emergency contacts, the SOS lifecycle (trigger, acknowledge, resolve, cancel), care-link invitations and the realtime event stream. The smoke suite is an operator check against a seeded instance; CI runs the Vitest suites and the production build.

### Continuous integration

Every push to `main` and every pull request runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml) on GitHub Actions:

- Node.js 24 from `.nvmrc`, with npm dependency caching;
- a PostgreSQL 17 and Redis 7 service container pair — PostgreSQL holds the isolated `seniorcare_test` schema, migrations are applied with `prisma migrate deploy`, and Redis exercises the distributed rate-limit store;
- Prisma client generation, typecheck, ESLint, the production build and both Vitest suites with V8 coverage — against a throwaway database with no repository secrets;
- a job summary with the coverage totals and a `coverage-reports` artifact containing the JSON, LCOV and HTML reports.

`main` is protected: the **Build and test** check is required and must be up to date, pull requests need one approving review (stale approvals are dismissed), history must be linear, conversations must be resolved, and force pushes or deletions are blocked.

---

## Operations

- **Configuration is validated at boot.** A production process refuses to start with placeholder secrets, missing encryption keys, localhost CORS origins or disabled mail.
- **Logs are structured JSON** (pretty-printed only in development) and carry the request id, user id and route.
- **Health probes** are suitable for Kubernetes/ECS readiness and liveness checks.
- **Graceful shutdown** is safe for rolling deploys and autoscaling.
- **SMTP is optional in development** — with `MAIL_ENABLED=false` messages are logged instead of sent, so local work needs no mail server.
- **Redis is optional.** Without `REDIS_URL` rate-limit counters live in process memory; with it they are shared across instances. The connection is lazy, so Redis being down cannot prevent the API from booting, and a failed command falls back to the local store.

---

## Roadmap

The remaining milestones — coverage reporting, container images, shared pub/sub for multi-instance SSE, and a distributed job lock — are tracked in [`docs/roadmap.md`](docs/roadmap.md).

---

## Contributing

Development follows a protected-`main` workflow: every change lands through a focused branch and a reviewed pull request. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for branch naming, commit conventions and the review checklist.

---

## License

Released under the [MIT License](LICENSE).
