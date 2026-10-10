import mongoose, { type Model, type Types } from "mongoose";

export type UploadSessionStatus = "created" | "uploading" | "processing" | "completed" | "failed" | "cancelled";

export interface UploadSessionRecord {
  ownerId: Types.ObjectId;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  chunkSizeBytes: number;
  totalChunks: number;
  uploadedChunks: number[];
  status: UploadSessionStatus;
  tempDirectory: string;
  storageKey: string | null;
  mediaAssetId: Types.ObjectId | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<UploadSessionRecord>({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true, index: true },
  filename: { type: String, required: true, maxlength: 255 },
  mimeType: { type: String, required: true, maxlength: 255 },
  sizeBytes: { type: Number, required: true, min: 1 },
  checksum: { type: String, required: true, maxlength: 256 },
  chunkSizeBytes: { type: Number, required: true, min: 1 },
  totalChunks: { type: Number, required: true, min: 1 },
  uploadedChunks: { type: [Number], default: [] },
  status: { type: String, enum: ["created", "uploading", "processing", "completed", "failed", "cancelled"], default: "created", index: true },
  tempDirectory: { type: String, required: true },
  storageKey: { type: String, default: null },
  mediaAssetId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqMediaAsset", default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ ownerId: 1, createdAt: -1 });

export const UploadSessionModel: Model<UploadSessionRecord> =
  (mongoose.models["NerloqUploadSession"] as Model<UploadSessionRecord> | undefined) ??
  mongoose.model<UploadSessionRecord>("NerloqUploadSession", schema, "upload_sessions");
