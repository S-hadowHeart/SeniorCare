import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  API,
  bearer,
  buildApp,
  closeDatabase,
  createCaregiver,
  createSenior,
  resetDatabase,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { runCheckInWatchdogJob } from "../src/jobs/checkInWatchdog.job.js";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

/** Invite an already registered caregiver; the link is activated immediately. */
async function linkCaregiver(
  senior: Awaited<ReturnType<typeof createSenior>>,
  caregiver: Awaited<ReturnType<typeof createCaregiver>>,
  email: string,
): Promise<void> {
  const invite = await request(app)
    .post(`${API}/elders/${senior.elderId}/care-links`)
    .set(bearer(senior.token))
    .send({ email, relation: "FAMILY" });

  expect(invite.status).toBe(201);
  expect(invite.body.data.caregiverId).toBe(caregiver.userId);
}

function checkInUrl(elderId: string): string {
  return `${API}/elders/${elderId}/checkins`;
}

function postCheckIn(token: string, elderId: string, body: Record<string, unknown>) {
  return request(app).post(checkInUrl(elderId)).set(bearer(token)).send(body);
}

describe("daily check-ins", () => {
  it("records a SAFE check-in and reports it as today's status", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });

    const response = await postCheckIn(senior.token, senior.elderId, {
      status: "SAFE",
      mood: 4,
      note: "All good today",
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      elderId: senior.elderId,
      status: "SAFE",
      mood: 4,
      note: "All good today",
      autoEscalated: false,
    });

    const today = await request(app)
      .get(`${checkInUrl(senior.elderId)}/today`)
      .set(bearer(senior.token));

    expect(today.status).toBe(200);
    expect(today.body.data.checkedInToday).toBe(true);
    expect(today.body.data.checkIn.status).toBe("SAFE");
  });

  it("encrypts the free-text note at rest", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });

    const response = await postCheckIn(senior.token, senior.elderId, {
      status: "SAFE",
      note: "Feeling a little dizzy",
    });
    expect(response.status).toBe(201);
    expect(response.body.data.note).toBe("Feeling a little dizzy");

    const stored = await prisma.checkIn.findFirstOrThrow({
      where: { elderId: senior.elderId },
      select: { note: true },
    });

    expect(stored.note).toMatch(/^v1:/);
    expect(stored.note).not.toContain("dizzy");
  });

  it("rejects a client-supplied MISSED status", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });

    const response = await postCheckIn(senior.token, senior.elderId, {
      status: "MISSED",
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("validation_error");
  });

  it("rejects an out-of-range mood", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });

    const response = await postCheckIn(senior.token, senior.elderId, {
      status: "SAFE",
      mood: 6,
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("validation_error");
  });

  it("rejects a check-in recorded in the future", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });

    const response = await postCheckIn(senior.token, senior.elderId, {
      status: "SAFE",
      recordedAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("validation_error");
  });

  it("returns the history newest first and honours the limit", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });
    const now = Date.now();
    const timestamps = [
      new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      new Date(now).toISOString(),
    ];

    for (const recordedAt of timestamps) {
      const response = await postCheckIn(senior.token, senior.elderId, {
        status: "SAFE",
        recordedAt,
      });
      expect(response.status).toBe(201);
    }

    const history = await request(app)
      .get(`${checkInUrl(senior.elderId)}?days=365&limit=2`)
      .set(bearer(senior.token));

    expect(history.status).toBe(200);
    expect(history.body.meta.days).toBe(365);
    expect(history.body.data.map((item: { createdAt: string }) => item.createdAt)).toEqual([
      timestamps[2],
      timestamps[1],
    ]);
  });
});

describe("check-in escalation", () => {
  it("notifies every active caregiver when the senior asks for help", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });
    const caregiver = await createCaregiver(app, { email: "carer@example.com" });
    await linkCaregiver(senior, caregiver, "carer@example.com");

    const response = await postCheckIn(senior.token, senior.elderId, {
      status: "NEEDS_HELP",
      note: "I need some help",
    });
    expect(response.status).toBe(201);

    const notifications = await prisma.notification.findMany({
      where: { userId: caregiver.userId, type: "CHECK_IN_NEEDS_HELP" },
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.elderId).toBe(senior.elderId);
    expect(notifications[0]?.body).toContain("I need some help");
  });

  it("lets a linked caregiver read the history but not record a check-in", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });
    const caregiver = await createCaregiver(app, { email: "carer@example.com" });
    const stranger = await createCaregiver(app, { email: "stranger@example.com" });
    await linkCaregiver(senior, caregiver, "carer@example.com");

    await postCheckIn(senior.token, senior.elderId, { status: "SAFE" });

    const read = await request(app)
      .get(checkInUrl(senior.elderId))
      .set(bearer(caregiver.token));
    expect(read.status).toBe(200);
    expect(read.body.data).toHaveLength(1);

    // Only the senior may confirm their own safety.
    const write = await postCheckIn(caregiver.token, senior.elderId, {
      status: "SAFE",
    });
    expect(write.status).toBe(403);

    const denied = await request(app)
      .get(checkInUrl(senior.elderId))
      .set(bearer(stranger.token));
    expect(denied.status).toBe(403);
  });
});

describe("missed check-in watchdog", () => {
  it("records a MISSED check-in exactly once and alerts the caregivers", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });
    const caregiver = await createCaregiver(app, { email: "carer@example.com" });
    await linkCaregiver(senior, caregiver, "carer@example.com");

    // Deadline 00:00 guarantees that the watchdog considers the day due.
    await prisma.elder.update({
      where: { id: senior.elderId },
      data: { checkInDeadlineHour: 0 },
    });

    await runCheckInWatchdogJob();
    await runCheckInWatchdogJob();

    const missed = await prisma.checkIn.findMany({
      where: { elderId: senior.elderId, status: "MISSED" },
    });

    expect(missed).toHaveLength(1);
    expect(missed[0]?.autoEscalated).toBe(true);
    expect(missed[0]?.note).toContain("No safety check-in");

    const notifications = await prisma.notification.findMany({
      where: { userId: caregiver.userId, type: "CHECK_IN_MISSED" },
    });
    expect(notifications).toHaveLength(1);

    const today = await request(app)
      .get(`${checkInUrl(senior.elderId)}/today`)
      .set(bearer(senior.token));

    expect(today.body.data.checkedInToday).toBe(false);
    expect(today.body.data.checkIn.status).toBe("MISSED");
  });

  it("does not escalate once the senior has checked in", async () => {
    const senior = await createSenior(app, { email: "owner@example.com" });
    const caregiver = await createCaregiver(app, { email: "carer@example.com" });
    await linkCaregiver(senior, caregiver, "carer@example.com");

    await prisma.elder.update({
      where: { id: senior.elderId },
      data: { checkInDeadlineHour: 0 },
    });

    await postCheckIn(senior.token, senior.elderId, { status: "SAFE" });
    await runCheckInWatchdogJob();

    const missed = await prisma.checkIn.count({
      where: { elderId: senior.elderId, status: "MISSED" },
    });
    expect(missed).toBe(0);

    const today = await request(app)
      .get(`${checkInUrl(senior.elderId)}/today`)
      .set(bearer(senior.token));

    expect(today.body.data.checkedInToday).toBe(true);
    expect(today.body.data.checkIn.status).toBe("SAFE");
  });
});
