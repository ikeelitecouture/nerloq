import type { FastifyRequest } from "fastify";
import { ACCESS_COOKIE } from "../features/auth/cookies.js";
import { SessionModel } from "./models/session.js";
import { UserModel } from "./models/user.js";

function authenticationError(): Error & { statusCode: number; code: string } {
  return Object.assign(new Error("Sign in to continue."), {
    statusCode: 401,
    code: "AUTHENTICATION_REQUIRED",
  });
}

/**
 * Optional authentication for public routes. A missing cookie is anonymous;
 * a stale or revoked credential must remain a 401 so the web client can refresh.
 */
export async function authenticate(
  request: FastifyRequest,
  options: { readonly rejectInvalidCredential?: boolean } = {},
): Promise<string | null> {
  const suppliedCredential = Boolean(request.cookies[ACCESS_COOKIE] || request.headers.authorization);
  const rejectInvalidCredential = options.rejectInvalidCredential ?? true;

  try {
    await request.jwtVerify();
    const userId = request.user.sub;
    const [session, user] = await Promise.all([
      SessionModel.exists({ _id: request.user.sid, userId, expiresAt: { $gt: new Date() } }),
      UserModel.exists({ _id: userId, status: "active" }),
    ]);
    if (!session || !user) throw authenticationError();
    return userId;
  } catch (error) {
    if (suppliedCredential && rejectInvalidCredential) {
      if (error instanceof Error && "code" in error && error.code === "AUTHENTICATION_REQUIRED") throw error;
      throw authenticationError();
    }
    return null;
  }
}
