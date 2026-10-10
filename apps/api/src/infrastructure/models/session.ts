import mongoose, { type Model, type Types } from "mongoose";

export interface SessionRecord {
  userId: Types.ObjectId;
  refreshTokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new mongoose.Schema<SessionRecord>(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SessionModel: Model<SessionRecord> =
  (mongoose.models["NerloqSession"] as Model<SessionRecord> | undefined) ??
  mongoose.model<SessionRecord>("NerloqSession", sessionSchema, "sessions");
