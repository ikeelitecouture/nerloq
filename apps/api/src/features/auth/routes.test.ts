import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: "mongodb://127.0.0.1:27017/nerloq-test",
    REDIS_URL: "redis://127.0.0.1:6379",
    JWT_ACCESS_SECRET: "test-access-secret-with-more-than-32-characters",
    JWT_REFRESH_SECRET: "test-refresh-secret-with-more-than-32-characters",
    COOKIE_SECURE: "false",
    COOKIE_SAME_SITE: "lax",
  });
  const { buildApp } = await import("../../app.js");
  app = buildApp({ logger: false });
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app.close();
});

describe("auth HTTP boundary", () => {
  it("serves the existing health contract", async () => {
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe("alive");
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("rejects malformed registration before persistence", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "not-an-email", username: "ab", displayName: "", password: "weak" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_ERROR");
  });

  it("rejects malformed password recovery and reset payloads before persistence", async () => {
    const forgot = await app.inject({ method: "POST", url: "/api/v1/auth/password/forgot", payload: { email: "invalid" } });
    const reset = await app.inject({ method: "POST", url: "/api/v1/auth/password/reset", payload: { token: "short", password: "weak" } });
    expect(forgot.statusCode).toBe(400);
    expect(forgot.json().code).toBe("VALIDATION_ERROR");
    expect(reset.statusCode).toBe(400);
    expect(reset.json().code).toBe("VALIDATION_ERROR");
  });

  it("rejects malformed login before persistence", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { identifier: "", password: "" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_ERROR");
  });
});
