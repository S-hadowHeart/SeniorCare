# SeniorCare — Engineering Roadmap

This is the working plan for the next month of development. Each item is a real,
verifiable improvement to the platform, sized to land in a single focused branch
and pull request. Nothing here is decorative: every task either increases
correctness, reduces operational risk, or improves the experience for seniors and
caregivers.

**Cadence.** Small, reviewable changes. One branch per task, one PR per branch,
`main` always green. See [`CONTRIBUTING.md`](../CONTRIBUTING.md).

**Current baseline (already implemented):** hardened authentication and session
rotation, capability-scoped authorization, field-level encryption, layered rate
limiting, validated configuration, background jobs, SSE realtime, graceful
shutdown and an end-to-end smoke suite.

---

## Week 1 — Test foundation and continuous integration

| Day | Task | Deliverable / acceptance criteria |
| --- | --- | --- |
| 1 ✅ | Test harness for the API | Vitest configured with a disposable PostgreSQL database; helpers for creating users and sessions. |
| 2 ✅ | Auth integration tests | Register, login, refresh rotation, replay detection, lockout and password change covered end to end. |
| 3 ✅ | Authorization tests | Table-driven tests proving a caregiver cannot read an unrelated elder, and that each `CareLink` capability is enforced. |
| 4 | Domain tests | Vitals thresholding, medication schedule expansion and check-in status transitions. |
| 5 | Web component tests | Auth context, form validation and the SOS flow with Testing Library. |
| 6 | CI pipeline | GitHub Actions: install, `prisma generate`, typecheck, lint and tests on every PR. Required status check on `main`. |
| 7 | Coverage and branch protection | Coverage reporting, protected `main`, required review and linear history. |

## Week 2 — Hardening and observability

| Day | Task | Deliverable / acceptance criteria |
| --- | --- | --- |
| 8 | Distributed rate-limit store | Optional Redis store so limits hold across instances; in-memory fallback for single-node and tests. |
| 9 | CSRF defence in depth | Double-submit token for state-changing cookie flows, alongside the existing `SameSite=Strict` policy. |
| 10 | Session hygiene job | Scheduled cleanup of expired/revoked refresh tokens and stale audit rows. |
| 11 | Structured audit coverage | Audit entries for every care-link, medication and SOS state change, with a query helper. |
| 12 | Metrics endpoint | Prometheus counters/histograms for request latency, error rate, SSE connections and job outcomes. |
| 13 | Alerting runbook | Documented SLOs and alert thresholds for SOS latency, job failures and database saturation. |
| 14 | Dependency and secret scanning | Dependabot, `npm audit` in CI and a secret-scanning check. |

## Week 3 — Horizontal scale and delivery

| Day | Task | Deliverable / acceptance criteria |
| --- | --- | --- |
| 15 | Shared realtime bus | Publish events through Redis pub/sub so SSE fans out correctly across instances. |
| 16 | Distributed job lock | Leader election for the watchdog and reminder jobs so they run once per cluster. |
| 17 | Container image | Multi-stage Dockerfile for the API and a static build for the web client; non-root user, healthcheck. |
| 18 | Local compose stack | `docker compose up` brings up PostgreSQL, API and web with seeded data. |
| 19 | Reverse proxy config | TLS termination, HSTS, gzip/brotli and correct SSE buffering behaviour. |
| 20 | Zero-downtime deploy | Readiness-gated rollout and migration strategy documented and rehearsed. |
| 21 | Backup and restore drill | Automated `pg_dump`, restore verification and documented RPO/RTO. |

## Week 4 — Product polish and release

| Day | Task | Deliverable / acceptance criteria |
| --- | --- | --- |
| 22 | Accessibility pass | Keyboard navigation, focus management, contrast and ARIA on the SOS and medication flows. |
| 23 | Offline-tolerant check-in | Optimistic check-in with retry and clear failure states on flaky mobile networks. |
| 24 | Notification preferences | Per-contact channel and quiet-hours settings. |
| 25 | Caregiver dashboard performance | Virtualised lists and query tuning validated against a seeded dataset. |
| 26 | Error tracking | Client and server error reporting with release tagging and request-id correlation. |
| 27 | Documentation refresh | Architecture decision records, API examples and an operations guide. |
| 28 | Release candidate | Full regression run, changelog, version bump and tag. |
| 29 | Load test | Sustained-load test of the dashboard and SOS path; document the results and the new bottleneck. |
| 30 | Retrospective and next cycle | Measure against the SLOs, record what changed, and open the next month's plan. |

---

## Definition of done

A task is complete only when:

- it has automated tests that fail without the change;
- `npm run typecheck`, `npm run lint` and the test suite pass in CI;
- the change is reviewed in a pull request and merged with a linear history;
- user-facing or operational behaviour is documented.

## Progress log

- **2026-11-21** — Test harness landed (`server/vitest.config.ts`, `server/tests/`). Auth integration suite added: 20 tests covering registration, login, lockout, refresh rotation and replay revocation, logout, password change, audit logging and request-id correlation. Runs against an isolated schema via `TEST_DATABASE_URL`; the suite truncates only that schema.
- **2026-11-22** — Authorization suite added (19 tests): elder-scoped access, care-link capability scopes, invitation binding, revocation, listing and administrator read access. Two bugs found and fixed: an unauthorised care-link `PATCH` silently revoked the caller instead of returning `403`, and partial medication updates were rejected because create-time defaults leaked into the update schema.

## Guiding principles

1. **Safety first.** Anything on the SOS or missed-check-in path is tested and observable before it ships.
2. **No hidden state.** Prefer explicit, inspectable data over in-memory magic.
3. **Boring where it matters.** Use well-understood primitives for auth, storage and delivery.
4. **Small PRs.** If a change cannot be reviewed in one sitting, it is split.
