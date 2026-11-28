import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { queryAuditLogs } from "../src/modules/audit/audit.service.js";
import { prisma } from "../src/lib/prisma.js";
import {
  API,
  bearer,
  buildApp,
  closeDatabase,
  createCaregiver,
  createSenior,
  resetDatabase,
} from "./helpers.js";

const app = buildApp();
const MINUTE = 60_000;

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

function metadata(row: { metadata: unknown }): Record<string, unknown> {
  return (row.metadata ?? {}) as Record<string, unknown>;
}

describe("structured audit coverage", () => {
  it("records every care-link state change", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });

    const invite = await request(app)
      .post(`${API}/elders/${senior.elderId}/care-links`)
      .set(bearer(senior.token))
      .send({ email: "late@example.com", relation: "FAMILY" });
    expect(invite.status).toBe(201);
    const linkId = invite.body.data.id as string;

    const caregiver = await createCaregiver(app, {
      email: "late@example.com",
      name: "Late Carer",
    });

    const accepted = await request(app)
      .patch(`${API}/care-links/${linkId}`)
      .set(bearer(caregiver.token))
      .send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe("ACTIVE");

    const updated = await request(app)
      .patch(`${API}/care-links/${linkId}`)
      .set(bearer(senior.token))
      .send({ canViewVitals: false });
    expect(updated.status).toBe(200);

    const revoked = await request(app)
      .patch(`${API}/care-links/${linkId}`)
      .set(bearer(senior.token))
      .send({ status: "REVOKED" });
    expect(revoked.status).toBe(200);

    // Re-invite, then let the caregiver revoke themselves: the other branch.
    const reinvited = await request(app)
      .post(`${API}/elders/${senior.elderId}/care-links`)
      .set(bearer(senior.token))
      .send({ email: "late@example.com", relation: "FAMILY" });
    expect(reinvited.status).toBe(201);

    const selfRevoked = await request(app)
      .patch(`${API}/care-links/${linkId}`)
      .set(bearer(caregiver.token))
      .send({ status: "REVOKED" });
    expect(selfRevoked.status).toBe(200);

    const page = await queryAuditLogs({ entity: "CareLink", entityId: linkId, limit: 20 });
    const actions = page.entries.map((entry) => entry.action);

    expect(actions.filter((action) => action === "careLink.created")).toHaveLength(2);
    expect(actions).toContain("careLink.accepted");
    expect(actions).toContain("careLink.updated");
    expect(actions.filter((action) => action === "careLink.revoked")).toHaveLength(2);

    const acceptedRow = page.entries.find((entry) => entry.action === "careLink.accepted");
    expect(acceptedRow?.actorId).toBe(caregiver.userId);
    expect(metadata(acceptedRow!).caregiverId).toBe(caregiver.userId);

    const updatedRow = page.entries.find((entry) => entry.action === "careLink.updated");
    expect(metadata(updatedRow!).changed).toEqual(["canViewVitals"]);

    const selfRevokedRow = page.entries.find(
      (entry) => entry.action === "careLink.revoked" && metadata(entry).selfRevoked === true,
    );
    expect(selfRevokedRow?.actorId).toBe(caregiver.userId);
  }, 90_000);

  it("records medication creation, dose changes, updates and stops", async () => {
    const senior = await createSenior(app);

    const created = await request(app)
      .post(`${API}/elders/${senior.elderId}/medications`)
      .set(bearer(senior.token))
      .send({
        name: "Amlodipine",
        dosage: "5 mg",
        scheduleType: "DAILY",
        times: ["08:00"],
      });
    expect(created.status).toBe(201);
    const medicationId = created.body.data.id as string;

    const scheduledFor = new Date(Date.now() + MINUTE).toISOString();
    const dose = await request(app)
      .post(`${API}/elders/${senior.elderId}/medications/${medicationId}/doses`)
      .set(bearer(senior.token))
      .send({ scheduledFor, status: "TAKEN" });
    expect(dose.status).toBe(200);
    const logId = dose.body.data.id as string;

    const updated = await request(app)
      .patch(`${API}/medications/${medicationId}`)
      .set(bearer(senior.token))
      .send({ dosage: "10 mg" });
    expect(updated.status).toBe(200);

    const stopped = await request(app)
      .delete(`${API}/medications/${medicationId}`)
      .set(bearer(senior.token));
    expect(stopped.status).toBe(200);

    const medicationPage = await queryAuditLogs({
      entity: "Medication",
      entityId: medicationId,
      limit: 20,
    });
    expect(medicationPage.entries.map((entry) => entry.action).sort()).toEqual([
      "medication.created",
      "medication.stopped",
      "medication.updated",
    ]);

    const createdRow = medicationPage.entries.find(
      (entry) => entry.action === "medication.created",
    );
    expect(metadata(createdRow!).name).toBe("Amlodipine");

    const updatedRow = medicationPage.entries.find(
      (entry) => entry.action === "medication.updated",
    );
    expect(metadata(updatedRow!).changed).toEqual(["dosage"]);

    const dosePage = await queryAuditLogs({
      entity: "MedicationLog",
      entityId: logId,
      limit: 20,
    });
    expect(dosePage.entries).toHaveLength(1);
    expect(dosePage.entries[0]?.action).toBe("medication.dose_recorded");
    expect(metadata(dosePage.entries[0]!).status).toBe("TAKEN");
  }, 90_000);

  it("records SOS trigger, acknowledgement, resolution and cancellation", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });
    const caregiver = await createCaregiver(app, { email: "carer@example.com" });

    const invite = await request(app)
      .post(`${API}/elders/${senior.elderId}/care-links`)
      .set(bearer(senior.token))
      .send({
        email: "carer@example.com",
        relation: "FAMILY",
        canAcknowledgeSos: true,
      });
    expect(invite.status).toBe(201);

    const first = await request(app)
      .post(`${API}/elders/${senior.elderId}/sos`)
      .set(bearer(senior.token))
      .send({ message: "I have fallen." });
    expect(first.status).toBe(201);
    const firstId = first.body.data.id as string;

    const acknowledged = await request(app)
      .post(`${API}/sos/${firstId}/acknowledge`)
      .set(bearer(caregiver.token));
    expect(acknowledged.status).toBe(200);

    const resolved = await request(app)
      .post(`${API}/sos/${firstId}/resolve`)
      .set(bearer(caregiver.token))
      .send({ note: "Ambulance arrived." });
    expect(resolved.status).toBe(200);

    const second = await request(app)
      .post(`${API}/elders/${senior.elderId}/sos`)
      .set(bearer(senior.token))
      .send({ message: "False alarm." });
    expect(second.status).toBe(201);
    const secondId = second.body.data.id as string;

    const cancelled = await request(app)
      .post(`${API}/sos/${secondId}/cancel`)
      .set(bearer(senior.token));
    expect(cancelled.status).toBe(200);

    const firstPage = await queryAuditLogs({
      entity: "SosAlert",
      entityId: firstId,
      limit: 20,
    });
    expect(firstPage.entries.map((entry) => entry.action).sort()).toEqual([
      "sos.acknowledged",
      "sos.resolved",
      "sos.triggered",
    ]);

    const acknowledgedRow = firstPage.entries.find(
      (entry) => entry.action === "sos.acknowledged",
    );
    expect(acknowledgedRow?.actorId).toBe(caregiver.userId);

    const resolvedRow = firstPage.entries.find((entry) => entry.action === "sos.resolved");
    expect(metadata(resolvedRow!).hasNote).toBe(true);

    const secondPage = await queryAuditLogs({
      entity: "SosAlert",
      entityId: secondId,
      limit: 20,
    });
    expect(secondPage.entries.map((entry) => entry.action).sort()).toEqual([
      "sos.cancelled",
      "sos.triggered",
    ]);
  }, 90_000);
});

describe("queryAuditLogs", () => {
  it("filters by actor, action, entity, id and time range", async () => {
    const senior = await createSenior(app);
    const base = Date.now();

    await prisma.auditLog.createMany({
      data: [
        { actorId: senior.userId, action: "test.one", entity: "Test", entityId: "entity-1", createdAt: new Date(base - 4 * MINUTE) },
        { actorId: senior.userId, action: "test.two", entity: "Test", entityId: "entity-1", createdAt: new Date(base - 3 * MINUTE) },
        { actorId: senior.userId, action: "test.three", entity: "Test", entityId: "entity-1", createdAt: new Date(base - 2 * MINUTE) },
        { actorId: senior.userId, action: "test.four", entity: "Test", entityId: "entity-1", createdAt: new Date(base - MINUTE) },
        { actorId: senior.userId, action: "test.five", entity: "Test", entityId: "entity-1", createdAt: new Date(base) },
      ],
    });

    const byAction = await queryAuditLogs({ action: "test.three" });
    expect(byAction.entries).toHaveLength(1);
    expect(byAction.entries[0]?.actor?.email).toBe("margaret@example.com");

    const range = await queryAuditLogs({
      entity: "Test",
      entityId: "entity-1",
      from: new Date(base - 3 * MINUTE),
      to: new Date(base - MINUTE),
    });
    expect(range.entries.map((entry) => entry.action).sort()).toEqual([
      "test.four",
      "test.three",
      "test.two",
    ]);

    const empty = await queryAuditLogs({ entity: "Nope" });
    expect(empty.entries).toHaveLength(0);
    expect(empty.nextCursor).toBeNull();
  });

  it("pages newest-first with a stable cursor", async () => {
    const senior = await createSenior(app);
    const base = Date.now();

    await prisma.auditLog.createMany({
      data: [
        { actorId: senior.userId, action: "test.one", entity: "Test", createdAt: new Date(base - 4 * MINUTE) },
        { actorId: senior.userId, action: "test.two", entity: "Test", createdAt: new Date(base - 3 * MINUTE) },
        { actorId: senior.userId, action: "test.three", entity: "Test", createdAt: new Date(base - 2 * MINUTE) },
        { actorId: senior.userId, action: "test.four", entity: "Test", createdAt: new Date(base - MINUTE) },
        { actorId: senior.userId, action: "test.five", entity: "Test", createdAt: new Date(base) },
      ],
    });

    const first = await queryAuditLogs({
      entity: "Test",
      actorId: senior.userId,
      limit: 2,
    });
    expect(first.entries.map((entry) => entry.action)).toEqual(["test.five", "test.four"]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await queryAuditLogs({
      entity: "Test",
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.entries.map((entry) => entry.action)).toEqual(["test.three", "test.two"]);
    expect(second.nextCursor).toEqual(expect.any(String));

    const third = await queryAuditLogs({
      entity: "Test",
      limit: 2,
      cursor: second.nextCursor!,
    });
    expect(third.entries.map((entry) => entry.action)).toEqual(["test.one"]);
    expect(third.nextCursor).toBeNull();
  });
});
