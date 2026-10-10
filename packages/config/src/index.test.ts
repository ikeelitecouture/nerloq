import { describe, expect, it } from "vitest";

Object.assign(process.env, {
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1:27017/nerloq-test",
  REDIS_URL: "redis://127.0.0.1:6379",
  JWT_ACCESS_SECRET: "test-access-secret-with-more-than-32-characters",
  JWT_REFRESH_SECRET: "test-refresh-secret-with-more-than-32-characters",
  COOKIE_SECURE: "false",
  COOKIE_SAME_SITE: "lax",
});
const { validateEnvironment } = await import("./index.js");
const base = {
  MONGODB_URI: "mongodb://127.0.0.1:27017/nerloq-test",
  REDIS_URL: "redis://127.0.0.1:6379",
  JWT_ACCESS_SECRET: "test-access-secret-with-more-than-32-characters",
  JWT_REFRESH_SECRET: "test-refresh-secret-with-more-than-32-characters",
  COOKIE_SECURE: "false",
  COOKIE_SAME_SITE: "lax",
};

describe("environment provider safety", () => {
  it("allows local development without requiring Redis", () => {
    const result = validateEnvironment({ ...base, NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(result.REDIS_REQUIRED).toBe(false);
    expect(result.MEDIA_STORAGE_PROVIDER).toBe("local");
  });

  it("requires a real email, Redis, and cloud storage configuration in production", () => {
    const cloud = { ...base, NODE_ENV: "production", COOKIE_SECURE: "true", REDIS_REQUIRED: "true", MEDIA_STORAGE_PROVIDER: "s3", MEDIA_STORAGE_ACCESS_KEY: "access", MEDIA_STORAGE_SECRET_KEY: "secret", EMAIL_PROVIDER: "resend", EMAIL_FROM: "support@example.com", EMAIL_API_KEY: "test-provider-key" };
    const result = validateEnvironment(cloud as NodeJS.ProcessEnv);
    expect(result.REDIS_REQUIRED).toBe(true);
    const consoleOnly = { ...base, NODE_ENV: "production", COOKIE_SECURE: "true", REDIS_REQUIRED: "true", MEDIA_STORAGE_PROVIDER: "s3", MEDIA_STORAGE_ACCESS_KEY: "access", MEDIA_STORAGE_SECRET_KEY: "secret" };
    expect(() => validateEnvironment(consoleOnly as NodeJS.ProcessEnv)).toThrow(/email delivery provider/);
    expect(() => validateEnvironment({ ...cloud, REDIS_REQUIRED: "false" } as NodeJS.ProcessEnv)).toThrow(/REDIS_REQUIRED/);
    expect(() => validateEnvironment({ ...cloud, MEDIA_STORAGE_PROVIDER: "local" } as NodeJS.ProcessEnv)).toThrow(/cloud media storage/);
  });
});
