import mongoose, { type Model, type Types } from "mongoose";
export interface FollowRecord { followerId: Types.ObjectId; creatorId: Types.ObjectId; status: "active" | "requested"; createdAt: Date; updatedAt: Date; }
const schema = new mongoose.Schema<FollowRecord>({ followerId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true }, creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true }, status: { type: String, enum: ["active", "requested"], default: "active" } }, { timestamps: true, versionKey: false });
schema.index({ followerId: 1, creatorId: 1 }, { unique: true });
schema.index({ creatorId: 1, status: 1 });
export const FollowModel: Model<FollowRecord> = (mongoose.models["NerloqFollow"] as Model<FollowRecord> | undefined) ?? mongoose.model<FollowRecord>("NerloqFollow", schema, "follows");
