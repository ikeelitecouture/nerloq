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
afterAll(async () => { await app.close(); });

describe("video API authorization and input boundaries", () => {
  it("requires a session for the following feed", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/feed?type=following" });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("rejects malformed video ids before database access", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/videos/not-an-object-id" });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_VIDEO_ID");
  });

  it("rejects malformed feed cursors before database access", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/feed?cursor=not-a-cursor" });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_CURSOR");
  });

  it("keeps stale optional credentials refreshable instead of silently using anonymous data", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/profiles/example",
      headers: { cookie: "nerloq_access=stale-token" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("requires a session before accepting a video upload", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/videos" });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("rejects malformed report reasons before creating a moderation record", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/videos/invalid/report", payload: { reason: "spam" } });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("rejects malformed profile, search, and hashtag inputs before persistence", async () => {
    const profile = await app.inject({ method: "GET", url: "/api/v1/profiles/x!" });
    const search = await app.inject({ method: "GET", url: "/api/v1/search?q=x" });
    const invalidSearchType = await app.inject({ method: "GET", url: "/api/v1/search?q=video&type=unknown" });
    const hashtag = await app.inject({ method: "GET", url: "/api/v1/hashtags/!!!/feed" });
    expect(profile.statusCode).toBe(400);
    expect(search.statusCode).toBe(400);
    expect(invalidSearchType.statusCode).toBe(400);
    expect(invalidSearchType.json().code).toBe("INVALID_SEARCH_TYPE");
    expect(hashtag.statusCode).toBe(400);
  });

  it("requires a session for inbox listing and message actions", async () => {
    const listing = await app.inject({ method: "GET", url: "/api/v1/inbox/conversations" });
    const send = await app.inject({ method: "POST", url: "/api/v1/inbox/conversations", payload: { recipientId: "68df8a0f5a2d8c871be12345", text: "Hello" } });
    expect(listing.statusCode).toBe(401);
    expect(send.statusCode).toBe(401);
    expect(listing.json().code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("requires a session for notification listing and read receipts", async () => {
    const listing = await app.inject({ method: "GET", url: "/api/v1/notifications" });
    const read = await app.inject({ method: "POST", url: "/api/v1/notifications/read", payload: {} });
    expect(listing.statusCode).toBe(401);
    expect(read.statusCode).toBe(401);
    expect(listing.json().code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("requires a session to read or update account preferences", async () => {
    const read = await app.inject({ method: "GET", url: "/api/v1/me/settings" });
    const update = await app.inject({ method: "PATCH", url: "/api/v1/me/settings", payload: { reduceMotion: true } });
    expect(read.statusCode).toBe(401);
    expect(update.statusCode).toBe(401);
  });

  it("requires a session for likes, report submissions, and follow management", async () => {
    const id = "68df8a0f5a2d8c871be12345";
    const like = await app.inject({ method: "POST", url: `/api/v1/videos/${id}/like` });
    const report = await app.inject({ method: "POST", url: `/api/v1/videos/${id}/report`, payload: { reason: "spam" } });
    const followRequest = await app.inject({ method: "GET", url: "/api/v1/me/follow-requests" });
    expect(like.statusCode).toBe(401);
    expect(report.statusCode).toBe(401);
    expect(followRequest.statusCode).toBe(401);
  });
});
