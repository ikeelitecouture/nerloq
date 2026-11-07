import mongoose, { type Model, type Types } from "mongoose";
export interface UserMuteRecord { userId: Types.ObjectId; mutedId: Types.ObjectId; createdAt: Date; }
const schema = new mongoose.Schema<UserMuteRecord>({ userId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true }, mutedId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true } }, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
schema.index({ userId: 1, mutedId: 1 }, { unique: true });
export const UserMuteModel: Model<UserMuteRecord> = (mongoose.models["NerloqUserMute"] as Model<UserMuteRecord> | undefined) ?? mongoose.model<UserMuteRecord>("NerloqUserMute", schema, "user_mutes");
