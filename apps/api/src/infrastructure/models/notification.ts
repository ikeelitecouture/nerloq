import mongoose, { type Model, type Types } from "mongoose";

export type NotificationKind = "like" | "comment" | "reply" | "follow" | "mention" | "repost" | "system";
export interface NotificationRecord {
  recipientId: Types.ObjectId;
  actorId: Types.ObjectId | null;
  kind: NotificationKind;
  videoId: Types.ObjectId | null;
  commentId: Types.ObjectId | null;
  message: string;
  readAt: Date | null;
  createdAt: Date;
}

const schema = new mongoose.Schema<NotificationRecord>({
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", default: null },
  kind: { type: String, enum: ["like", "comment", "reply", "follow", "mention", "repost", "system"], required: true },
  videoId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqVideo", default: null },
  commentId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqComment", default: null },
  message: { type: String, required: true, maxlength: 240 },
  readAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
schema.index({ recipientId:  1, createdAt: -1, _id: -1 });
schema.index({ recipientId: 1, readAt: 1 });
export const NotificationModel: Model<NotificationRecord> = (mongoose.models["NerloqNotification"] as Model<NotificationRecord> | undefined) ?? mongoose.model<NotificationRecord>("NerloqNotification", schema, "notifications");
