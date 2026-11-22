import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  API,
  accessTokenFrom,
  bearer,
  buildApp,
  closeDatabase,
  createCaregiver,
  createSenior,
  loginUser,
  resetDatabase,
} from "./helpers.js";
import { hashPassword } from "../src/lib/crypto.js";
import { prisma } from "../src/lib/prisma.js";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

interface LinkOptions {
  seniorEmail?: string;
  caregiverEmail?: string;
  relation?: "FAMILY" | "CAREGIVER" | "DOCTOR" | "NEIGHBOUR" | "OTHER";
  permissions?: {
    canViewVitals?: boolean;
    canManageMedicines?: boolean;
    canManageContacts?: boolean;
    canAcknowledgeSos?: boolean;
  };
}

/** A senior, a caregiver, and an accepted care link between them. */
async function linkedPair(options: LinkOptions = {}) {
  const senior = await createSenior(app, {
    email: options.seniorEmail ?? "owner@example.com",
    name: "Margaret Whitfield",
  });
  const caregiver = await createCaregiver(app, {
    email: options.caregiverEmail ?? "carer@example.com",
    name: "David Whitfield",
  });

  const invite = await request(app)
    .post(`${API}/elders/${senior.elderId}/care-links`)
    .set(bearer(senior.token))
    .send({
      email: options.caregiverEmail ?? "carer@example.com",
      relation: options.relation ?? "FAMILY",
      ...options.permissions,
    });

  expect(invite.status).toBe(201);
  return {
    senior,
    caregiver,
    link: invite.body.data as { id: string; status: string },
  };
}

const MEDICATION = {
  name: "Amlodipine",
  dosage: "5 mg",
  scheduleType: "DAILY" as const,
  times: ["08:00"],
};

const CONTACT = {
  name: "Dr Amelia Okafor",
  phone: "+44 20 7946 0000",
  relation: "DOCTOR" as const,
};

describe("elder-scoped authorization", () => {
  it("denies an unrelated caregiver on every elder-scoped resource", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });
    const stranger = await createCaregiver(app, { email: "stranger@example.com" });
    const id = senior.elderId;

    const attempts = [
      request(app).get(`${API}/elders/${id}`),
      request(app).get(`${API}/elders/${id}/vitals`),
      request(app).get(`${API}/elders/${id}/medications`),
      request(app).get(`${API}/elders/${id}/contacts`),
      request(app).get(`${API}/elders/${id}/sos`),
      request(app)
        .post(`${API}/elders/${id}/vitals`)
        .send({ type: "HEART_RATE", value: 70 }),
    ];

    for (const attempt of attempts) {
      const response = await attempt.set(bearer(stranger.token));
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("forbidden");
    }
  });

  it("prevents one senior from reading another senior's record", async () => {
    const first = await createSenior(app, { email: "first@example.com" });
    const second = await createSenior(app, { email: "second@example.com" });

    const response = await request(app)
      .get(`${API}/elders/${first.elderId}`)
      .set(bearer(second.token));

    expect(response.status).toBe(403);
  });

  it("allows the owner to read their own record and record a vital", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });

    const profile = await request(app)
      .get(`${API}/elders/${senior.elderId}`)
      .set(bearer(senior.token));
    expect(profile.status).toBe(200);
    expect(profile.body.data.permissions).toMatchObject({
      canViewVitals: true,
      canManageMedicines: true,
      canManageContacts: true,
      canAcknowledgeSos: true,
    });

    const vital = await request(app)
      .post(`${API}/elders/${senior.elderId}/vitals`)
      .set(bearer(senior.token))
      .send({ type: "HEART_RATE", value: 72 });
    expect(vital.status).toBe(201);
  });

  it("grants read access once an active care link exists", async () => {
    const { senior, caregiver } = await linkedPair();
    const id = senior.elderId;

    const [profile, vitals, medications, contacts, sos] = await Promise.all([
      request(app).get(`${API}/elders/${id}`).set(bearer(caregiver.token)),
      request(app).get(`${API}/elders/${id}/vitals`).set(bearer(caregiver.token)),
      request(app).get(`${API}/elders/${id}/medications`).set(bearer(caregiver.token)),
      request(app).get(`${API}/elders/${id}/contacts`).set(bearer(caregiver.token)),
      request(app).get(`${API}/elders/${id}/sos`).set(bearer(caregiver.token)),
    ]);

    for (const response of [profile, vitals, medications, contacts, sos]) {
      expect(response.status).toBe(200);
    }
  });

  it("does not grant write capabilities that were not delegated", async () => {
    const { senior, caregiver } = await linkedPair();
    const id = senior.elderId;

    const medication = await request(app)
      .post(`${API}/elders/${id}/medications`)
      .set(bearer(caregiver.token))
      .send(MEDICATION);
    expect(medication.status).toBe(403);

    const contact = await request(app)
      .post(`${API}/elders/${id}/contacts`)
      .set(bearer(caregiver.token))
      .send(CONTACT);
    expect(contact.status).toBe(403);

    // Even with read access, only the senior may edit their clinical profile.
    const profileEdit = await request(app)
      .patch(`${API}/elders/${id}`)
      .set(bearer(caregiver.token))
      .send({ bloodType: "O+" });
    expect(profileEdit.status).toBe(403);
  });

  it("honours the manage-medications capability", async () => {
    const { senior, caregiver } = await linkedPair({
      permissions: { canManageMedicines: true },
    });
    const id = senior.elderId;

    const created = await request(app)
      .post(`${API}/elders/${id}/medications`)
      .set(bearer(caregiver.token))
      .send(MEDICATION);
    expect(created.status).toBe(201);

    const medicationId = created.body.data.id as string;

    const updated = await request(app)
      .patch(`${API}/medications/${medicationId}`)
      .set(bearer(caregiver.token))
      .send({ dosage: "10 mg" });
    expect(updated.status).toBe(200);

    const stopped = await request(app)
      .delete(`${API}/medications/${medicationId}`)
      .set(bearer(caregiver.token));
    expect(stopped.status).toBe(200);
    expect(stopped.body.data.active).toBe(false);
  });

  it("honours the manage-contacts capability", async () => {
    const { senior, caregiver } = await linkedPair({
      permissions: { canManageContacts: true },
    });

    const created = await request(app)
      .post(`${API}/elders/${senior.elderId}/contacts`)
      .set(bearer(caregiver.token))
      .send(CONTACT);
    expect(created.status).toBe(201);

    const removed = await request(app)
      .delete(`${API}/contacts/${created.body.data.id}`)
      .set(bearer(caregiver.token));
    expect(removed.status).toBe(200);
  });

  it("denies a link whose view capabilities are all disabled", async () => {
    const { senior, caregiver } = await linkedPair({
      permissions: {
        canViewVitals: false,
        canManageMedicines: false,
        canManageContacts: false,
        canAcknowledgeSos: true,
      },
    });
    const id = senior.elderId;

    const profile = await request(app).get(`${API}/elders/${id}`).set(bearer(caregiver.token));
    const vitals = await request(app).get(`${API}/elders/${id}/vitals`).set(bearer(caregiver.token));

    expect(profile.status).toBe(403);
    expect(vitals.status).toBe(403);
  });

  it("keeps acknowledge-only access to the SOS lifecycle", async () => {
    const { senior, caregiver } = await linkedPair({
      permissions: {
        canViewVitals: false,
        canManageMedicines: false,
        canManageContacts: false,
        canAcknowledgeSos: true,
      },
    });

    const alert = await request(app)
      .post(`${API}/elders/${senior.elderId}/sos`)
      .set(bearer(senior.token))
      .send({ message: "I have fallen." });
    expect(alert.status).toBe(201);

    const acknowledged = await request(app)
      .post(`${API}/sos/${alert.body.data.id}/acknowledge`)
      .set(bearer(caregiver.token));
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.data.status).toBe("ACKNOWLEDGED");
  });

  it("denies SOS acknowledgement without the capability", async () => {
    const { senior, caregiver } = await linkedPair({
      permissions: { canAcknowledgeSos: false },
    });

    const alert = await request(app)
      .post(`${API}/elders/${senior.elderId}/sos`)
      .set(bearer(senior.token))
      .send({ message: "Help." });
    expect(alert.status).toBe(201);

    const denied = await request(app)
      .post(`${API}/sos/${alert.body.data.id}/acknowledge`)
      .set(bearer(caregiver.token));
    expect(denied.status).toBe(403);
  });

  it("revokes access immediately when the link is revoked", async () => {
    const { senior, caregiver, link } = await linkedPair();

    const revoked = await request(app)
      .patch(`${API}/care-links/${link.id}`)
      .set(bearer(senior.token))
      .send({ status: "REVOKED" });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe("REVOKED");

    const denied = await request(app)
      .get(`${API}/elders/${senior.elderId}/vitals`)
      .set(bearer(caregiver.token));
    expect(denied.status).toBe(403);
  });

  it("applies permission changes on the next request", async () => {
    const { senior, caregiver, link } = await linkedPair();

    const granted = await request(app)
      .patch(`${API}/care-links/${link.id}`)
      .set(bearer(senior.token))
      .send({ canManageMedicines: true });
    expect(granted.status).toBe(200);

    const allowed = await request(app)
      .post(`${API}/elders/${senior.elderId}/medications`)
      .set(bearer(caregiver.token))
      .send(MEDICATION);
    expect(allowed.status).toBe(201);

    const revoked = await request(app)
      .patch(`${API}/care-links/${link.id}`)
      .set(bearer(senior.token))
      .send({ canManageMedicines: false });
    expect(revoked.status).toBe(200);

    const denied = await request(app)
      .post(`${API}/elders/${senior.elderId}/medications`)
      .set(bearer(caregiver.token))
      .send(MEDICATION);
    expect(denied.status).toBe(403);
  });

  it("refuses a permission change from a caregiver without revoking them", async () => {
    const { senior, caregiver, link } = await linkedPair();

    const attempt = await request(app)
      .patch(`${API}/care-links/${link.id}`)
      .set(bearer(caregiver.token))
      .send({ canManageMedicines: true });

    expect(attempt.status).toBe(403);
    expect(attempt.body.code).toBe("forbidden");

    // The unauthorized request must not have side effects: the link is intact.
    const stillActive = await request(app)
      .get(`${API}/elders/${senior.elderId}`)
      .set(bearer(caregiver.token));
    expect(stillActive.status).toBe(200);
  });

  it("lets a caregiver revoke their own access", async () => {
    const { senior, caregiver, link } = await linkedPair();

    const revoked = await request(app)
      .patch(`${API}/care-links/${link.id}`)
      .set(bearer(caregiver.token))
      .send({ status: "REVOKED" });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe("REVOKED");

    const denied = await request(app)
      .get(`${API}/elders/${senior.elderId}`)
      .set(bearer(caregiver.token));
    expect(denied.status).toBe(403);
  });

  it("binds a pending invitation to the invited e-mail address", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });

    const invite = await request(app)
      .post(`${API}/elders/${senior.elderId}/care-links`)
      .set(bearer(senior.token))
      .send({ email: "future@example.com" });
    expect(invite.status).toBe(201);
    expect(invite.body.data.status).toBe("PENDING");
    expect(invite.body.data.caregiverId).toBeNull();

    const invited = await createCaregiver(app, { email: "future@example.com" });
    const intruder = await createCaregiver(app, { email: "intruder@example.com" });

    const hijack = await request(app)
      .patch(`${API}/care-links/${invite.body.data.id}`)
      .set(bearer(intruder.token))
      .send({ status: "ACTIVE" });
    expect(hijack.status).toBe(404);

    const intruderInvitations = await request(app)
      .get(`${API}/care-links/invitations`)
      .set(bearer(intruder.token));
    expect(intruderInvitations.body.data).toHaveLength(0);

    const invitations = await request(app)
      .get(`${API}/care-links/invitations`)
      .set(bearer(invited.token));
    expect(invitations.status).toBe(200);
    expect(invitations.body.data).toHaveLength(1);

    const accepted = await request(app)
      .patch(`${API}/care-links/${invite.body.data.id}`)
      .set(bearer(invited.token))
      .send({ status: "ACTIVE" });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe("ACTIVE");

    const access = await request(app)
      .get(`${API}/elders/${senior.elderId}`)
      .set(bearer(invited.token));
    expect(access.status).toBe(200);
  });

  it("lists only the elders the caller can access", async () => {
    const { caregiver } = await linkedPair();
    const stranger = await createCaregiver(app, { email: "stranger@example.com" });

    const visible = await request(app).get(`${API}/elders`).set(bearer(caregiver.token));
    expect(visible.status).toBe(200);
    expect(visible.body.data).toHaveLength(1);

    const hidden = await request(app).get(`${API}/elders`).set(bearer(stranger.token));
    expect(hidden.body.data).toHaveLength(0);

    const links = await request(app).get(`${API}/care-links`).set(bearer(caregiver.token));
    expect(links.body.data).toHaveLength(1);
    expect(links.body.data[0].permissions).toMatchObject({
      canViewVitals: true,
      canManageMedicines: false,
      canManageContacts: false,
      canAcknowledgeSos: true,
    });
  });

  it("requires family contact-access to invite another caregiver", async () => {
    const doctor = await linkedPair({
      relation: "DOCTOR",
      permissions: { canManageContacts: true },
    });

    const denied = await request(app)
      .post(`${API}/elders/${doctor.senior.elderId}/care-links`)
      .set(bearer(doctor.caregiver.token))
      .send({ email: "nurse@example.com" });
    expect(denied.status).toBe(403);
  });

  it("lets a family caregiver with contact-access invite another caregiver", async () => {
    const family = await linkedPair({
      relation: "FAMILY",
      permissions: { canManageContacts: true },
    });

    const allowed = await request(app)
      .post(`${API}/elders/${family.senior.elderId}/care-links`)
      .set(bearer(family.caregiver.token))
      .send({ email: "nurse@example.com" });
    expect(allowed.status).toBe(201);
  });

  it("lets an administrator read any record without granting profile edits", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });
    await prisma.user.create({
      data: {
        email: "admin@example.com",
        passwordHash: await hashPassword("AdminPass2025"),
        name: "Platform Admin",
        role: "ADMIN",
      },
    });

    const admin = await loginUser(app, "admin@example.com", "AdminPass2025");
    expect(admin.response.status).toBe(200);
    const token = accessTokenFrom(admin.response);

    const read = await request(app)
      .get(`${API}/elders/${senior.elderId}`)
      .set(bearer(token));
    expect(read.status).toBe(200);

    const edit = await request(app)
      .patch(`${API}/elders/${senior.elderId}`)
      .set(bearer(token))
      .send({ bloodType: "A+" });
    expect(edit.status).toBe(403);
  });
});
