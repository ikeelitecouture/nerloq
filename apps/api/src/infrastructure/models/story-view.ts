import mongoose, { type Model, type Types } from "mongoose";

export interface StoryViewRecord {
  storyId: Types.ObjectId;
  viewerId: Types.ObjectId;
  createdAt: Date;
}

const schema = new mongoose.Schema<StoryViewRecord>({
  storyId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqStory", required: true },
  viewerId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

schema.index({ storyId: 1, viewerId: 1 }, { unique: true });
schema.index({ viewerId: 1, createdAt: -1 });

export const StoryViewModel: Model<StoryViewRecord> =
  (mongoose.models["NerloqStoryView"] as Model<StoryViewRecord> | undefined) ??
  mongoose.model<StoryViewRecord>("NerloqStoryView", schema, "story_views");
