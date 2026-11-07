import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { Types } from "mongoose";
import { config } from "@nerloq/config";
import { deleteMediaFile, getMediaInfo, getMediaStream, uploadMediaFile } from "../../infrastructure/storage/media-storage.js";
import { clampPaginationLimit } from "@nerloq/shared";
import {
  completeUploadSchema,
  createDraftSchema,
  createStorySchema,
  playbackTelemetrySchema,
  updateDraftSchema,
  uploadChunkSchema,
  uploadInitializationSchema,
} from "@nerloq/validation";
import { inspectVideoMetadata, isSafeCoverImage, isSupportedVideoContent } from "../videos/media-validation.js";
import { authenticate } from "../../infrastructure/authentication.js";
import { UserModel } from "../../infrastructure/models/user.js";
import { UserBlockModel } from "../../infrastructure/models/user-block.js";
import { UserMuteModel } from "../../infrastructure/models/user-mute.js";
import { FollowModel } from "../../infrastructure/models/follow.js";
import { MediaAssetModel, type MediaAssetRecord } from "../../infrastructure/models/media-asset.js";
import { UploadSessionModel, type UploadSessionRecord } from "../../infrastructure/models/upload-session.js";
import { StoryModel, type StoryRecord } from "../../infrastructure/models/story.js";
import { StoryViewModel } from "../../infrastructure/models/story-view.js";
import { DraftVideoModel, type DraftVideoRecord } from "../../infrastructure/models/draft-video.js";
import { PlaybackTelemetryModel } from "../../infrastructure/models/playback-telemetry.js";
import { VideoModel, type VideoRecord } from "../../infrastructure/models/video.js";

const UPLOAD_ROOT = join(process.cwd(), "var", "uploads");
const MEDIA_ROOT = join(process.cwd(), "var", "media");
const CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

function envelope<T>(data: T, requestId: string) {
  return { data, requestId, timestamp: new Date().toISOString() };
}

function fail(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, status: number, code: string, message: string, requestId: string) {
  return reply.code(status).send({ code, message, requestId, timestamp: new Date().toISOString() });
}


function validObjectId(value: unknown): value is string {
  return typeof value === "string" && Types.ObjectId.isValid(value);
}

function parseInput<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } }, input: unknown): T | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}

function userSummary(user: { _id: Types.ObjectId; username: string; displayName: string; avatarUrl: string | null; verified: boolean }) {
  return { id: user._id.toString(), username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, verified: user.verified };
}

function assetUrl(id: Types.ObjectId): string {
  return `/api/v1/media-assets/${id.toString()}`;
}

function presentAsset(asset: MediaAssetRecord & { _id: Types.ObjectId }) {
  return {
    id: asset._id.toString(),
    url: assetUrl(asset._id),
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    status: asset.status,
    checksum: asset.checksum,
    createdAt: asset.createdAt.toISOString(),
  };
}

function uploadPath(directory: string, name: string): string {
  if (basename(name) !== name || name.includes("\\")) throw new Error("Invalid upload path.");
  return join(directory, name);
}

function extensionForMime(mimeType: string): string {
  return mimeType === "video/mp4" ? ".mp4" : mimeType === "video/quicktime" ? ".mov" : mimeType === "video/webm" ? ".webm" : mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : "";
}

function uploadView(session: UploadSessionRecord & { _id: Types.ObjectId }) {
  return {
    id: session._id.toString(),
    userId: session.ownerId.toString(),
    mediaAssetId: session.mediaAssetId?.toString() ?? null,
    status: session.status,
    chunkSizeBytes: session.chunkSizeBytes,
    totalChunks: session.totalChunks,
    uploadedChunks: session.uploadedChunks.length,
    expiresAt: session.expiresAt.toISOString(),
  };
}

function presentDraft(draft: DraftVideoRecord & { _id: Types.ObjectId }) {
  return {
    id: draft._id.toString(),
    ownerId: draft.ownerId.toString(),
    mediaAssetId: draft.mediaAssetId?.toString() ?? null,
    caption: draft.caption,
    privacy: draft.privacy,
    soundId: draft.soundId?.toString() ?? null,
    productLinks: draft.productLinks,
    interactiveLayers: draft.interactiveLayers,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

async function assetForOwner(mediaAssetId: string | null, ownerId: string): Promise<(MediaAssetRecord & { _id: Types.ObjectId }) | null> {
  if (mediaAssetId === null) return null;
  if (!validObjectId(mediaAssetId)) return null;
  return MediaAssetModel.findOne({ _id: mediaAssetId, ownerId, status: "ready" }).lean() as Promise<(MediaAssetRecord & { _id: Types.ObjectId }) | null>;
}

async function visibleStory(story: StoryRecord & { _id: Types.ObjectId }, viewerId: string | null): Promise<boolean> {
  if (story.status !== "active" || story.expiresAt <= new Date()) return false;
  const creator = await UserModel.findOne({ _id: story.creatorId, status: "active" }).select("isPrivate").lean();
  if (!creator) return false;
  if (!viewerId) return !creator.isPrivate;
  if (viewerId === story.creatorId.toString()) return true;
  if (await UserBlockModel.exists({ $or: [{ blockerId: viewerId, blockedId: story.creatorId }, { blockerId: story.creatorId, blockedId: viewerId }] })) return false;
  if (!creator?.isPrivate) return true;
  return Boolean(viewerId && await FollowModel.exists({ followerId: viewerId, creatorId: story.creatorId, status: "active" }));
}

async function canViewVideo(video: Pick<VideoRecord, "creatorId" | "privacy" | "status">, viewerId: string): Promise<boolean> {
  if (video.status !== "published") return false;
  if (!(await UserModel.exists({ _id: video.creatorId, status: "active" }))) return false;
  if (viewerId !== video.creatorId.toString() && await UserBlockModel.exists({ $or: [{ blockerId: viewerId, blockedId: video.creatorId }, { blockerId: video.creatorId, blockedId: viewerId }] })) return false;
  if (viewerId === video.creatorId.toString() || video.privacy === "public") return true;
  return video.privacy === "followers" && Boolean(await FollowModel.exists({ followerId: viewerId, creatorId: video.creatorId, status: "active" }));
}

async function presentStory(story: StoryRecord & { _id: Types.ObjectId }, viewerId: string | null) {
  const [creator, asset, viewed] = await Promise.all([
    UserModel.findOne({ _id: story.creatorId, status: "active" }).select("username displayName avatarUrl verified").lean(),
    MediaAssetModel.findOne({ _id: story.mediaAssetId, status: "ready" }).lean(),
    viewerId ? StoryViewModel.exists({ storyId: story._id, viewerId }) : Promise.resolve(false),
  ]);
  if (!creator || !asset) return null;
  return {
    id: story._id.toString(),
    creator: userSummary(creator),
    media: presentAsset(asset as MediaAssetRecord & { _id: Types.ObjectId }),
    caption: story.caption,
    mentions: [],
    hashtags: story.hashtags.map(tag => ({ tag, startIndex: 0, endIndex: 0 })),
    status: "active" as const,
    viewCount: story.viewCount,
    viewedByViewer: Boolean(viewed),
    expiresAt: story.expiresAt.toISOString(),
    createdAt: story.createdAt.toISOString(),
  };
}

export const extendedRoutes: FastifyPluginAsync = async (app) => {
  if (!app.hasContentTypeParser("application/octet-stream")) {
    app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  }

  app.post("/uploads", { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to initialize an upload.", request.id);

    const input = parseInput(uploadInitializationSchema, request.body);
    if (!input || !/^[a-f0-9]{64}$/i.test(input.checksum) || input.sizeBytes > config.MAX_UPLOAD_BYTES || !extensionForMime(input.mimeType)) return fail(reply, 400, "INVALID_UPLOAD", "The upload metadata is invalid or the media type is unsupported.", request.id);
    const totalChunks = Math.ceil(input.sizeBytes / CHUNK_SIZE_BYTES);
    const id = new Types.ObjectId();
    const directory = join(UPLOAD_ROOT, id.toString());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const session = await UploadSessionModel.create({
      _id: id,
      ownerId: userId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum,
      chunkSizeBytes: CHUNK_SIZE_BYTES,
      totalChunks,
      uploadedChunks: [],
      status: "created",
      tempDirectory: directory,
      storageKey: null,
      mediaAssetId: null,
      expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
    });
    return reply.code(201).send(envelope({ upload: uploadView(session) }, request.id));
  });

  app.post("/uploads/:uploadSessionId/chunks/:chunkIndex", { bodyLimit: CHUNK_SIZE_BYTES + 1024 * 1024, config: { rateLimit: { max: 500, timeWindow: 60_000 } } }, async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to upload a chunk.", request.id);
    const { uploadSessionId, chunkIndex: rawChunkIndex } = request.params as { uploadSessionId: string; chunkIndex: string };
    const chunkIndex = Number(rawChunkIndex);
    if (!validObjectId(uploadSessionId) || !Number.isSafeInteger(chunkIndex) || chunkIndex < 0) return fail(reply, 400, "INVALID_UPLOAD_CHUNK", "The upload chunk is invalid.", request.id);
    const session = await UploadSessionModel.findOne({ _id: uploadSessionId, ownerId: userId, expiresAt: { $gt: new Date() }, status: { $in: ["created", "uploading"] } });
    if (!session || chunkIndex >= session.totalChunks) return fail(reply, 404, "UPLOAD_UNAVAILABLE", "This upload session is unavailable.", request.id);
    const input = parseInput(uploadChunkSchema, { uploadSessionId, chunkIndex, checksum: request.headers["x-chunk-checksum"] ?? "" });
    if (!input || typeof request.body !== "object" || !Buffer.isBuffer(request.body)) return fail(reply, 400, "INVALID_UPLOAD_CHUNK", "Send the chunk as an octet-stream with its SHA-256 checksum.", request.id);
    const chunk = request.body as Buffer;
    const expectedSize = chunkIndex === session.totalChunks - 1 ? session.sizeBytes - (session.totalChunks - 1) * session.chunkSizeBytes : session.chunkSizeBytes;
    if (chunk.length !== expectedSize) return fail(reply, 400, "INVALID_UPLOAD_CHUNK_SIZE", "The chunk size does not match the upload session.", request.id);
    const checksum = createHash("sha256").update(chunk).digest("hex");
    const suppliedChecksum = String(input.checksum).replace(/^sha256:/i, "").toLowerCase();
    if (suppliedChecksum !== checksum) return fail(reply, 400, "UPLOAD_CHECKSUM_MISMATCH", "The chunk checksum does not match its contents.", request.id);
    const path = uploadPath(session.tempDirectory, `chunk-${chunkIndex}`);
    try {
      const existing = await readFile(path);
      if (!existing.equals(chunk)) return fail(reply, 409, "UPLOAD_CHUNK_CONFLICT", "That chunk index already contains different data.", request.id);
    } catch {
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile(chunk); } finally { await handle.close(); }
    }
    const updated = await UploadSessionModel.findOneAndUpdate({ _id: session._id, ownerId: userId }, { $addToSet: { uploadedChunks: chunkIndex }, $set: { status: "uploading" } }, { new: true });
    return reply.send(envelope({ upload: uploadView(updated ?? session), checksum }, request.id));
  });

  app.post("/uploads/:uploadSessionId/complete", { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to complete an upload.", request.id);

    const { uploadSessionId } = request.params as { uploadSessionId: string };
    const input = parseInput(completeUploadSchema, { ...(request.body as Record<string, unknown> | null), uploadSessionId });
    if (!input || !validObjectId(uploadSessionId)) return fail(reply, 400, "INVALID_UPLOAD", "The upload completion payload is invalid.", request.id);
    const session = await UploadSessionModel.findOne({ _id: uploadSessionId, ownerId: userId, expiresAt: { $gt: new Date() }, status: { $in: ["created", "uploading"] } });
    if (!session || input.totalChunks !== session.totalChunks || session.uploadedChunks.length !== session.totalChunks) return fail(reply, 409, "UPLOAD_INCOMPLETE", "All upload chunks must be present before completion.", request.id);
    const finalKey = `${session._id.toString()}${extensionForMime(session.mimeType)}`;
    const finalPath = join(MEDIA_ROOT, finalKey);
    await mkdir(MEDIA_ROOT, { recursive: true, mode: 0o700 });
    await UploadSessionModel.updateOne({ _id: session._id }, { $set: { status: "processing" } });
    let cloudUploaded = false;
    try {
      const output = await open(finalPath, "wx", 0o600);
      try {
        for (let index = 0; index < session.totalChunks; index += 1) {
          const chunk = await readFile(uploadPath(session.tempDirectory, `chunk-${index}`));
          await output.write(chunk);
        }
      } finally { await output.close(); }
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(finalPath)) digest.update(chunk as Buffer);
      const checksum = digest.digest("hex");
       if (checksum !== session.checksum.toLowerCase()) throw Object.assign(new Error("Upload checksum does not match."), { statusCode: 400, code: "UPLOAD_CHECKSUM_MISMATCH" });
      const prefixHandle = await open(finalPath, "r");
      const prefix = Buffer.alloc(4096);
      try { await prefixHandle.read(prefix, 0, prefix.length, 0); } finally { await prefixHandle.close(); }
      let width: number | null = null;
      let height: number | null = null;
      let durationMs: number | null = null;
      if (session.mimeType.startsWith("video/")) {
        if (!isSupportedVideoContent(session.mimeType, prefix)) throw Object.assign(new Error("The uploaded file contents do not match its media type."), { statusCode: 415, code: "INVALID_MEDIA_CONTENT" });
        const metadata = await inspectVideoMetadata(config.FFPROBE_BINARY, finalPath);
        width = metadata.width;
        height = metadata.height;
        durationMs = metadata.durationMs;
        if (durationMs > config.MAX_VIDEO_DURATION_MS || width > config.MAX_VIDEO_WIDTH || height > config.MAX_VIDEO_HEIGHT) throw Object.assign(new Error("The uploaded media exceeds the configured limits."), { statusCode: 400, code: "MEDIA_LIMIT_EXCEEDED" });
      } else if (!isSafeCoverImage(session.mimeType, prefix)) {
        throw Object.assign(new Error("The uploaded file contents do not match its media type."), { statusCode: 415, code: "INVALID_MEDIA_CONTENT" });
      }
      const byteSize = (await stat(finalPath)).size;
      if (config.MEDIA_STORAGE_PROVIDER !== "local") {
        await uploadMediaFile(finalKey, finalPath, session.mimeType);
        cloudUploaded = true;
      }
      const asset = await MediaAssetModel.create({ ownerId: userId, storageProvider: config.MEDIA_STORAGE_PROVIDER, storageKey: finalKey, mimeType: session.mimeType, byteSize, width, height, durationMs, status: "ready", checksum });
      await UploadSessionModel.updateOne({ _id: session._id }, { $set: { status: "completed", storageKey: finalKey, mediaAssetId: asset._id } });
      if (cloudUploaded) await rm(finalPath, { force: true });
      await rm(session.tempDirectory, { recursive: true, force: true });
      return reply.send(envelope({ upload: uploadView({ ...session.toObject(), status: "completed", storageKey: finalKey, mediaAssetId: asset._id }), mediaAsset: presentAsset(asset) }, request.id));
     } catch (error) {
      if (cloudUploaded) {
        await deleteMediaFile(finalKey).catch((cleanupError: unknown) => {
          request.log.error({ err: cleanupError }, "Failed to clean up cloud media after upload failure");
        });
      }
       await rm(finalPath, { force: true }).catch(() => undefined);
       await rm(session.tempDirectory, { recursive: true, force: true }).catch(() => undefined);
       await MediaAssetModel.deleteOne({ storageKey: finalKey, ownerId: userId }).catch(() => undefined);
       await UploadSessionModel.updateOne({ _id: session._id }, { $set: { status: "failed" } });
      const err = error as { statusCode?: number; code?: string; message?: string };
      const status = err.statusCode ?? 500;
      if (status >= 500) request.log.error({ err: error }, "Resumable upload completion failed");
      return fail(reply, status, err.code ?? "UPLOAD_FAILED", status >= 500 ? "The upload could not be completed." : err.message ?? "The upload could not be completed.", request.id);
    }
  });

  app.get("/media-assets/:assetId", async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    if (!validObjectId(assetId)) return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);

    const viewerId = await authenticate(request, { rejectInvalidCredential: false });
    const asset = await MediaAssetModel.findOne({ _id: assetId, status: "ready" });
    if (!asset) return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);

    const isOwner = viewerId === asset.ownerId.toString();
    const story = !isOwner
      ? await StoryModel.findOne({
          mediaAssetId: asset._id,
          status: "active",
          expiresAt: { $gt: new Date() },
        })
      : null;

    if (!isOwner && (!story || !(await visibleStory(story, viewerId)))) {
      return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
    }

    try {
      let size: number;
      let localPath: string | null = null;

      if (asset.storageProvider === "local") {
        localPath = uploadPath(MEDIA_ROOT, asset.storageKey);
        size = (await stat(localPath)).size;
      } else if (asset.storageProvider === "s3" || asset.storageProvider === "r2") {
        size = (await getMediaInfo(asset.storageKey)).size;
      } else {
        return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
      }

      if (!Number.isSafeInteger(size) || size <= 0) {
        return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
      }

      const cache = "private, no-store";
      const commonHeaders = reply
        .type(asset.mimeType)
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", cache)
        .header("Vary", "Cookie")
        .header("X-Content-Type-Options", "nosniff");

      const rangeHeader = request.headers.range;
      let startByte = 0;
      let endByte = size - 1;
      let partial = false;

      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

        if (!match || (!match[1] && !match[2])) {
          return reply.code(416).header("Content-Range", `bytes */${size}`).send();
        }

        if (!match[1]) {
          const suffixLength = Number(match[2]);
          if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
            return reply.code(416).header("Content-Range", `bytes */${size}`).send();
          }
          startByte = Math.max(0, size - suffixLength);
        } else {
          startByte = Number(match[1]);
          if (!Number.isSafeInteger(startByte) || startByte < 0) {
            return reply.code(416).header("Content-Range", `bytes */${size}`).send();
          }
        }

        if (match[2] && match[1]) {
          endByte = Number(match[2]);
          if (!Number.isSafeInteger(endByte) || endByte < startByte) {
            return reply.code(416).header("Content-Range", `bytes */${size}`).send();
          }
        }

        if (startByte >= size) {
          return reply.code(416).header("Content-Range", `bytes */${size}`).send();
        }

        endByte = Math.min(endByte, size - 1);
        partial = true;
      }

      const contentLength = endByte - startByte + 1;
      commonHeaders.header("Content-Length", String(contentLength));

      if (partial) {
        commonHeaders.header("Content-Range", `bytes ${startByte}-${endByte}/${size}`);
        commonHeaders.code(206);
      }

      const stream = localPath
        ? createReadStream(localPath, partial ? { start: startByte, end: endByte } : undefined)
        : await getMediaStream(
            asset.storageKey,
            partial ? { start: startByte, end: endByte } : undefined,
          );

      return commonHeaders.send(stream);
    } catch (error) {
      request.log.warn({ err: error, assetId }, "Media playback could not retrieve the asset");
      if (reply.sent) return;
      return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
    }
  });

  app.post("/stories", { config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to publish a story.", request.id);
    if (!config.ENABLE_STORIES) return fail(reply, 403, "STORIES_DISABLED", "Stories are currently unavailable.", request.id);
    const input = parseInput(createStorySchema, request.body);
    if (!input) return fail(reply, 400, "VALIDATION_ERROR", "Check the story details.", request.id);
    const asset = await assetForOwner(input.mediaAssetId, userId);
    if (!asset || !(asset.mimeType.startsWith("video/") || asset.mimeType.startsWith("image/"))) return fail(reply, 400, "MEDIA_UNAVAILABLE", "Choose an owned, processed image or video.", request.id);
    const mentions = input.mentions.filter(validObjectId).map(id => new Types.ObjectId(id));
    const story = await StoryModel.create({ creatorId: userId, mediaAssetId: asset._id, caption: input.caption, mentions, hashtags: input.hashtags.map(tag => tag.replace(/^#/, "").toLowerCase()), status: "active", viewCount: 0, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    return reply.code(201).send(envelope({ story: await presentStory(story, userId) }, request.id));
  });

  app.get("/stories/feed", async (request, reply) => {
    const viewerId = await authenticate(request);
    if (!viewerId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to view stories.", request.id);
    const query = request.query as { limit?: string };
    const limit = clampPaginationLimit(Number(query.limit) || undefined, 1, 100, 50);
    const following = await FollowModel.find({ followerId: viewerId, status: "active" }).distinct("creatorId");
    const [blocked, blocking, muted] = await Promise.all([
      UserBlockModel.find({ blockerId: viewerId }).distinct("blockedId"),
      UserBlockModel.find({ blockedId: viewerId }).distinct("blockerId"),
      UserMuteModel.find({ userId: viewerId }).distinct("mutedId"),
    ]);
    const hidden = [...blocked, ...blocking, ...muted];
    const rows = await StoryModel.find({ creatorId: { $in: [new Types.ObjectId(viewerId), ...following], $nin: hidden }, status: "active", expiresAt: { $gt: new Date() } }).sort({ createdAt: -1, _id: -1 }).limit(limit);
    return reply.send(envelope({ items: (await Promise.all(rows.map(row => presentStory(row, viewerId)))).filter(Boolean) }, request.id));
  });

  app.get("/stories/:storyId", async (request, reply) => {
    const { storyId } = request.params as { storyId: string };
    if (!validObjectId(storyId)) return fail(reply, 404, "STORY_UNAVAILABLE", "This story is unavailable.", request.id);
    const viewerId = await authenticate(request);
    const story = await StoryModel.findById(storyId);
    if (!story || !(await visibleStory(story, viewerId))) return fail(reply, 404, "STORY_UNAVAILABLE", "This story is unavailable.", request.id);
    return reply.send(envelope({ story: await presentStory(story, viewerId) }, request.id));
  });

  app.post("/stories/:storyId/view", async (request, reply) => {
    const viewerId = await authenticate(request);
    if (!viewerId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to view a story.", request.id);
    const { storyId } = request.params as { storyId: string };
    if (!validObjectId(storyId)) return fail(reply, 400, "INVALID_STORY_ID", "Story id is invalid.", request.id);
    const story = await StoryModel.findById(storyId);
    if (!story || !(await visibleStory(story, viewerId))) return fail(reply, 404, "STORY_UNAVAILABLE", "This story is unavailable.", request.id);
    try {
      const view = await StoryViewModel.create({ storyId: story._id, viewerId });
      if (view) await StoryModel.updateOne({ _id: story._id }, { $inc: { viewCount: 1 } });
      return reply.send(envelope({ counted: true }, request.id));
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return reply.send(envelope({ counted: false }, request.id));
      throw error;
    }
  });

  app.delete("/stories/:storyId", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to manage stories.", request.id);
    const { storyId } = request.params as { storyId: string };
    if (!validObjectId(storyId)) return fail(reply, 400, "INVALID_STORY_ID", "Story id is invalid.", request.id);
    const story = await StoryModel.findOneAndUpdate({ _id: storyId, creatorId: userId, status: "active" }, { $set: { status: "removed" } });
    if (!story) return fail(reply, 404, "STORY_UNAVAILABLE", "This story is unavailable.", request.id);
    return reply.send(envelope({ removed: true }, request.id));
  });

  app.post("/drafts", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to create a draft.", request.id);
    const input = parseInput(createDraftSchema, request.body);
    if (!input) return fail(reply, 400, "VALIDATION_ERROR", "Check the draft details.", request.id);
    if (input.mediaAssetId !== null && !(await assetForOwner(input.mediaAssetId, userId))) return fail(reply, 400, "MEDIA_UNAVAILABLE", "The selected media is unavailable.", request.id);
    const draft = await DraftVideoModel.create({ ownerId: userId, mediaAssetId: input.mediaAssetId ? new Types.ObjectId(input.mediaAssetId) : null, caption: input.caption, privacy: input.privacy, soundId: input.soundId && validObjectId(input.soundId) ? new Types.ObjectId(input.soundId) : null, productLinks: [], interactiveLayers: [] });
    return reply.code(201).send(envelope({ draft: presentDraft(draft) }, request.id));
  });

  app.get("/drafts", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to view drafts.", request.id);
    const rows = await DraftVideoModel.find({ ownerId: userId }).sort({ updatedAt: -1, _id: -1 }).limit(100).lean();
    return reply.send(envelope(rows.map(row => presentDraft(row as DraftVideoRecord & { _id: Types.ObjectId })), request.id));
  });

  app.patch("/drafts/:draftId", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to update a draft.", request.id);
    const { draftId } = request.params as { draftId: string };
    if (!validObjectId(draftId)) return fail(reply, 400, "INVALID_DRAFT_ID", "Draft id is invalid.", request.id);
    const input = parseInput(updateDraftSchema, request.body);
    if (!input || Object.keys(input).length === 0) return fail(reply, 400, "VALIDATION_ERROR", "Provide at least one draft field.", request.id);
    if (input["mediaAssetId"] !== undefined && input["mediaAssetId"] !== null && !(await assetForOwner(input["mediaAssetId"] as string, userId))) return fail(reply, 400, "MEDIA_UNAVAILABLE", "The selected media is unavailable.", request.id);
    const updates: Record<string, unknown> = { ...input };
    if (input["mediaAssetId"] !== undefined) updates["mediaAssetId"] = input["mediaAssetId"] ? new Types.ObjectId(input["mediaAssetId"] as string) : null;
    if (input["soundId"] !== undefined) updates["soundId"] = input["soundId"] && validObjectId(input["soundId"]) ? new Types.ObjectId(input["soundId"] as string) : null;
    const draft = await DraftVideoModel.findOneAndUpdate({ _id: draftId, ownerId: userId }, { $set: updates }, { new: true, runValidators: true });
    if (!draft) return fail(reply, 404, "DRAFT_UNAVAILABLE", "This draft is unavailable.", request.id);
    return reply.send(envelope({ draft: presentDraft(draft) }, request.id));
  });

  app.delete("/drafts/:draftId", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to delete a draft.", request.id);
    const { draftId } = request.params as { draftId: string };
    if (!validObjectId(draftId)) return fail(reply, 400, "INVALID_DRAFT_ID", "Draft id is invalid.", request.id);
    const result = await DraftVideoModel.deleteOne({ _id: draftId, ownerId: userId });
    if (result.deletedCount !== 1) return fail(reply, 404, "DRAFT_UNAVAILABLE", "This draft is unavailable.", request.id);
    return reply.send(envelope({ removed: true }, request.id));
  });

  app.post("/analytics/playback", { config: { rateLimit: { max: 120, timeWindow: 60_000 } } }, async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to submit playback telemetry.", request.id);
    const input = parseInput(playbackTelemetrySchema, request.body);
    if (!input || !validObjectId(input.videoId)) return fail(reply, 400, "VALIDATION_ERROR", "Playback telemetry is invalid.", request.id);
    if (input.source === "p2p" && !config.P2P_ENABLED) return fail(reply, 403, "P2P_DISABLED", "Peer playback is disabled.", request.id);
     const video = await VideoModel.findOne({ _id: input.videoId, status: "published" }).select("creatorId privacy status durationMs").lean();
     if (!video || !(await canViewVideo(video, userId))) return fail(reply, 404, "VIDEO_UNAVAILABLE", "This video is unavailable.", request.id);
    if (input.positionMs > video.durationMs + 30_000 || input.watchTimeMs > video.durationMs * 10) return fail(reply, 400, "INVALID_PLAYBACK_TELEMETRY", "Playback telemetry exceeds the video bounds.", request.id);
    await PlaybackTelemetryModel.create({ userId, videoId: input.videoId, sessionId: input.sessionId, positionMs: input.positionMs, bufferedMs: input.bufferedMs, watchTimeMs: input.watchTimeMs, completed: input.completed, source: input.source, p2pPeerCount: input.p2pPeerCount, clientTimestamp: new Date(input.clientTimestamp) });
    return reply.send(envelope({ accepted: true }, request.id));
  });
};
