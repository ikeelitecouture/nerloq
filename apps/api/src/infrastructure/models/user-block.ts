import mongoose, { type Model, type Types } from "mongoose";
export interface UserBlockRecord { blockerId: Types.ObjectId; blockedId: Types.ObjectId; createdAt: Date; }
const schema = new mongoose.Schema<UserBlockRecord>({ blockerId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true }, blockedId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true } }, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
schema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
schema.index({ blockedId: 1, blockerId: 1 });
export const UserBlockModel: Model<UserBlockRecord> = (mongoose.models["NerloqUserBlock"] as Model<UserBlockRecord> | undefined) ?? mongoose.model<UserBlockRecord>("NerloqUserBlock", schema, "user_blocks");
