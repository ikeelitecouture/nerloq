import mongoose, { type Model, type Types } from "mongoose";

export interface StoryRecord {
  creatorId: Types.ObjectId;
  mediaAssetId: Types.ObjectId;
  caption: string;
  mentions: Types.ObjectId[];
  hashtags: string[];
  status: "active" | "expired" | "removed";
  viewCount: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<StoryRecord>({
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true, index: true },
  mediaAssetId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqMediaAsset", required: true },
  caption: { type: String, default: "", maxlength: 2000 },
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser" }],
  hashtags: { type: [String], default: [] },
  status: { type: String, enum: ["active", "expired", "removed"], default: "active", index: true },
  viewCount: { type: Number, default: 0, min: 0 },
   expiresAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

schema.index({ creatorId: 1, status: 1, expiresAt: 1, createdAt: -1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const StoryModel: Model<StoryRecord> =
  (mongoose.models["NerloqStory"] as Model<StoryRecord> | undefined) ??
  mongoose.model<StoryRecord>("NerloqStory", schema, "stories");
