import mongoose, { type Model, type Types } from "mongoose";

export interface PlaybackTelemetryRecord {
  userId: Types.ObjectId;
  videoId: Types.ObjectId;
  sessionId: string;
  positionMs: number;
  bufferedMs: number;
  watchTimeMs: number;
  completed: boolean;
  source: "cdn" | "p2p";
  p2pPeerCount: number;
  clientTimestamp: Date;
  createdAt: Date;
}

const schema = new mongoose.Schema<PlaybackTelemetryRecord>({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqUser", required: true, index: true },
  videoId: { type: mongoose.Schema.Types.ObjectId, ref: "NerloqVideo", required: true, index: true },
  sessionId: { type: String, required: true, maxlength: 128 },
  positionMs: { type: Number, required: true, min: 0 },
  bufferedMs: { type: Number, required: true, min: 0 },
  watchTimeMs: { type: Number, required: true, min: 0 },
  completed: { type: Boolean, required: true },
  source: { type: String, enum: ["cdn", "p2p"], required: true },
  p2pPeerCount: { type: Number, required: true, min: 0, max: 8 },
  clientTimestamp: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

schema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });
schema.index({ videoId: 1, createdAt: -1 });

export const PlaybackTelemetryModel: Model<PlaybackTelemetryRecord> =
  (mongoose.models["NerloqPlaybackTelemetry"] as Model<PlaybackTelemetryRecord> | undefined) ??
  mongoose.model<PlaybackTelemetryRecord>("NerloqPlaybackTelemetry", schema, "playback_telemetry");
