import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  API,
  DEMO_PASSWORD,
  accessTokenFrom,
  buildApp,
  closeDatabase,
  loginUser,
  refreshCookieFrom,
  registerUser,
  resetDatabase,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe("POST /auth/register", () => {
  it("creates a senior account, an elder profile and a session", async () => {
    const { response } = await registerUser(app);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toMatchObject({
      email: "margaret@example.com",
      role: "SENIOR",
    });
    expect(response.body.data.user.elderId).toEqual(expect.any(String));
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.expiresIn).toBe(900);
  });

  it("stores the refresh token in a hardened httpOnly cookie", async () => {
    const { response } = await registerUser(app);
    const header = response.headers["set-cookie"] as unknown as string[];
    const setCookie = header.find((value) => value.startsWith("sc_refresh="));

    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\/api\/v1\/auth/i);

    // The raw token must never be exposed in the JSON body.
    expect(JSON.stringify(response.body)).not.toContain(refreshCookieFrom(response));
  });

  it("does not create an elder profile for a caregiver", async () => {
    const { response } = await registerUser(app, {
      email: "david@example.com",
      name: "David Whitfield",
      role: "CAREGIVER",
    });

    expect(response.status).toBe(201);
    expect(response.body.data.user.role).toBe("CAREGIVER");
    expect(response.body.data.user.elderId).toBeNull();
  });

  it("rejects a duplicate e-mail address with 409", async () => {
    await registerUser(app);
    const { response } = await registerUser(app);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("conflict");
  });

  it("rejects a password that does not meet the policy", async () => {
    const { response } = await registerUser(app, { password: "short1" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("validation_error");
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "password" })]),
    );
  });

  it("treats e-mail addresses case-insensitively", async () => {
    await registerUser(app, { email: "Margaret@Example.COM" });
    const { response } = await loginUser(app, "margaret@example.com");

    expect(response.status).toBe(200);
  });
});

describe("POST /auth/login", () => {
  it("issues a session and writes an audit entry for valid credentials", async () => {
    await registerUser(app, { email: "audit@example.com" });

    const { response } = await loginUser(app, "audit@example.com");

    expect(response.status).toBe(200);
    expect(accessTokenFrom(response)).toEqual(expect.any(String));

    const entries = await prisma.auditLog.findMany({ where: { action: "auth.login" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.ipAddress).toBeTruthy();
  });

  it("returns an identical error for an unknown account and a wrong password", async () => {
    await registerUser(app, { email: "known@example.com" });

    const wrongPassword = await loginUser(app, "known@example.com", "WrongPassword123");
    const unknownAccount = await loginUser(app, "nobody@example.com", DEMO_PASSWORD);

    expect(wrongPassword.response.status).toBe(401);
    expect(unknownAccount.response.status).toBe(401);
    expect(wrongPassword.response.body.code).toBe("invalid_credentials");
    expect(unknownAccount.response.body.code).toBe("invalid_credentials");
    expect(wrongPassword.response.body.detail).toBe(unknownAccount.response.body.detail);
  });

  it("locks the account after the configured number of failed attempts", async () => {
    await registerUser(app, { email: "locked@example.com" });

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const { response } = await loginUser(app, "locked@example.com", "WrongPassword123");
      expect(response.status).toBe(401);
    }

    const third = await loginUser(app, "locked@example.com", "WrongPassword123");
    expect(third.response.status).toBe(423);
    expect(third.response.body.code).toBe("account_locked");

    // Even the correct password is refused while the lock is in effect.
    const correct = await loginUser(app, "locked@example.com");
    expect(correct.response.status).toBe(423);
  });

  it("includes a correlation id on error responses", async () => {
    const { response } = await loginUser(app, "ghost@example.com");

    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.headers["x-request-id"]).toBe(response.body.requestId);
  });
});

describe("POST /auth/refresh", () => {
  it("rotates the refresh token and returns a new access token", async () => {
    const { agent, response } = await registerUser(app);
    const original = refreshCookieFrom(response);

    const refreshed = await agent.post(`${API}/auth/refresh`).send({});

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toEqual(expect.any(String));
    const rotated = refreshCookieFrom(refreshed);
    expect(rotated).not.toBe(original);
  });

  it("revokes the token family when a rotated token is replayed", async () => {
    const { agent, response } = await registerUser(app);
    const original = refreshCookieFrom(response);

    const refreshed = await agent.post(`${API}/auth/refresh`).send({});
    const rotated = refreshCookieFrom(refreshed);

    const replay = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", original)
      .send({});

    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe("refresh_token_reuse");

    // The legitimate, newly-issued token is revoked as part of the family.
    const afterReplay = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", rotated)
      .send({});

    expect(afterReplay.status).toBe(401);
  });

  it("rejects a request that carries no refresh cookie", async () => {
    const response = await request(app).post(`${API}/auth/refresh`).send({});

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("no_refresh_token");
  });
});

describe("GET /auth/me", () => {
  it("returns the profile for a valid access token", async () => {
    const { response } = await registerUser(app);

    const me = await request(app)
      .get(`${API}/auth/me`)
      .set("Authorization", `Bearer ${accessTokenFrom(response)}`);

    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe("margaret@example.com");
  });

  it("rejects a missing Authorization header", async () => {
    const response = await request(app).get(`${API}/auth/me`);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("missing_token");
  });

  it("rejects a non-Bearer Authorization header", async () => {
    const response = await request(app)
      .get(`${API}/auth/me`)
      .set("Authorization", "Token abc.def.ghi");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("invalid_authorization_header");
  });

  it("rejects a forged access token", async () => {
    const response = await request(app)
      .get(`${API}/auth/me`)
      .set("Authorization", "Bearer not.a.real.token");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("invalid_token");
  });
});

describe("POST /auth/logout", () => {
  it("revokes the current refresh token", async () => {
    const { agent, response } = await registerUser(app);
    const cookie = refreshCookieFrom(response);

    const logout = await agent.post(`${API}/auth/logout`).send({});
    expect(logout.status).toBe(200);

    const reuse = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", cookie)
      .send({});

    expect(reuse.status).toBe(401);
  });
});

describe("POST /auth/change-password", () => {
  it("updates the password, revokes sessions and rejects the old credentials", async () => {
    const { response } = await registerUser(app);
    const token = accessTokenFrom(response);
    const oldRefresh = refreshCookieFrom(response);

    const changed = await request(app)
      .post(`${API}/auth/change-password`)
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: DEMO_PASSWORD, newPassword: "BrandNew2025" });

    expect(changed.status).toBe(200);

    const revokedSession = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", oldRefresh)
      .send({});
    expect(revokedSession.status).toBe(401);

    const oldPassword = await loginUser(app, "margaret@example.com", DEMO_PASSWORD);
    expect(oldPassword.response.status).toBe(401);

    const newPassword = await loginUser(app, "margaret@example.com", "BrandNew2025");
    expect(newPassword.response.status).toBe(200);
  });

  it("rejects an incorrect current password", async () => {
    const { response } = await registerUser(app);

    const changed = await request(app)
      .post(`${API}/auth/change-password`)
      .set("Authorization", `Bearer ${accessTokenFrom(response)}`)
      .send({ currentPassword: "WrongPassword123", newPassword: "BrandNew2025" });

    expect(changed.status).toBe(400);
    expect(changed.body.code).toBe("validation_error");
  });
});
