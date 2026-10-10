import mongoose, { type Model, type Types } from "mongoose";
import type { InteractiveVideoLayer, ProductLink, VideoPrivacy } from "@nerloq/shared";

export interface DraftVideoRecord {
  ownerId: Types.ObjectId;
  mediaAssetId: Types.ObjectId | null;
  caption: string;
  privacy: VideoPrivacy;
  soundId: Types.ObjectId | null;
  productLinks: ProductLink[];
  interactiveLayers: InteractiveVideoLayer[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<DraftVideoRecord>({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true, index: true },
  mediaAssetId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqMediaAsset", default: null },
  caption: { type: String, default: "", maxlength: 4000 },
  privacy: { type: String, enum: ["public", "followers", "private"], default: "public" },
  soundId: { type: mongoose.Schema.Types.ObjectId, default: null },
  productLinks: { type: mongoose.Schema.Types.Mixed, default: [] },
  interactiveLayers: { type: mongoose.Schema.Types.Mixed, default: [] },
}, { timestamps: true, versionKey: false });

schema.index({ ownerId: 1, updatedAt: -1 });

export const DraftVideoModel: Model<DraftVideoRecord> =
  (mongoose.models["NerloqDraftVideo"] as Model<DraftVideoRecord> | undefined) ??
  mongoose.model<DraftVideoRecord>("NerloqDraftVideo", schema, "draft_videos");
