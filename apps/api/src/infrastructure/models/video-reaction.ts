import mongoose, { type Model, type Types } from "mongoose";
export type VideoReactionKind = "like" | "save" | "repost";
export interface VideoReactionRecord { userId: Types.ObjectId; videoId: Types.ObjectId; kind: VideoReactionKind; createdAt: Date; }
const schema = new mongoose.Schema<VideoReactionRecord>({ userId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true }, videoId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqVideo", required: true }, kind: { type: String, enum: ["like", "save", "repost"], required: true } }, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
schema.index({ userId: 1, videoId: 1, kind: 1 }, { unique: true });
schema.index({ videoId: 1, kind: 1, createdAt: -1 });
export const VideoReactionModel: Model<VideoReactionRecord> = (mongoose.models["NerloqVideoReaction"] as Model<VideoReactionRecord> | undefined) ?? mongoose.model<VideoReactionRecord>("NerloqVideoReaction", schema, "video_reactions");
