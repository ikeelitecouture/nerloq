import mongoose, {
  type Connection,
  type ConnectOptions,
} from "mongoose";
import { Redis } from "ioredis";
import { UserModel } from "./models/user.js";
import { SessionModel } from "./models/session.js";
import { VideoModel } from "./models/video.js";
import { FollowModel } from "./models/follow.js";
import { VideoReactionModel } from "./models/video-reaction.js";
import { CommentModel } from "./models/comment.js";
import { UserBlockModel } from "./models/user-block.js";
import { UserMuteModel } from "./models/user-mute.js";
import { ContentReportModel } from "./models/content-report.js";
import { PasswordResetModel } from "./models/password-reset.js";
import { UserSettingsModel } from "./models/user-settings.js";
import { NotificationModel } from "./models/notification.js";
import { ConversationModel } from "./models/conversation.js";
import { MessageModel } from "./models/message.js";
import { MediaAssetModel } from "./models/media-asset.js";
import { UploadSessionModel } from "./models/upload-session.js";
import { StoryModel } from "./models/story.js";
import { StoryViewModel } from "./models/story-view.js";
import { DraftVideoModel } from "./models/draft-video.js";
import { PlaybackTelemetryModel } from "./models/playback-telemetry.js";
import {
  config,
  getMongoConnectionOptions,
  getRedisConnectionOptions,
} from "@nerloq/config";

export type DatabaseConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error";

export interface DatabaseHealth {
  readonly mongodb: DatabaseConnectionState;
  readonly redis: DatabaseConnectionState;
  readonly ready: boolean;
}

export interface DatabaseManager {
  readonly mongoConnection: Connection;
  readonly redis: Redis;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  health(): DatabaseHealth;
}

function createMongoOptions(): ConnectOptions {
  const mongoConfig = getMongoConnectionOptions();

  return {
    dbName: mongoConfig.database,
    maxPoolSize: 20,
    minPoolSize: 2,
    maxIdleTimeMS: 60000,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    heartbeatFrequencyMS: 10000,
    retryWrites: true,
    retryReads: true,
    family: 4,
    autoIndex: config.NODE_ENV !== "production",
    autoCreate: config.NODE_ENV !== "production",
  };
}

function createRedisClient(): Redis {
  const { url } = getRedisConnectionOptions();

  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    enableOfflineQueue: false,
    connectTimeout: 10000,
    commandTimeout: 5000,
    retryStrategy: (attempt: number) => {
      if (attempt >= 10) {
        return null;
      }

      return Math.min(attempt * 250, 3000);
    },
  });
}

class NERLOQDatabaseManager implements DatabaseManager {
  readonly mongoConnection: Connection;
  readonly redis: Redis;

  private mongoState: DatabaseConnectionState = "disconnected";
  private redisState: DatabaseConnectionState = "disconnected";
  private connectPromise: Promise<void> | null = null;
  private disconnectPromise: Promise<void> | null = null;

  constructor() {
    this.mongoConnection = mongoose.connection;
    this.redis = createRedisClient();

    this.attachMongoListeners();
    this.attachRedisListeners();
  }

  private attachMongoListeners(): void {
    this.mongoConnection.on("connecting", () => {
      this.mongoState = "connecting";
    });

    this.mongoConnection.on("connected", () => {
      this.mongoState = "connected";
    });

    this.mongoConnection.on("disconnected", () => {
      this.mongoState = "disconnected";
    });

    this.mongoConnection.on("reconnected", () => {
      this.mongoState = "connected";
    });

    this.mongoConnection.on("error", () => {
      this.mongoState = "error";
    });
  }

  private attachRedisListeners(): void {
    this.redis.on("connecting", () => {
      this.redisState = "connecting";
    });

    this.redis.on("ready", () => {
      this.redisState = "connected";
    });

    this.redis.on("close", () => {
      if (this.redisState !== "disconnecting") {
        this.redisState = "disconnected";
      }
    });

    this.redis.on("reconnecting", () => {
      this.redisState = "connecting";
    });

    this.redis.on("error", () => {
      this.redisState = "error";
    });
  }

  async connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (
      this.mongoState === "connected" &&
      this.redisState === "connected"
    ) {
      return;
    }

    this.connectPromise = this.connectInternal();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connectInternal(): Promise<void> {
    if (this.mongoState !== "connected") {
      this.mongoState = "connecting";

      try {
        const { uri } = getMongoConnectionOptions();

        await mongoose.connect(uri, createMongoOptions());
        await Promise.all([UserModel.createIndexes(), SessionModel.createIndexes(), VideoModel.createIndexes(), FollowModel.createIndexes(), VideoReactionModel.createIndexes(), CommentModel.createIndexes(), UserBlockModel.createIndexes(), UserMuteModel.createIndexes(), ContentReportModel.createIndexes(), PasswordResetModel.createIndexes(), UserSettingsModel.createIndexes(), NotificationModel.createIndexes(), ConversationModel.createIndexes(), MessageModel.createIndexes(), MediaAssetModel.createIndexes(), UploadSessionModel.createIndexes(), StoryModel.createIndexes(), StoryViewModel.createIndexes(), DraftVideoModel.createIndexes(), PlaybackTelemetryModel.createIndexes()]);

        this.mongoState = "connected";
      } catch (error) {
        this.mongoState = "error";

        throw new Error(
          `MongoDB connection failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (this.redisState !== "connected") {
      this.redisState = "connecting";

      try {
        await this.redis.connect();
        await this.redis.ping();

        this.redisState = "connected";
      } catch (error) {
        this.redisState = "error";

        await this.safeDisconnectRedis();
        if (config.REDIS_REQUIRED) {
          throw new Error(`Redis connection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.redisState = "disconnected";
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.disconnectPromise) {
      return this.disconnectPromise;
    }

    this.disconnectPromise = this.disconnectInternal();

    try {
      await this.disconnectPromise;
    } finally {
      this.disconnectPromise = null;
    }
  }

  private async disconnectInternal(): Promise<void> {
    this.mongoState = "disconnecting";
    this.redisState = "disconnecting";

    const mongoDisconnect = mongoose
      .disconnect()
      .catch((error: unknown) => {
        this.mongoState = "error";

        throw new Error(
          `MongoDB disconnection failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });

    const redisDisconnect = this.safeDisconnectRedis();

    const results = await Promise.allSettled([
      mongoDisconnect,
      redisDisconnect,
    ]);

    const failures = results
      .filter(
        (
          result,
        ): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason);

    if (failures.length > 0) {
      this.mongoState =
        results[0]?.status === "rejected"
          ? "error"
          : "disconnected";

      this.redisState =
        results[1]?.status === "rejected"
          ? "error"
          : "disconnected";

      throw new Error(
        failures
          .map((failure) =>
            failure instanceof Error
              ? failure.message
              : String(failure),
          )
          .join("; "),
      );
    }

    this.mongoState = "disconnected";
    this.redisState = "disconnected";
  }

  private async safeDisconnectRedis(): Promise<void> {
    if (
      this.redis.status === "end" ||
      this.redis.status === "wait"
    ) {
      this.redisState = "disconnected";
      return;
    }

    try {
      await this.redis.quit();
      this.redisState = "disconnected";
    } catch {
      this.redis.disconnect();
      this.redisState = "disconnected";
    }
  }

  health(): DatabaseHealth {
    return {
      mongodb: this.mongoState,
      redis: this.redisState,
      ready:
        this.mongoState === "connected" &&
        (this.redisState === "connected" || !config.REDIS_REQUIRED),
    };
  }
}

let manager: DatabaseManager | null = null;

export function getDatabaseManager(): DatabaseManager {
  if (!manager) {
    manager = new NERLOQDatabaseManager();
  }

  return manager;
}

export async function connectDatabase(): Promise<DatabaseManager> {
  const database = getDatabaseManager();

  await database.connect();

  return database;
}

export async function disconnectDatabase(): Promise<void> {
  if (!manager) {
    return;
  }

  await manager.disconnect();
}

export function getDatabaseHealth(): DatabaseHealth {
  return getDatabaseManager().health();
}
