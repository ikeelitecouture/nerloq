import mongoose, { type Model, type Types } from "mongoose";
export interface PasswordResetRecord { userId: Types.ObjectId; tokenHash: string; expiresAt: Date; createdAt: Date; }
const schema = new mongoose.Schema<PasswordResetRecord>({ userId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true, index: true }, tokenHash: { type: String, required: true, unique: true, select: false }, expiresAt: { type: Date, required: true } }, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PasswordResetModel: Model<PasswordResetRecord> = (mongoose.models["NerloqPasswordReset"] as Model<PasswordResetRecord> | undefined) ?? mongoose.model<PasswordResetRecord>("NerloqPasswordReset", schema, "password_resets");
