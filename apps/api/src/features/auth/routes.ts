import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { config } from "@nerloq/config";
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, updateProfileSchema } from "@nerloq/validation";
import { UserModel } from "../../infrastructure/models/user.js";
import { SessionModel } from "../../infrastructure/models/session.js";
import { disconnectRealtimeSession, disconnectRealtimeUser } from "../../infrastructure/realtime/socket.js";
import { AuthService, AuthServiceError, toPublicUser } from "./service.js";
import { REFRESH_COOKIE, clearSessionCookies, setSessionCookies } from "./cookies.js";

const authService = new AuthService();

function success<T>(data: T, requestId: string) {
  return { data, requestId, timestamp: new Date().toISOString() };
}

function setAccess(reply: FastifyReply, userId: string, sessionId: string): string {
  return reply.server.jwt.sign({ sub: userId, sid: sessionId }, { expiresIn: config.JWT_ACCESS_EXPIRES_IN });
}

function parseBody<T>(schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } } }, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const error = new AuthServiceError(400, "VALIDATION_ERROR", "Please check the submitted details.");
    Object.assign(error, { details: result.error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message })) });
    throw error;
  }
  return result.data;
}

function sendFailure(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (error instanceof AuthServiceError) {
    const details = "details" in error ? (error as AuthServiceError & { details?: unknown }).details : undefined;
    return reply.code(error.statusCode).send({
      code: error.code,
      message: error.message,
      ...(details ? { details } : {}),
      requestId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
  if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
    return reply.code(409).send({ code: "PROFILE_CONFLICT", message: "That username is already in use.", requestId: request.id, timestamp: new Date().toISOString() });
  }
  if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 401) {
    return reply.code(401).send({ code: "AUTHENTICATION_REQUIRED", message: "Sign in to continue.", requestId: request.id, timestamp: new Date().toISOString() });
  }
  request.log.error({ err: error }, "Authentication request failed");
  return reply.code(500).send({ code: "INTERNAL_SERVER_ERROR", message: "An unexpected server error occurred.", requestId: request.id, timestamp: new Date().toISOString() });
}

async function issueCookies(reply: FastifyReply, userId: string, sessionId: string, refreshToken: string): Promise<void> {
  const accessToken = setAccess(reply, userId, sessionId);
  setSessionCookies(reply, accessToken, refreshToken);
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/register", { config: { rateLimit: { max: 5, timeWindow: 60_000 } } }, async (request, reply) => {
    try {
      if (!config.ENABLE_REGISTRATION) throw new AuthServiceError(403, "REGISTRATION_DISABLED", "New account registration is currently unavailable.");
      const input = parseBody(registerSchema, request.body);
      const session = await authService.register(input);
      await issueCookies(reply, session.user._id.toString(), session.sessionId, session.refreshToken);
      return reply.code(201).send(success({ user: toPublicUser(session.user), expiresAt: session.expiresAt.toISOString() }, request.id));
    } catch (error) { return sendFailure(reply, request, error); }
  });

  app.post("/login", { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (request, reply) => {
    try {
      const input = parseBody(loginSchema, request.body);
      const session = await authService.login(input.identifier, input.password);
      await issueCookies(reply, session.user._id.toString(), session.sessionId, session.refreshToken);
      return reply.send(success({ user: toPublicUser(session.user), expiresAt: session.expiresAt.toISOString() }, request.id));
    } catch (error) { return sendFailure(reply, request, error); }
  });

  app.post("/password/forgot", { config: { rateLimit: { max: 5, timeWindow: 60_000 } } }, async (request, reply) => {
    try {
      const input = parseBody(forgotPasswordSchema, request.body);
      try { await authService.requestPasswordReset(input.email); }
      catch (error) { request.log.error({ err: error }, "Password recovery delivery failed"); }
      return reply.send(success({ accepted: true, message: "If an account exists for that address, a reset link has been sent." }, request.id));
    } catch (error) { return sendFailure(reply, request, error); }
  });

  app.post("/password/reset", { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (request, reply) => {
    try {
      const input = parseBody(resetPasswordSchema, request.body);
      const userId = await authService.resetPassword(input.token, input.password);
      disconnectRealtimeUser(userId);
      return reply.send(success({ reset: true }, request.id));
    } catch (error) { return sendFailure(reply, request, error); }
  });

  app.post("/refresh", async (request, reply) => {
    try {
      const token = request.cookies[REFRESH_COOKIE];
      if (!token) throw new AuthServiceError(401, "SESSION_EXPIRED", "Your session has expired. Please sign in again.");
      const session = await authService.refresh(token);
      await issueCookies(reply, session.user._id.toString(), session.sessionId, session.refreshToken);
      return reply.send(success({ user: toPublicUser(session.user), expiresAt: session.expiresAt.toISOString() }, request.id));
    } catch (error) { clearSessionCookies(reply); return sendFailure(reply, request, error); }
  });

  app.post("/logout", async (request, reply) => {
    const sessionId = await authService.logout(request.cookies[REFRESH_COOKIE]);
    if (sessionId) disconnectRealtimeSession(sessionId);
    clearSessionCookies(reply);
    return reply.send(success({ signedOut: true }, request.id));
  });

  app.get("/me", async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.sub;
      const session = await SessionModel.findOne({ _id: request.user.sid, userId, expiresAt: { $gt: new Date() } });
      if (!session) throw new AuthServiceError(401, "SESSION_EXPIRED", "Your session is no longer valid.");
      const user = await UserModel.findById(userId);
      if (!user || user.status !== "active") throw new AuthServiceError(401, "SESSION_EXPIRED", "Your session is no longer valid.");
      return reply.send(success({ user: toPublicUser(user) }, request.id));
    } catch (error) { return sendFailure(reply, request, error); }
  });

  app.patch("/me", async (request, reply) => {
    try {
      await request.jwtVerify();
      const session = await SessionModel.findOne({ _id: request.user.sid, userId: request.user.sub, expiresAt: { $gt: new Date() } });
      if (!session) throw new AuthServiceError(401, "SESSION_EXPIRED", "Your session is no longer valid.");
      const input = parseBody(updateProfileSchema, request.body);
      for (const key of ["websiteUrl", "avatarUrl"] as const) {
        const value = input[key];
        if (value !== undefined && value !== null) {
          let url: URL;
          try { url = new URL(value); } catch { throw new AuthServiceError(400, "INVALID_PROFILE_URL", "Profile URLs must be valid HTTP or HTTPS URLs."); }
          if (url.protocol !== "http:" && url.protocol !== "https:") throw new AuthServiceError(400, "INVALID_PROFILE_URL", "Profile URLs must use HTTP or HTTPS.");
        }
      }
      const user = await authService.updateProfile(request.user.sub, input as Record<string, unknown>);
      return reply.send(success({ user: toPublicUser(user) }, request.id));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
        return reply.code(409).send({ code: "PROFILE_CONFLICT", message: "That username is already in use.", requestId: request.id, timestamp: new Date().toISOString() });
      }
      return sendFailure(reply, request, error);
    }
  });
};
