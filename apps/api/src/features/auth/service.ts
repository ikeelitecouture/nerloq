import { config } from "@nerloq/config";
import type { User } from "@nerloq/shared";
import { UserModel, type UserDocument } from "../../infrastructure/models/user.js";
import { SessionModel } from "../../infrastructure/models/session.js";
import { PasswordResetModel } from "../../infrastructure/models/password-reset.js";
import { createRefreshToken, hashPassword, hashRefreshToken, verifyPassword } from "./crypto.js";
import { sendPasswordResetEmail } from "../../infrastructure/email.js";
import { durationMilliseconds } from "./cookies.js";

let dummyPasswordHash: Promise<string> | null = null;

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword("invalid-login-password");
  return dummyPasswordHash;
}

function sessionExpiry(): Date {
  const refreshLifetime = durationMilliseconds(config.JWT_REFRESH_EXPIRES_IN, config.SESSION_IDLE_TIMEOUT_MS);
  return new Date(Date.now() + Math.min(refreshLifetime, config.SESSION_IDLE_TIMEOUT_MS));
}

export class AuthServiceError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = "AuthServiceError";
  }
}

export function toPublicUser(user: UserDocument): User {
  const record = user.toObject();
  return {
    id: user._id.toString(),
    username: record.username,
    displayName: record.displayName,
    avatarUrl: record.avatarUrl,
    verified: record.verified,
    isPrivate: record.isPrivate,
    email: record.email,
    role: record.role,
    status: record.status,
    bio: record.bio,
    websiteUrl: record.websiteUrl,
    followerCount: record.followerCount,
    followingCount: record.followingCount,
    videoCount: record.videoCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export class AuthService {
  async register(input: { email: string; username: string; displayName: string; password: string }) {
    if (input.password.length < config.PASSWORD_MIN_LENGTH) {
      throw new AuthServiceError(400, "PASSWORD_TOO_SHORT", `Password must contain at least ${config.PASSWORD_MIN_LENGTH} characters.`);
    }
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await UserModel.create({
        email: input.email,
        username: input.username,
        displayName: input.displayName,
        passwordHash,
      });
      return this.createSession(user);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
        throw new AuthServiceError(409, "ACCOUNT_ALREADY_EXISTS", "That email or username is already in use.");
      }
      throw error;
    }
  }

  async login(identifier: string, password: string) {
    const normalized = identifier.trim().toLowerCase();
    const user = await UserModel.findOne({
      $or: [{ email: normalized }, { username: normalized }],
    }).select("+passwordHash");
    const passwordHash = user?.passwordHash ?? await getDummyPasswordHash();
    if (!(await verifyPassword(password, passwordHash))) {
      throw new AuthServiceError(401, "INVALID_CREDENTIALS", "Email, username, or password is incorrect.");
    }
    if (!user) throw new AuthServiceError(401, "INVALID_CREDENTIALS", "Email, username, or password is incorrect.");
    if (user.status !== "active") {
      throw new AuthServiceError(403, "ACCOUNT_UNAVAILABLE", "This account is not available.");
    }
    return this.createSession(user);
  }

  async refresh(token: string) {
    const refreshToken = createRefreshToken();
    const expiresAt = sessionExpiry();
    const session = await SessionModel.findOneAndUpdate(
      { refreshTokenHash: hashRefreshToken(token, config.JWT_REFRESH_SECRET), expiresAt: { $gt: new Date() } },
      { $set: { refreshTokenHash: hashRefreshToken(refreshToken, config.JWT_REFRESH_SECRET), expiresAt } },
      { new: true, runValidators: true },
    );
    if (!session) {
      throw new AuthServiceError(401, "SESSION_EXPIRED", "Your session has expired. Please sign in again.");
    }
    const user = await UserModel.findById(session.userId);
    if (!user || user.status !== "active") {
      await session.deleteOne();
      throw new AuthServiceError(401, "SESSION_EXPIRED", "Your session has expired. Please sign in again.");
    }
    return { user, refreshToken, expiresAt, sessionId: session._id.toString() };
  }

  async logout(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const session = await SessionModel.findOneAndDelete({ refreshTokenHash: hashRefreshToken(token, config.JWT_REFRESH_SECRET) }).select("_id").lean();
    return session?._id.toString() ?? null;
  }


  async requestPasswordReset(email: string): Promise<void> {
    const user = await UserModel.findOne({ email: email.toLowerCase(), status: "active" });
    if (!user) return;
    const token = createRefreshToken();
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await PasswordResetModel.deleteMany({ userId: user._id });
    await PasswordResetModel.create({ userId: user._id, tokenHash: hashRefreshToken(token, config.JWT_REFRESH_SECRET), expiresAt });
    const url = new URL("/reset-password", config.WEB_PUBLIC_URL);
    url.searchParams.set("token", token);
    await sendPasswordResetEmail(user.email, user.displayName, url.toString());
  }

  async resetPassword(token: string, password: string): Promise<string> {
    if (password.length < config.PASSWORD_MIN_LENGTH) {
      throw new AuthServiceError(400, "PASSWORD_TOO_SHORT", `Password must contain at least ${config.PASSWORD_MIN_LENGTH} characters.`);
    }
    const tokenHash = hashRefreshToken(token, config.JWT_REFRESH_SECRET);
    const reset = await PasswordResetModel.findOne({ tokenHash, expiresAt: { $gt: new Date() } });
    if (!reset) throw new AuthServiceError(400, "RESET_LINK_INVALID", "This password reset link is invalid or expired.");
    const passwordHash = await hashPassword(password);
    const consumed = await PasswordResetModel.findOneAndDelete({ _id: reset._id, expiresAt: { $gt: new Date() } });
    if (!consumed) throw new AuthServiceError(400, "RESET_LINK_INVALID", "This password reset link is invalid or expired.");
    const update = await UserModel.updateOne({ _id: reset.userId, status: "active" }, { $set: { passwordHash } });
    if (update.matchedCount === 0) throw new AuthServiceError(400, "ACCOUNT_UNAVAILABLE", "This account is not available.");
    await SessionModel.deleteMany({ userId: reset.userId });
    return reset.userId.toString();
  }

  async updateProfile(userId: string, input: Record<string, unknown>): Promise<UserDocument> {
    const user = await UserModel.findByIdAndUpdate(userId, { $set: input }, { new: true, runValidators: true });
    if (!user) throw new AuthServiceError(404, "ACCOUNT_NOT_FOUND", "Account not found.");
    return user;
  }

  private async createSession(user: UserDocument) {
    const refreshToken = createRefreshToken();
    const expiresAt = sessionExpiry();
    const session = await SessionModel.create({
      userId: user._id,
      refreshTokenHash: hashRefreshToken(refreshToken, config.JWT_REFRESH_SECRET),
      expiresAt,
    });
    return { user, refreshToken, expiresAt, sessionId: session._id.toString() };
  }
}
