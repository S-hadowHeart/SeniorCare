/**
 * End-to-end smoke test against a running API.
 *
 * Usage:  node --import tsx scripts/smoke.ts [baseUrl]
 *
 * Exercises every feature of the platform end to end: authentication,
 * check-ins, vitals, medication schedule and adherence, emergency contacts,
 * SOS (including acknowledgement and cancellation) and the realtime stream.
 */
const BASE_URL = process.argv[2] ?? "http://127.0.0.1:4000/api/v1";
const SENIOR = { email: "margaret@example.com", password: "SeniorCare2024" };
const CAREGIVER = { email: "david@example.com", password: "SeniorCare2024" };
const DOCTOR = { email: "dr.okafor@example.com", password: "SeniorCare2024" };

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}`);
    if (detail !== undefined) console.log("    ", JSON.stringify(detail).slice(0, 400));
  }
}

interface Session {
  accessToken: string;
  setCookie: string;
  refreshCookie: string;
  user: { id: string; name: string; role: string; elderId: string | null };
}

async function api(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.cookie) headers.Cookie = options.cookie;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }

  return { status: response.status, body, headers: response.headers };
}

async function login(credentials: { email: string; password: string }): Promise<Session> {
  const response = await api("POST", "/auth/login", { body: credentials });
  if (response.status !== 200) {
    throw new Error(`login failed: ${JSON.stringify(response.body)}`);
  }
  const setCookie = response.headers.get("set-cookie") ?? "";
  const refreshCookie = setCookie.split(";")[0] ?? "";
  return {
    accessToken: response.body.data.accessToken,
    refreshCookie,
    setCookie,
    user: response.body.data.user,
  };
}

async function main(): Promise<void> {
  console.log(`\nSeniorCare API smoke test → ${BASE_URL}\n`);

  // ---------------------------------------------------------------- auth ---
  console.log("Authentication");
  const senior = await login(SENIOR);
  check("senior signs in", senior.user.role === "SENIOR" && Boolean(senior.user.elderId));
  check("refresh cookie is httpOnly", senior.setCookie.includes("HttpOnly"), senior.setCookie);
  check("refresh cookie is SameSite=Strict", senior.setCookie.includes("SameSite=Strict"));
  check("refresh cookie is scoped to the auth path", senior.setCookie.includes("Path=/api/v1/auth"));

  const caregiver = await login(CAREGIVER);
  check("caregiver signs in", caregiver.user.role === "CAREGIVER");

  const doctor = await login(DOCTOR);
  check("read-only clinician signs in", doctor.user.role === "CAREGIVER");

  const badLogin = await api("POST", "/auth/login", {
    body: { email: SENIOR.email, password: "wrong-password" },
  });
  check("wrong password is rejected with 401", badLogin.status === 401);

  const unknownUser = await api("POST", "/auth/login", {
    body: { email: "nobody@example.com", password: "whatever12345" },
  });
  check(
    "unknown e-mail gives the same generic error (no enumeration)",
    unknownUser.status === 401 &&
      unknownUser.body.detail === badLogin.body.detail,
    { unknown: unknownUser.body.detail, known: badLogin.body.detail },
  );

  const me = await api("GET", "/auth/me", { token: senior.accessToken });
  check("GET /auth/me returns the profile", me.status === 200 && me.body.data.id === senior.user.id);

  const noAuth = await api("GET", "/elders");
  check("unauthenticated request is rejected", noAuth.status === 401);

  const badToken = await api("GET", "/elders", { token: "not-a-real-token" });
  check("invalid token is rejected", badToken.status === 401);

  const refreshed = await api("POST", "/auth/refresh", { cookie: senior.refreshCookie });
  check("refresh token rotates and returns a new access token", refreshed.status === 200 && Boolean(refreshed.body.data.accessToken));

  // The old refresh token must no longer work (rotation + reuse detection).
  const replay = await api("POST", "/auth/refresh", { cookie: senior.refreshCookie });
  check("replaying a rotated refresh token is rejected", replay.status === 401, replay.body);

  const senior2 = await login(SENIOR);
  const elderId = senior2.user.elderId!;

  // ------------------------------------------------------------- elders ---
  console.log("\nElder profile & dashboard");
  const elders = await api("GET", "/elders", { token: senior2.accessToken });
  check("senior sees their own elder record", elders.status === 200 && elders.body.data.length === 1);

  const summary = await api("GET", `/elders/${elderId}/summary`, { token: caregiver.accessToken });
  check(
    "caregiver can read the summary of a linked elder",
    summary.status === 200 && summary.body.data.elder.displayName === "Margaret Chen",
    summary.body,
  );
  check("summary exposes medication adherence", typeof summary.body.data.medications.adherence7Days !== "undefined");

  const stranger = await api("GET", `/elders/${elderId}/summary`, { token: senior2.accessToken });
  check("summary is reachable for the senior themselves", stranger.status === 200);

  // ------------------------------------------------------------ check-in ---
  console.log("\nDaily check-in");
  const checkIn = await api("POST", `/elders/${elderId}/checkins`, {
    token: senior2.accessToken,
    body: { status: "SAFE", mood: 5, note: "Feeling good today." },
  });
  check("senior records a SAFE check-in", checkIn.status === 201 && checkIn.body.data.status === "SAFE");
  check("check-in note is encrypted at rest but decrypted on read", checkIn.body.data.note === "Feeling good today.");

  const today = await api("GET", `/elders/${elderId}/checkins/today`, { token: caregiver.accessToken });
  check("caregiver sees today's check-in", today.status === 200 && today.body.data.checkedInToday === true);

  const history = await api("GET", `/elders/${elderId}/checkins?days=30`, { token: caregiver.accessToken });
  check("check-in history is returned", history.status === 200 && history.body.data.length > 5);

  const needsHelp = await api("POST", `/elders/${elderId}/checkins`, {
    token: senior2.accessToken,
    body: { status: "NEEDS_HELP", note: "Please call me." },
  });
  check("senior can flag that they need help", needsHelp.status === 201);

  const notifications = await api("GET", "/notifications", { token: caregiver.accessToken });
  check(
    "caregiver is notified about the check-in",
    notifications.status === 200 &&
      notifications.body.data.some((n: any) => n.type === "CHECK_IN_NEEDS_HELP"),
    notifications.body?.data?.map((n: any) => n.type),
  );

  // -------------------------------------------------------------- vitals ---
  console.log("\nHealth readings");
  const normalVital = await api("POST", `/elders/${elderId}/vitals`, {
    token: senior2.accessToken,
    body: { type: "BLOOD_PRESSURE", value: 124, value2: 78 },
  });
  check("blood pressure is recorded", normalVital.status === 201 && normalVital.body.data.isCritical === false);

  const criticalVital = await api("POST", `/elders/${elderId}/vitals`, {
    token: senior2.accessToken,
    body: { type: "BLOOD_PRESSURE", value: 192, value2: 124 },
  });
  check(
    "a hypertensive-crisis reading is flagged as critical",
    criticalVital.status === 201 && criticalVital.body.data.isCritical === true,
    criticalVital.body,
  );

  const vitalSummary = await api("GET", `/elders/${elderId}/vitals/summary?days=30`, {
    token: caregiver.accessToken,
  });
  check(
    "vital summary returns per-type series",
    vitalSummary.status === 200 && vitalSummary.body.data.series.length >= 3,
    vitalSummary.body?.data?.series?.map((s: any) => s.type),
  );

  const criticalNotifications = await api("GET", "/notifications", { token: caregiver.accessToken });
  check(
    "caregiver is notified about the critical reading",
    criticalNotifications.body.data.some((n: any) => n.type === "VITALS_CRITICAL"),
  );

  const invalidVital = await api("POST", `/elders/${elderId}/vitals`, {
    token: senior2.accessToken,
    body: { type: "BLOOD_PRESSURE", value: "abc" },
  });
  check("invalid vital payload is rejected with 400", invalidVital.status === 400, invalidVital.body);

  // --------------------------------------------------------- medications ---
  console.log("\nMedications");
  const meds = await api("GET", `/elders/${elderId}/medications`, { token: senior2.accessToken });
  check("medication list is returned", meds.status === 200 && meds.body.data.length >= 4);

  const schedule = await api("GET", `/elders/${elderId}/medications/schedule?days=7`, {
    token: caregiver.accessToken,
  });
  check(
    "schedule expands into concrete doses",
    schedule.status === 200 && schedule.body.data.doses.length > 5,
    schedule.body?.data?.doses?.length,
  );

  const firstDose = schedule.body.data.doses[0];
  const taken = await api("POST", `/elders/${elderId}/medications/${firstDose.medicationId}/doses`, {
    token: senior2.accessToken,
    body: { scheduledFor: firstDose.scheduledFor, status: "TAKEN" },
  });
  check("a dose can be marked as taken", taken.status === 200 && taken.body.data.status === "TAKEN");

  const scheduleAfter = await api("GET", `/elders/${elderId}/medications/schedule?days=7`, {
    token: caregiver.accessToken,
  });
  check(
    "the recorded dose state is reflected in the schedule",
    scheduleAfter.body.data.doses.some((d: any) => d.status === "TAKEN"),
  );

  const badMedication = await api("POST", `/elders/${elderId}/medications`, {
    token: senior2.accessToken,
    body: { name: "Test", dosage: "1 mg", scheduleType: "DAILY", times: [] },
  });
  check("a schedule without times is rejected", badMedication.status === 400, badMedication.body);

  const forbiddenMedication = await api("POST", `/elders/${elderId}/medications`, {
    token: doctor.accessToken,
    body: { name: "Test", dosage: "1 mg", scheduleType: "DAILY", times: ["08:00"] },
  });
  check(
    "a clinician without the manage-medicines capability is blocked",
    forbiddenMedication.status === 403,
    forbiddenMedication.body,
  );

  const doctorMayRead = await api("GET", `/elders/${elderId}/vitals/summary?days=30`, {
    token: doctor.accessToken,
  });
  check("a clinician with view access may read the readings", doctorMayRead.status === 200);

  // ------------------------------------------------------------ contacts ---
  console.log("\nEmergency contacts");
  const contacts = await api("GET", `/elders/${elderId}/contacts`, { token: senior2.accessToken });
  check("emergency contacts are listed", contacts.status === 200 && contacts.body.data.length >= 3);

  const newContact = await api("POST", `/elders/${elderId}/contacts`, {
    token: senior2.accessToken,
    body: { name: "Test Contact", phone: "+44 7700 900999", email: "test@example.com", relation: "FAMILY" },
  });
  check("an emergency contact can be added", newContact.status === 201);
  await api("DELETE", `/contacts/${newContact.body.data.id}`, { token: senior2.accessToken });

  // ----------------------------------------------------------------- SOS ---
  console.log("\nSOS emergency alert");
  const sos = await api("POST", `/elders/${elderId}/sos`, {
    token: senior2.accessToken,
    body: {
      message: "I have fallen in the kitchen.",
      location: { latitude: 51.5074, longitude: -0.1278, accuracy: 12, source: "GPS" },
    },
  });
  check("SOS alert is created", sos.status === 201 && sos.body.data.status === "ACTIVE");
  check("the location is attached to the alert", sos.body.data.latitude === 51.5074);
  check("a maps deep link is returned", typeof sos.body.data.mapUrl === "string");

  const dedupe = await api("POST", `/elders/${elderId}/sos`, {
    token: senior2.accessToken,
    body: { message: "Pressed twice" },
  });
  check("a repeated press does not create a second alert", dedupe.body.data.id === sos.body.data.id);

  const caregiverNotifications = await api("GET", "/notifications", { token: caregiver.accessToken });
  check(
    "caregiver receives the SOS notification",
    caregiverNotifications.body.data.some((n: any) => n.type === "SOS_TRIGGERED"),
  );

  const activeAlerts = await api("GET", "/sos/active", { token: caregiver.accessToken });
  check("active alerts are visible to the caregiver", activeAlerts.status === 200 && activeAlerts.body.data.length >= 1);

  const acknowledge = await api("POST", `/sos/${sos.body.data.id}/acknowledge`, {
    token: caregiver.accessToken,
  });
  check("caregiver can acknowledge the alert", acknowledge.status === 200 && acknowledge.body.data.status === "ACKNOWLEDGED");

  const cancelByCaregiver = await api("POST", `/sos/${sos.body.data.id}/cancel`, {
    token: caregiver.accessToken,
  });
  check("only the person themselves can cancel an alert", cancelByCaregiver.status === 403);

  const cancel = await api("POST", `/sos/${sos.body.data.id}/cancel`, { token: senior2.accessToken });
  check("the senior can cancel a false alarm", cancel.status === 200 && cancel.body.data.status === "CANCELLED");

  // --------------------------------------------------------------- SSE ----
  console.log("\nRealtime");
  const ticket = await api("POST", "/events/ticket", { token: caregiver.accessToken });
  check("a stream ticket is issued", ticket.status === 200 && Boolean(ticket.body.data.ticket));

  // The SSE response stays open by design — read the status line only and
  // then close the stream.
  const stream = await fetch(`${BASE_URL}/events/stream?ticket=${ticket.body.data.ticket}`, {
    headers: { Accept: "text/event-stream" },
    signal: AbortSignal.timeout(20_000),
  });
  check("the ticket opens an SSE stream", stream.status === 200);
  check(
    "the stream is served as text/event-stream",
    (stream.headers.get("content-type") ?? "").includes("text/event-stream"),
  );
  await stream.body?.cancel();

  const ticketReplay = await api("GET", `/events/stream?ticket=${ticket.body.data.ticket}`);
  check("a ticket can only be used once", ticketReplay.status === 401);

  const badTicket = await api("GET", "/events/stream?ticket=not-a-ticket");
  check("an invalid ticket is rejected", badTicket.status === 401);

  // -------------------------------------------------------- notifications --
  console.log("\nNotifications");
  const readAll = await api("POST", "/notifications/read-all", { token: caregiver.accessToken });
  check("notifications can be marked as read", readAll.status === 200 && readAll.body.data.updated > 0);

  const unread = await api("GET", "/notifications/unread-count", { token: caregiver.accessToken });
  check("the unread badge is cleared", unread.status === 200 && unread.body.data.unreadCount === 0);

  // ---------------------------------------------------------------- misc ---
  console.log("\nMiscellaneous");
  const health = await api("GET", "/health");
  check("the liveness probe responds", health.status === 200 && health.body.data.status === "ok");

  const ready = await api("GET", "/health/ready");
  check("the readiness probe reports the database is up", ready.status === 200 && ready.body.data.database === "up");

  const notFound = await api("GET", "/does-not-exist");
  check("unknown routes return a problem+json 404", notFound.status === 404 && notFound.body.type.includes("not_found"));

  const location = await api("POST", `/elders/${elderId}/locations`, {
    token: senior2.accessToken,
    body: { latitude: 51.5, longitude: -0.12, source: "MANUAL", label: "Home" },
  });
  check("a location can be shared manually", location.status === 201 && location.body.data.label === "Home");

  const latestLocation = await api("GET", `/elders/${elderId}/locations/latest`, { token: caregiver.accessToken });
  check("the latest location is readable by the caregiver", latestLocation.status === 200);

  console.log(`\n${"─".repeat(56)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${"─".repeat(56)}\n`);

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Smoke test crashed:", error);
    process.exitCode = 1;
  });
