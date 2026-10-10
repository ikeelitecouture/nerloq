import mongoose, { type HydratedDocument, type Model } from "mongoose";
import type { AccountStatus, UserRole } from "@nerloq/shared";

export interface UserRecord {
  email: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  status: AccountStatus;
  bio: string;
  websiteUrl: string | null;
  avatarUrl: string | null;
  verified: boolean;
  isPrivate: boolean;
  followerCount: number;
  followingCount: number;
  videoCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<UserRecord>;

const userSchema = new mongoose.Schema<UserRecord>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 30 },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["user", "creator", "business", "moderator", "administrator"], default: "user", required: true },
    status: { type: String, enum: ["active", "suspended", "deactivated", "deleted", "pending_verification"], default: "active", required: true },
    bio: { type: String, default: "", maxlength: 500 },
    websiteUrl: { type: String, default: null },
    avatarUrl: { type: String, default: null },
    verified: { type: Boolean, default: false, required: true },
    isPrivate: { type: Boolean, default: false, required: true },
    followerCount: { type: Number, default: 0, min: 0, required: true },
    followingCount: { type: Number, default: 0, min: 0, required: true },
    videoCount: { type: Number, default: 0, min: 0, required: true },
  },
  { timestamps: true, versionKey: false },
);


export const UserModel: Model<UserRecord> =
  (mongoose.models["NerloqUser"] as Model<UserRecord> | undefined) ??
  mongoose.model<UserRecord>("NerloqUser", userSchema, "users");
