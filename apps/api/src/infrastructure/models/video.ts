import mongoose, { type HydratedDocument, type Model, type Types } from "mongoose";
import type { VideoPrivacy } from "@nerloq/shared";

export interface VideoRecord {
  creatorId: Types.ObjectId;
  caption: string;
  hashtags: string[];
  mediaKey: string;
  mimeType: string;
  mediaSizeBytes: number;
  mediaWidth: number | null;
  mediaHeight: number | null;
  checksum: string;
  durationMs: number;
  thumbnailUrl: string | null;
  thumbnailKey: string | null;
  thumbnailMimeType: string | null;
  privacy: VideoPrivacy;
  status: "published" | "removed";
  commentsAllowed: boolean;
  allowDownloads: boolean;
  likeCount: number;
  commentCount: number;
  repostCount: number;
  shareCount: number;
  saveCount: number;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}
export type VideoDocument = HydratedDocument<VideoRecord>;
const schema = new mongoose.Schema<VideoRecord>({
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true, index: true },
  caption: { type: String, default: "", maxlength: 2200 },
  hashtags: { type: [String], default: [] },
  mediaKey: { type: String, required: true, unique: true },
  mimeType: { type: String, enum: ["video/mp4", "video/webm", "video/quicktime"], required: true },
  mediaSizeBytes: { type: Number, required: true, min: 1 },
  mediaWidth: { type: Number, default: null, min: 1, max: 3840 },
  mediaHeight: { type: Number, default: null, min: 1, max: 3840 },
  checksum: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  durationMs: { type: Number, required: true, min: 1 },
  thumbnailUrl: { type: String, default: null },
  thumbnailKey: { type: String, default: null },
  thumbnailMimeType: { type: String, enum: ["image/jpeg", "image/png", "image/webp", null], default: null },
  privacy: { type: String, enum: ["public", "followers", "private"], default: "public", index: true },
  status: { type: String, enum: ["published", "removed"], default: "published", index: true },
  commentsAllowed: { type: Boolean, default: true },
  allowDownloads: { type: Boolean, default: false },
  likeCount: { type: Number, default: 0, min: 0 },
  commentCount: { type: Number, default: 0, min: 0 },
  repostCount: { type: Number, default: 0, min: 0 },
  shareCount: { type: Number, default: 0, min: 0 },
  saveCount: { type: Number, default: 0, min: 0 },
  viewCount: { type: Number, default: 0, min: 0 },
}, { timestamps: true, versionKey: false });
schema.index({ status: 1, privacy: 1, createdAt: -1, _id: -1 });
schema.index({ creatorId: 1, status: 1, createdAt: -1 });
schema.index({ hashtags: 1, status: 1 });
export const VideoModel: Model<VideoRecord> = (mongoose.models["NerloqVideo"] as Model<VideoRecord> | undefined) ?? mongoose.model<VideoRecord>("NerloqVideo", schema, "videos");
