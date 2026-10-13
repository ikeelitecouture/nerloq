import mongoose, { type Model, type Types } from "mongoose";

export type MediaAssetStatus = "ready" | "failed";

export interface MediaAssetRecord {
  ownerId: Types.ObjectId;
  storageProvider: "local" | "s3" | "r2";
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  status: MediaAssetStatus;
  checksum: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<MediaAssetRecord>({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true, index: true },
  storageProvider: { type: String, enum: ["local", "s3", "r2"], required: true },
  storageKey: { type: String, required: true, unique: true },
  mimeType: { type: String, required: true, maxlength: 255 },
  byteSize: { type: Number, required: true, min: 1 },
  width: { type: Number, default: null, min: 1 },
  height: { type: Number, default: null, min: 1 },
  durationMs: { type: Number, default: null, min: 1 },
  status: { type: String, enum: ["ready", "failed"], default: "ready", index: true },
  checksum: { type: String, required: true, maxlength: 256 },
}, { timestamps: true, versionKey: false });

schema.index({ ownerId: 1, createdAt: -1 });

export const MediaAssetModel: Model<MediaAssetRecord> =
  (mongoose.models["NerloqMediaAsset"] as Model<MediaAssetRecord> | undefined) ??
  mongoose.model<MediaAssetRecord>("NerloqMediaAsset", schema, "media_assets");
