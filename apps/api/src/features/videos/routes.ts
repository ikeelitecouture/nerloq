import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { basename, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { Types } from "mongoose";
import multipart from "@fastify/multipart";
import { config } from "@nerloq/config";
import { clampPaginationLimit } from "@nerloq/shared";
import { UserModel } from "../../infrastructure/models/user.js";
import { authenticate } from "../../infrastructure/authentication.js";
import { VideoModel, type VideoDocument, type VideoRecord } from "../../infrastructure/models/video.js";
import { PlaybackTelemetryModel } from "../../infrastructure/models/playback-telemetry.js";
import { FollowModel } from "../../infrastructure/models/follow.js";
import { VideoReactionModel, type VideoReactionKind } from "../../infrastructure/models/video-reaction.js";
import { CommentModel } from "../../infrastructure/models/comment.js";
import { UserBlockModel } from "../../infrastructure/models/user-block.js";
import { UserMuteModel } from "../../infrastructure/models/user-mute.js";
import { ContentReportModel, type ReportReason } from "../../infrastructure/models/content-report.js";
import { UserSettingsModel } from "../../infrastructure/models/user-settings.js";
import { NotificationModel, type NotificationKind } from "../../infrastructure/models/notification.js";
import { disconnectRealtimeUser, emitToUser } from "../../infrastructure/realtime/socket.js";
import { userSettingsSchema } from "@nerloq/validation";
import { inspectVideoMetadata, isSafeCoverImage, isSupportedVideoContent } from "./media-validation.js";
import { decodeCursor, encodeCursor } from "../../infrastructure/pagination.js";
import { deleteMediaFile, getMediaInfo, getMediaStream, uploadMediaFile } from "../../infrastructure/storage/media-storage.js";

const MEDIA_ROOT = join(process.cwd(), "var", "media");
type Actor = { id: string; username: string; displayName: string; avatarUrl: string | null; verified: boolean };
function envelope<T>(data: T, requestId: string) { return { data, requestId, timestamp: new Date().toISOString() }; }
function fail(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, status: number, code: string, message: string, requestId: string) {
  return reply.code(status).send({ code, message, requestId, timestamp: new Date().toISOString() });
}
function mediaPath(key: string): string {
  if (basename(key) !== key) throw new Error("Invalid media key.");
  return resolve(MEDIA_ROOT, key);
}
function actor(user: { _id: Types.ObjectId; username: string; displayName: string; avatarUrl: string | null; verified: boolean }): Actor {
  return { id: user._id.toString(), username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, verified: user.verified };
}
function publicId(id: string | undefined): boolean { return !!id && Types.ObjectId.isValid(id); }
async function createNotification(
  recipientId: string,
  actorId: string,
  kind: NotificationKind,
  videoId?: Types.ObjectId,
  commentId?: Types.ObjectId,
  messageOverride?: string,
  logger?: FastifyRequest["log"],
): Promise<void> {
  if (recipientId === actorId) return;

  try {
    const setting = kind === "like" || kind === "repost"
      ? "likes"
      : kind === "follow"
        ? "follows"
        : kind === "comment" || kind === "reply" || kind === "mention"
          ? "comments"
          : "system";
    const preferences = await UserSettingsModel.findOne({ userId: recipientId }).select("notifications").lean();
    if (preferences?.notifications?.[setting] === false) return;
    const message = messageOverride ?? (kind === "like"
      ? "liked your video"
      : kind === "repost"
        ? "reposted your video"
        : kind === "follow"
          ? "started following you"
          : kind === "reply"
            ? "replied to your comment"
            : kind === "mention"
              ? "mentioned you in a comment"
              : kind === "comment"
                ? "commented on your video"
                : "shared an update");
    const notification = await NotificationModel.create({ recipientId, actorId, kind, videoId: videoId ?? null, commentId: commentId ?? null, message });
    emitToUser(recipientId, "notification:new", { notificationId: notification._id.toString(), kind });
  } catch (error) {
    logger?.error({ err: error, recipientId, actorId, kind }, "Notification side effect failed");
  }
}
function toHashtags(caption: string): string[] { return [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((tag) => tag.slice(1).toLowerCase()))].slice(0, 30); }

async function canView(video: VideoDocument, viewerId: string | null): Promise<boolean> {
  if (video.status !== "published") return false;
  if (!(await UserModel.exists({ _id: video.creatorId, status: "active" }))) return false;
  if (viewerId && viewerId !== video.creatorId.toString() && await UserBlockModel.exists({ $or: [{ blockerId: viewerId, blockedId: video.creatorId }, { blockerId: video.creatorId, blockedId: viewerId }] })) return false;
  if (viewerId === video.creatorId.toString()) return true;
  if (video.privacy === "private") return false;
  if (video.privacy === "public") return true;
  if (!viewerId) return false;
  return !!(await FollowModel.exists({ followerId: viewerId, creatorId: video.creatorId, status: "active" }));
}
async function present(video: VideoRecord & { _id: Types.ObjectId }, viewerId: string | null) {
  const creator = await UserModel.findOne({ _id: video.creatorId, status: "active" }).select("username displayName avatarUrl verified").lean();
  if (!creator) return null;
  const ids = viewerId ? await VideoReactionModel.find({ userId: viewerId, videoId: video._id }).select("kind").lean() : [];
  const flags = new Set(ids.map((item) => item.kind));
  const id = video._id.toString();
  const tags = video.hashtags.map((tag) => ({ tag, startIndex: 0, endIndex: 0 }));
  return {
    id, creator: actor({ _id: creator._id, username: creator.username, displayName: creator.displayName, avatarUrl: creator.avatarUrl, verified: creator.verified }),
    caption: video.caption, hashtags: tags, mentions: [],
     media: { id: video.mediaKey, url: `/api/v1/media/${id}`, mimeType: video.mimeType, byteSize: video.mediaSizeBytes, width: video.mediaWidth, height: video.mediaHeight, durationMs: video.durationMs, status: "ready", checksum: video.checksum, createdAt: video.createdAt.toISOString() },
    manifest: null, thumbnailUrl: video.thumbnailKey ? `/api/v1/media/${id}/thumbnail` : video.thumbnailUrl, durationMs: video.durationMs, privacy: video.privacy, status: "published", sound: null,
    originalVideoId: null, duetSourceVideoId: null, stitchSourceVideoId: null, replyToCommentId: null, productLinks: [], interactiveLayers: [],
    likeCount: video.likeCount, commentCount: video.commentCount, repostCount: video.repostCount, shareCount: video.shareCount, saveCount: video.saveCount, viewCount: video.viewCount,
    likedByViewer: flags.has("like"), savedByViewer: flags.has("save"), repostedByViewer: flags.has("repost"), createdAt: video.createdAt.toISOString(), updatedAt: video.updatedAt.toISOString(),
  };
}
function cursorFilter(cursor: unknown) {
  return decodeCursor(cursor);
}

export const videoRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 2, fields: 8, parts: 10 } });

  app.get("/profiles/:username", async (request, reply) => {
    const { username } = request.params as { username: string };
    const normalized = username.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9._]{3,30}$/.test(normalized)) return fail(reply, 400, "INVALID_USERNAME", "Username is invalid.", request.id);
     const viewerId = await authenticate(request);
    const user = await UserModel.findOne({ username: normalized, status: "active" }).select("username displayName avatarUrl verified bio websiteUrl isPrivate followerCount followingCount videoCount createdAt");
    if (!user) return fail(reply, 404, "PROFILE_UNAVAILABLE", "This profile is unavailable.", request.id);
    const userId = user._id.toString();
    if (viewerId && viewerId !== userId && await UserBlockModel.exists({ $or: [{ blockerId: viewerId, blockedId: userId }, { blockerId: userId, blockedId: viewerId }] })) return fail(reply, 404, "PROFILE_UNAVAILABLE", "This profile is unavailable.", request.id);
    const relation = viewerId && viewerId !== userId ? await FollowModel.findOne({ followerId: viewerId, creatorId: userId }).select("status").lean() : null;
    const follows = relation?.status === "active";
    if (user.isPrivate && viewerId !== userId && !follows) return reply.send(envelope({ profile: { id: userId, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, verified: user.verified, bio: user.bio, websiteUrl: user.websiteUrl, followerCount: user.followerCount ?? 0, followingCount: user.followingCount ?? 0, videoCount: user.videoCount ?? 0, followStatus: relation?.status === "requested" ? "requested" : "none", isOwnProfile: false, isPrivate: true }, videos: [] }, request.id));
    const privacy = viewerId === userId ? ["public", "followers", "private"] : follows ? ["public", "followers"] : ["public"];
    const rows = await VideoModel.find({ creatorId: user._id, status: "published", privacy: { $in: privacy } }).sort({ createdAt: -1, _id: -1 }).limit(30);
    const profile = { id: userId, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, verified: user.verified, bio: user.bio, websiteUrl: user.websiteUrl, followerCount: user.followerCount ?? 0, followingCount: user.followingCount ?? 0, videoCount: user.videoCount ?? 0, followStatus: follows ? "following" : relation?.status === "requested" ? "requested" : "none", isOwnProfile: viewerId === userId, isPrivate: user.isPrivate };
    const videos = (await Promise.all(rows.map(video => present(video, viewerId)))).filter(Boolean);
    return reply.send(envelope({ profile, videos }, request.id));
  });

  app.get("/profiles/:username/followers", async (request, reply) => listProfileRelations(request, reply, "followers"));
  app.get("/profiles/:username/following", async (request, reply) => listProfileRelations(request, reply, "following"));
  async function listProfileRelations(request: FastifyRequest, reply: { code: (status: number) => { send: (body: unknown) => unknown }; send: (body: unknown) => unknown }, direction: "followers" | "following") {
    const { username } = request.params as { username: string };
    const owner = await UserModel.findOne({ username: username.trim().replace(/^@/, "").toLowerCase(), status: "active" }).select("_id isPrivate");
    if (!owner) return fail(reply, 404, "PROFILE_UNAVAILABLE", "This profile is unavailable.", request.id);
     const viewerId = await authenticate(request);
    if (owner.isPrivate && viewerId !== owner._id.toString() && !(viewerId && await FollowModel.exists({ followerId: viewerId, creatorId: owner._id, status: "active" }))) return fail(reply, 403, "PROFILE_PRIVATE", "Follow this account to see its community.", request.id);
    const query = direction === "followers" ? { creatorId: owner._id, status: "active" } : { followerId: owner._id, status: "active" };
    const relations = await FollowModel.find(query).sort({ createdAt: -1 }).limit(100).lean();
    const ids = relations.map(row => direction === "followers" ? row.followerId : row.creatorId);
    const users = await UserModel.find({ _id: { $in: ids }, status: "active" }).select("username displayName avatarUrl verified").lean();
    return reply.send(envelope(users.map(user => actor({ _id: user._id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, verified: user.verified })), request.id));
  }

  app.get("/search", async (request, reply) => {
    const query = request.query as { q?: string; limit?: string; type?: string };
    const term = (query.q ?? "").trim().slice(0, 80);
    if (term.length < 2) return fail(reply, 400, "QUERY_TOO_SHORT", "Search needs at least two characters.", request.id);
    if (query.type && !["all", "creators", "videos", "hashtags"].includes(query.type)) return fail(reply, 400, "INVALID_SEARCH_TYPE", "Choose a supported search category.", request.id);
    const viewerId = await authenticate(request);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "i");
    const hiddenCreators = viewerId ? [...await UserBlockModel.find({ blockerId: viewerId }).distinct("blockedId"), ...await UserBlockModel.find({ blockedId: viewerId }).distinct("blockerId"), ...await UserMuteModel.find({ userId: viewerId }).distinct("mutedId")] : [];
    const limit = clampPaginationLimit(Number(query.limit) || undefined, 1, 20, 12);
    const includeUsers = !query.type || query.type === "all" || query.type === "creators";
    const includeVideos = !query.type || query.type === "all" || query.type === "videos";
    const includeHashtags = !query.type || query.type === "all" || query.type === "hashtags";
    const videoMatch = query.type === "hashtags" ? { hashtags: pattern } : { $or: [{ caption: pattern }, { hashtags: pattern }] };
     const [users, matches, hashtagMatches] = await Promise.all([
      includeUsers ? UserModel.find({ status: "active", _id: { $nin: hiddenCreators }, $or: [{ username: pattern }, { displayName: pattern }] }).select("username displayName avatarUrl verified bio websiteUrl followerCount followingCount videoCount isPrivate").limit(limit).lean() : Promise.resolve([]),
      includeVideos ? VideoModel.find({ status: "published", privacy: "public", creatorId: { $nin: hiddenCreators }, ...videoMatch }).sort({ createdAt: -1 }).limit(limit) : Promise.resolve([]),
      includeHashtags ? VideoModel.find({ status: "published", privacy: "public", creatorId: { $nin: hiddenCreators }, hashtags: pattern }).select("hashtags").limit(limit) : Promise.resolve([]),
    ]);
     const videos = (await Promise.all(matches.map(video => present(video, viewerId)))).filter(Boolean);
     const relations = viewerId && users.length > 0 ? await FollowModel.find({ followerId: viewerId, creatorId: { $in: users.map(user => user._id) } }).select("creatorId status").lean() : [];
     const relationByCreator = new Map(relations.map(relation => [relation.creatorId.toString(), relation.status]));
     const people = users.map(user => ({ id: user._id.toString(), username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, verified: user.verified, bio: user.bio, websiteUrl: user.websiteUrl, followerCount: user.followerCount ?? 0, followingCount: user.followingCount ?? 0, videoCount: user.videoCount ?? 0, followStatus: viewerId === user._id.toString() ? "following" : relationByCreator.get(user._id.toString()) === "active" ? "following" : relationByCreator.get(user._id.toString()) === "requested" ? "requested" : "none", isOwnProfile: viewerId === user._id.toString(), isPrivate: user.isPrivate }));
     const hashtags = includeHashtags ? [...new Set(hashtagMatches.flatMap(video => video.hashtags).filter(tag => pattern.test(tag)))].slice(0, limit).map(tag => ({ tag, startIndex: 0, endIndex: 0 })) : [];
     return reply.send(envelope({ query: term, users: people, videos, hashtags, sounds: [], pagination: { cursor: null, hasMore: false, limit } }, request.id));
  });

  app.get("/hashtags/:tag/feed", async (request, reply) => {
    const { tag: rawTag } = request.params as { tag: string };
    const tag = rawTag.replace(/^#/, "").toLowerCase();
    if (!/^[\p{L}\p{N}_]{1,50}$/u.test(tag)) return fail(reply, 400, "INVALID_HASHTAG", "Hashtag is invalid.", request.id);
    const viewerId = await authenticate(request);
    const hidden = viewerId ? [...await UserBlockModel.find({ blockerId: viewerId }).distinct("blockedId"), ...await UserBlockModel.find({ blockedId: viewerId }).distinct("blockerId"), ...await UserMuteModel.find({ userId: viewerId }).distinct("mutedId")] : [];
    const rows = await VideoModel.find({ hashtags: tag, status: "published", privacy: "public", creatorId: { $nin: hidden } }).sort({ createdAt: -1, _id: -1 }).limit(30);
    return reply.send(envelope({ tag, items: (await Promise.all(rows.map(video => present(video, viewerId)))).filter(Boolean) }, request.id));
  });

  app.get("/feed", async (request, reply) => {
    const viewerId = await authenticate(request);
     const query = request.query as { cursor?: string; limit?: string; type?: string; excludeVideoIds?: string };
    const limit = clampPaginationLimit(Number(query.limit) || undefined, 1, 30, 10);
    const filter = cursorFilter(query.cursor);
    const type = query.type === "following" ? "following" : "for_you";
    const following = viewerId ? await FollowModel.find({ followerId: viewerId, status: "active" }).distinct("creatorId") : [];
    let visible: Record<string, unknown>[] = viewerId
      ? [{ privacy: "public" }, { privacy: "followers", creatorId: { $in: [viewerId, ...following] } }, { creatorId: viewerId }]
      : [{ privacy: "public" }];
    const hiddenCreators = viewerId ? await Promise.all([
      UserBlockModel.find({ blockerId: viewerId }).distinct("blockedId"),
      UserBlockModel.find({ blockedId: viewerId }).distinct("blockerId"),
      UserMuteModel.find({ userId: viewerId }).distinct("mutedId"),
    ]).then(groups => groups.flat()) : [];
    if (hiddenCreators.length) visible = visible.map(condition => ({ ...condition, creatorId: condition["creatorId"] ? { ...(condition["creatorId"] as Record<string, unknown>), $nin: hiddenCreators } : { $nin: hiddenCreators } }));
    if (type === "following") {
      if (!viewerId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to view your following feed.", request.id);
      visible.splice(0, visible.length, { creatorId: { $in: following, $nin: hiddenCreators }, $or: [{ privacy: "public" }, { privacy: "followers" }] });
    }
     const excludedVideoIds = (query.excludeVideoIds ?? "").split(",").filter(publicId).map((id) => new Types.ObjectId(id));
      const predicates: Record<string, unknown>[] = [
        { status: "published", $or: visible },
      ];
      if (Object.keys(filter).length > 0) predicates.push(filter);
      if (excludedVideoIds.length > 0) predicates.push({ _id: { $nin: excludedVideoIds } });
      const queryFilter = predicates.length === 1 ? predicates[0] ?? {} : { $and: predicates };
      const rows = await VideoModel.find(queryFilter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    let rankedPage = page;
    const tagAffinity = new Map<string, number>();
    let watchedIds = new Set<string>();
    const creatorAffinity = new Map<string, number>();
    const watchCounts = new Map<string, number>();
    const completedCounts = new Map<string, number>();
    const skipCounts = new Map<string, number>();
    const followedCreatorIds = new Set(following.map((id) => id.toString()));

    if (type === "for_you" && viewerId) {
      try {
        const history = await PlaybackTelemetryModel.find({
          userId: new Types.ObjectId(viewerId),
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        }).sort({ createdAt: -1 }).limit(300).select("videoId watchTimeMs completed").lean();

        watchedIds = new Set(history.map((entry) => entry.videoId.toString()));
        for (const entry of history) {
          const id = entry.videoId.toString();
          watchCounts.set(id, (watchCounts.get(id) ?? 0) + 1);
          if (entry.completed) {
            completedCounts.set(id, (completedCounts.get(id) ?? 0) + 1);
          }
        }
        const videoWeights = new Map<string, number>();
        for (const entry of history) {
          const id = entry.videoId.toString();
          const weight = Math.min(3, Math.log1p(entry.watchTimeMs / 1000)) +
            (entry.completed ? 2 : 0);
          videoWeights.set(id, Math.max(videoWeights.get(id) ?? 0, weight));
          if (!entry.completed && entry.watchTimeMs < 3000) {
            skipCounts.set(id, (skipCounts.get(id) ?? 0) + 1);
          }
        }
        const watched = watchedIds.size
          ? await VideoModel.find({ _id: { $in: [...watchedIds] } })
              .select("creatorId hashtags").lean()
          : [];

        for (const video of watched) {
          const creator = video.creatorId.toString();
          creatorAffinity.set(creator, (creatorAffinity.get(creator) ?? 0) + (videoWeights.get(video._id.toString()) ?? 1));
          for (const tag of video.hashtags ?? []) {
            const normalizedTag = tag.replace(/^#/, "").toLowerCase();
            tagAffinity.set(
              normalizedTag,
              (tagAffinity.get(normalizedTag) ?? 0) +
                (videoWeights.get(video._id.toString()) ?? 1)
            );
          }
        }
      } catch (error) {
        request.log.warn({ err: error }, "Personal recommendation history unavailable.");
      }
    }

    if (type === "for_you" && page.length > 1) {
      try {
        const ids = page.map((video) => video._id);
        const recent = await PlaybackTelemetryModel.aggregate<{
          _id: Types.ObjectId;
          avgWatchTime: number;
          completionRate: number;
        }>([
          { $match: { videoId: { $in: ids }, createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
          { $group: {
            _id: "$videoId",
            avgWatchTime: { $avg: "$watchTimeMs" },
            completionRate: { $avg: { $cond: ["$completed", 1, 0] } },
          } },
        ]);

        const signals = new Map(recent.map((item) => [
          item._id.toString(),
          item,
        ]));
        const now = Date.now();

        const score = (video: typeof page[number]): number => {
          const ageHours = Math.max(0, (now - new Date(video.createdAt).getTime()) / 3600000);
          const signal = signals.get(video._id.toString());
          const matchingTags = (video.hashtags ?? []).reduce((total, tag) => {
            const affinity = tagAffinity.get(tag.replace(/^#/, "").toLowerCase()) ?? 0;
            return total + Math.min(2, Math.log1p(affinity));
          }, 0);
          const creatorId = video.creatorId.toString();
          const creatorScore = Math.min(
            3,
            Math.log1p(creatorAffinity.get(creatorId) ?? 0)
          );
          const explorationBoost =
            watchedIds.size > 0 && !creatorAffinity.has(creatorId) ? 1.5 : 0;
          const repeatPenalty = Math.min(
            7,
            (watchCounts.get(video._id.toString()) ?? 0) * 2
          );
          const completedPenalty = Math.min(
            3,
            (completedCounts.get(video._id.toString()) ?? 0) * 1.5
          );
          const skipPenalty = Math.min(
            4,
            (skipCounts.get(video._id.toString()) ?? 0) * 2
          );
          const followBoost = followedCreatorIds.has(video.creatorId.toString()) ? 1.25 : 0;
          const personalBoost = followBoost + explorationBoost + (watchedIds.size
            ? (matchingTags * 1.5) + creatorScore - repeatPenalty - completedPenalty - skipPenalty
            : 0);
          return (
            personalBoost +
            2 * Math.log1p(video.likeCount ?? 0) +
            1.5 * Math.log1p(video.commentCount ?? 0) +
            2.5 * Math.log1p(video.repostCount ?? 0) +
            2 * Math.log1p(video.shareCount ?? 0) +
            2 * Math.log1p(video.saveCount ?? 0) +
            0.5 * Math.log1p(video.viewCount ?? 0) +
            2 * (signal?.completionRate ?? 0) +
            Math.min(2, (signal?.avgWatchTime ?? 0) / 30000) +
            3 / (1 + ageHours / 12) +
            (ageHours <= 6 && (video.viewCount ?? 0) < 100 ? 1 : 0) +
            (ageHours <= 6 && (video.viewCount ?? 0) < 100 ? 1 : 0)
          );
        };

        const remaining = [...page].sort((a, b) => score(b) - score(a));
        const selected: typeof page = [];
        const creatorCounts = new Map<string, number>();

        while (remaining.length) {
          remaining.sort((a, b) => {
            const aCount = creatorCounts.get(a.creatorId.toString()) ?? 0;
            const bCount = creatorCounts.get(b.creatorId.toString()) ?? 0;
            return (score(b) - 3 * bCount) - (score(a) - 3 * aCount);
          });
          const next = remaining.shift();
          if (!next) break;
          selected.push(next);
          const creator = next.creatorId.toString();
          creatorCounts.set(creator, (creatorCounts.get(creator) ?? 0) + 1);
        }
        rankedPage = selected;
      } catch (error) {
        request.log.warn({ err: error }, "Recommendation signals unavailable; using chronological feed order.");
      }
    }

    const items = (await Promise.all(rankedPage.map((video) => present(video, viewerId)))).filter(Boolean);
     const last = page.at(-1);
     return reply.send(envelope({ feedType: type, generatedAt: new Date().toISOString(), items, pagination: { cursor: hasMore && last ? encodeCursor(last.createdAt, last._id) : null, hasMore, limit } }, request.id));
  });

   app.post("/videos", { bodyLimit: config.MAX_UPLOAD_BYTES + 1024 * 1024, config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to publish a video.", request.id);
    await mkdir(MEDIA_ROOT, { recursive: true, mode: 0o700 });
    let mediaKey: string | null = null;
    let tempPath: string | null = null;
    let storedPath: string | null = null;
    let thumbnailKey: string | null = null;
    let thumbnailTempPath: string | null = null;
     let thumbnailStoredPath: string | null = null;
     let thumbnailMimeType: string | null = null;
    const uploadedCloudKeys: string[] = [];
    const useCloudStorage = config.MEDIA_STORAGE_PROVIDER !== "local";
    let mimeType = "";
    let byteSize = 0;
    let durationMs = 0;
    let mediaWidth: number | null = null;
    let mediaHeight: number | null = null;
    let caption = "";
    let privacy: "public" | "followers" | "private" = "public";
    let commentsAllowed = true;
    let allowDownloads = false;
     let prefix = Buffer.alloc(0);
     let createdVideoId: Types.ObjectId | null = null;
     let ownerCountIncremented = false;
    const checksum = createHash("sha256");
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.fieldname === "thumbnail") {
            if (thumbnailKey) throw Object.assign(new Error("Upload one cover image per video."), { statusCode: 400, code: "TOO_MANY_FILES" });
            thumbnailMimeType = part.mimetype;
            const imageExtension = thumbnailMimeType === "image/jpeg" ? ".jpg" : thumbnailMimeType === "image/png" ? ".png" : thumbnailMimeType === "image/webp" ? ".webp" : "";
            if (!imageExtension) { part.file.resume(); throw Object.assign(new Error("Choose a JPEG, PNG, or WebP cover image."), { statusCode: 415, code: "UNSUPPORTED_COVER_TYPE" }); }
            thumbnailKey = `${randomUUID()}${imageExtension}`;
            thumbnailTempPath = join(MEDIA_ROOT, `${randomUUID()}.cover-upload`);
            thumbnailStoredPath = join(MEDIA_ROOT, thumbnailKey);
            let thumbnailSize = 0;
            let imagePrefix = Buffer.alloc(0);
            const thumbnailInspector = new Transform({ transform(chunk: Buffer, _encoding, callback) {
              thumbnailSize += chunk.length;
              if (thumbnailSize > 512 * 1024) { callback(Object.assign(new Error("Cover images must be 512 KB or smaller."), { statusCode: 413, code: "COVER_TOO_LARGE" })); return; }
              if (imagePrefix.length < 4096) imagePrefix = Buffer.concat([imagePrefix, chunk.subarray(0, 4096 - imagePrefix.length)]);
              callback(null, chunk);
            } });
            await pipeline(part.file, thumbnailInspector, createWriteStream(thumbnailTempPath, { flags: "wx", mode: 0o600 }));
            if (part.file.truncated || !isSafeCoverImage(thumbnailMimeType, imagePrefix)) throw Object.assign(new Error("The cover image contents do not match its format."), { statusCode: 415, code: "INVALID_COVER_CONTENT" });
            await rename(thumbnailTempPath, thumbnailStoredPath);
            thumbnailTempPath = null;
            continue;
          }
          if (part.fieldname !== "file") { part.file.resume(); throw Object.assign(new Error("The video upload contains an unsupported file field."), { statusCode: 400, code: "UNEXPECTED_FILE_FIELD" }); }
          if (mediaKey) throw Object.assign(new Error("Upload one video per post."), { statusCode: 400, code: "TOO_MANY_FILES" });
          mimeType = part.mimetype;
          const extension = mimeType === "video/webm" ? ".webm" : mimeType === "video/quicktime" ? ".mov" : mimeType === "video/mp4" ? ".mp4" : "";
          if (!extension) { part.file.resume(); throw Object.assign(new Error("Choose an MP4, MOV, or WebM video."), { statusCode: 415, code: "UNSUPPORTED_MEDIA_TYPE" }); }
          mediaKey = randomUUID();
          tempPath = join(MEDIA_ROOT, `${mediaKey}.upload`);
          storedPath = join(MEDIA_ROOT, `${mediaKey}${extension}`);
          const inspector = new Transform({ transform(chunk: Buffer, _encoding, callback) {
            if (prefix.length < 32) prefix = Buffer.concat([prefix, chunk.subarray(0, 32 - prefix.length)]);
            byteSize += chunk.length;
            checksum.update(chunk);
            callback(null, chunk);
          } });
          await pipeline(part.file, inspector, createWriteStream(tempPath, { flags: "wx", mode: 0o600 }));
          if (part.file.truncated) throw Object.assign(new Error("The video exceeds the upload size limit."), { statusCode: 413, code: "UPLOAD_TOO_LARGE" });
          if (!isSupportedVideoContent(mimeType, prefix)) throw Object.assign(new Error("The file contents do not match the selected video format."), { statusCode: 415, code: "INVALID_MEDIA_CONTENT" });
          await rename(tempPath, storedPath);
          tempPath = null;
        } else {
          if (mediaKey) throw Object.assign(new Error("Video details must come before the file part."), { statusCode: 400, code: "INVALID_MULTIPART_ORDER" });
           const value = String(part.value ?? "");
           if (part.fieldname === "caption") caption = value.trim().slice(0, 2200);
           if (part.fieldname === "privacy") {
             if (!["public", "followers", "private"].includes(value)) throw Object.assign(new Error("Choose a valid video audience."), { statusCode: 400, code: "INVALID_PRIVACY" });
             privacy = value as typeof privacy;
           }
          if (part.fieldname === "durationMs") durationMs = Number(value);
          if (part.fieldname === "commentsAllowed") commentsAllowed = value !== "false";
          if (part.fieldname === "allowDownloads") allowDownloads = value === "true";
        }
      }
      if (!mediaKey || !storedPath) throw Object.assign(new Error("Choose a video file to publish."), { statusCode: 400, code: "VIDEO_REQUIRED" });
       let metadata: { durationMs: number; width: number | null; height: number | null };
       try {
         const inspected = await inspectVideoMetadata(config.FFPROBE_BINARY, storedPath);
         metadata = inspected;
       } catch (error) {
         const inspectionError = error as { code?: string };
         const browserDuration = Number.isSafeInteger(durationMs) && durationMs > 0 ? durationMs : null;
         if ((config.NODE_ENV !== "development" && config.NODE_ENV !== "test") || inspectionError.code !== "MEDIA_METADATA_UNAVAILABLE" || browserDuration === null) throw error;
         metadata = { durationMs: browserDuration, width: null, height: null };
       }
       durationMs = metadata.durationMs;
       mediaWidth = metadata.width;
       mediaHeight = metadata.height;
       if (durationMs > config.MAX_VIDEO_DURATION_MS) throw Object.assign(new Error("Video duration exceeds the allowed limit."), { statusCode: 400, code: "INVALID_DURATION" });
       if ((metadata.width !== null && metadata.width > config.MAX_VIDEO_WIDTH) || (metadata.height !== null && metadata.height > config.MAX_VIDEO_HEIGHT)) throw Object.assign(new Error("Video dimensions exceed the allowed limit."), { statusCode: 400, code: "INVALID_DIMENSIONS" });
      const checksumHex = checksum.digest("hex");
      const finalMediaKey = `${mediaKey}${storedPath.endsWith(".webm") ? ".webm" : storedPath.endsWith(".mov") ? ".mov" : ".mp4"}`;

      if (useCloudStorage) {
        await uploadMediaFile(finalMediaKey, storedPath, mimeType);
        uploadedCloudKeys.push(finalMediaKey);

        if (thumbnailKey && thumbnailStoredPath && thumbnailMimeType) {
          await uploadMediaFile(thumbnailKey, thumbnailStoredPath, thumbnailMimeType);
          uploadedCloudKeys.push(thumbnailKey);
        }

        // Cloud uploads have succeeded; remove redundant local copies.
        await unlink(storedPath).catch((cleanupError: unknown) =>
          request.log.warn(
            { err: cleanupError, path: storedPath },
            "Local video cleanup failed after cloud upload",
          ),
        );

        if (thumbnailStoredPath) {
          await unlink(thumbnailStoredPath).catch((cleanupError: unknown) =>
            request.log.warn(
              { err: cleanupError, path: thumbnailStoredPath },
              "Local thumbnail cleanup failed after cloud upload",
            ),
          );
        }
      }

      const video = await VideoModel.create({ creatorId: userId, caption, hashtags: toHashtags(caption), mediaKey: finalMediaKey, mimeType, mediaSizeBytes: byteSize, mediaWidth, mediaHeight, checksum: checksumHex, durationMs, thumbnailKey, thumbnailMimeType, privacy, commentsAllowed, allowDownloads, status: "published" });
      createdVideoId = video._id;
       const ownerUpdate = await UserModel.updateOne({ _id: userId, status: "active" }, { $inc: { videoCount: 1 } });
       if (ownerUpdate.matchedCount !== 1) throw Object.assign(new Error("Account is unavailable."), { statusCode: 401, code: "ACCOUNT_UNAVAILABLE" });
       ownerCountIncremented = true;
       return reply.code(201).send(envelope({ video: await present(video, userId), checksum: checksumHex }, request.id));
     } catch (error) {
       for (const key of uploadedCloudKeys) {
         await deleteMediaFile(key).catch((cleanupError: unknown) =>
           request.log.error({ err: cleanupError, key }, "Cloud media cleanup failed after upload error"),
         );
       }
       if (createdVideoId) await VideoModel.deleteOne({ _id: createdVideoId }).catch((cleanupError: unknown) => request.log.error({ err: cleanupError, videoId: createdVideoId }, "Video record cleanup failed after upload error"));
       if (ownerCountIncremented) await UserModel.updateOne({ _id: userId, videoCount: { $gt: 0 } }, { $inc: { videoCount: -1 } }).catch((cleanupError: unknown) => request.log.error({ err: cleanupError, userId }, "Video count cleanup failed after upload error"));
      if (tempPath) await unlink(tempPath).catch(() => undefined);
      if (storedPath) await unlink(storedPath).catch(() => undefined);
      if (thumbnailTempPath) await unlink(thumbnailTempPath).catch(() => undefined);
      if (thumbnailStoredPath) await unlink(thumbnailStoredPath).catch(() => undefined);
      const err = error as { statusCode?: number; code?: string; message?: string };
      const status = err.statusCode ?? (err.code === "FST_REQ_FILE_TOO_LARGE" ? 413 : 500);
      if (status >= 500) request.log.error({ err: error }, "Video upload failed");
      return fail(reply, status, err.code ?? "UPLOAD_FAILED", status >= 500 ? "Video upload could not be completed." : err.message ?? "Video upload failed.", request.id);
    }
  });

  app.get("/me/settings", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to view your settings.", request.id);
    const [user, settings] = await Promise.all([UserModel.findById(userId).select("isPrivate"), UserSettingsModel.findOneAndUpdate({ userId }, { $setOnInsert: { userId } }, { new: true, upsert: true, setDefaultsOnInsert: true })]);
    if (!user || !settings) return fail(reply, 404, "ACCOUNT_UNAVAILABLE", "Account settings are unavailable.", request.id);
    return reply.send(envelope({ profilePrivate: user.isPrivate, allowMessageRequests: settings.allowMessageRequests, notifications: settings.notifications, playback: settings.playback, reduceMotion: settings.reduceMotion }, request.id));
  });
  app.patch("/me/settings", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to update your settings.", request.id);
    const body = request.body as Record<string, unknown>;
    const profilePrivate = body && typeof body["profilePrivate"] === "boolean" ? body["profilePrivate"] : undefined;
     const settingsInput = body && typeof body === "object" ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== "profilePrivate")) : {};
     const parsed = userSettingsSchema.safeParse(settingsInput);
     if (!parsed.success && Object.keys(settingsInput).length > 0) return fail(reply, 400, "VALIDATION_ERROR", "Check the settings you changed.", request.id);
    const input = parsed.success ? parsed.data : {};
    const updates: Record<string, unknown> = {};
    if (input.allowMessageRequests !== undefined) updates["allowMessageRequests"] = input.allowMessageRequests;
    if (input.reduceMotion !== undefined) updates["reduceMotion"] = input.reduceMotion;
    for (const [key, value] of Object.entries(input.notifications ?? {})) updates[`notifications.${key}`] = value;
    for (const [key, value] of Object.entries(input.playback ?? {})) updates[`playback.${key}`] = value;
    const operations: Promise<unknown>[] = [];
    if (profilePrivate !== undefined) operations.push(UserModel.updateOne({ _id: userId }, { $set: { isPrivate: profilePrivate } }));
    if (Object.keys(input).length) operations.push(UserSettingsModel.updateOne({ userId }, { $set: updates, $setOnInsert: { userId } }, { upsert: true, runValidators: true }));
    await Promise.all(operations);
    const [user, settings] = await Promise.all([UserModel.findById(userId).select("isPrivate"), UserSettingsModel.findOneAndUpdate({ userId }, { $setOnInsert: { userId } }, { new: true, upsert: true, setDefaultsOnInsert: true })]);
    if (!user || !settings) return fail(reply, 404, "ACCOUNT_UNAVAILABLE", "Account settings are unavailable.", request.id);
    return reply.send(envelope({ profilePrivate: user.isPrivate, allowMessageRequests: settings.allowMessageRequests, notifications: settings.notifications, playback: settings.playback, reduceMotion: settings.reduceMotion }, request.id));
  });

  app.get("/me/videos", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to manage your videos.", request.id);
    const rows = await VideoModel.find({ creatorId: userId, status: "published" }).sort({ createdAt: -1, _id: -1 }).limit(100);
    return reply.send(envelope((await Promise.all(rows.map(video => present(video, userId)))).filter(Boolean), request.id));
  });

  app.get("/me/analytics", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to view creator analytics.", request.id);
    const [totals] = await VideoModel.aggregate([{ $match: { creatorId: new Types.ObjectId(userId), status: "published" } }, { $group: { _id: null, videos: { $sum: 1 }, views: { $sum: "$viewCount" }, likes: { $sum: "$likeCount" }, comments: { $sum: "$commentCount" }, shares: { $sum: "$shareCount" }, saves: { $sum: "$saveCount" } } }]);
    return reply.send(envelope({ scope: "lifetime", videos: totals?.videos ?? 0, views: totals?.views ?? 0, likes: totals?.likes ?? 0, comments: totals?.comments ?? 0, shares: totals?.shares ?? 0, saves: totals?.saves ?? 0, updatedAt: new Date().toISOString() }, request.id));
  });

  app.delete("/videos/:videoId", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to manage this video.", request.id);
    const { videoId } = request.params as { videoId: string };
    if (!publicId(videoId)) return fail(reply, 400, "INVALID_VIDEO_ID", "Video id is invalid.", request.id);
    const video = await VideoModel.findOneAndUpdate({ _id: videoId, creatorId: userId, status: "published" }, { $set: { status: "removed" } }, { new: true });
    if (!video) return fail(reply, 404, "VIDEO_UNAVAILABLE", "This video is unavailable or you cannot manage it.", request.id);
     const removeMedia = (key: string) =>
       config.MEDIA_STORAGE_PROVIDER === "local" ? unlink(mediaPath(key)) : deleteMediaFile(key);
     const cleanup: Promise<unknown>[] = [
       removeMedia(video.mediaKey),
       VideoReactionModel.deleteMany({ videoId }),
       CommentModel.deleteMany({ videoId }),
       UserModel.updateOne({ _id: userId, videoCount: { $gt: 0 } }, { $inc: { videoCount: -1 } }),
     ];
     if (video.thumbnailKey) cleanup.push(removeMedia(video.thumbnailKey));
    const outcomes = await Promise.allSettled(cleanup);
    for (const outcome of outcomes) if (outcome.status === "rejected") request.log.error({ err: outcome.reason, videoId }, "Video cleanup task failed after removal");
    return reply.send(envelope({ removed: true }, request.id));
  });

  app.get("/videos/:videoId", async (request, reply) => {
    const { videoId } = request.params as { videoId: string };
    if (!publicId(videoId)) return fail(reply, 400, "INVALID_VIDEO_ID", "Video id is invalid.", request.id);
    const viewerId = await authenticate(request);
    const video = await VideoModel.findById(videoId);
    if (!video || !(await canView(video, viewerId))) return fail(reply, 404, "VIDEO_UNAVAILABLE", "This video is unavailable.", request.id);
    return reply.send(envelope({ video: await present(video, viewerId) }, request.id));
  });

  app.get("/media/:videoId/thumbnail", async (request, reply) => {
    const { videoId } = request.params as { videoId: string };
    if (!publicId(videoId)) return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
    const viewerId = await authenticate(request, { rejectInvalidCredential: false });
    const video = await VideoModel.findById(videoId);
    if (!video || !video.thumbnailKey || !video.thumbnailMimeType || !(await canView(video, viewerId))) {
      return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
    }
    try {
      const cache = video.privacy === "public" ? "public, max-age=3600" : "private, no-store";
      if (config.MEDIA_STORAGE_PROVIDER === "local") {
        const path = mediaPath(video.thumbnailKey);
        const info = await stat(path);
        return reply.type(video.thumbnailMimeType).header("Content-Length", String(info.size))
          .header("Cache-Control", cache).header("Vary", "Cookie")
          .header("X-Content-Type-Options", "nosniff").send(createReadStream(path));
      }
      const info = await getMediaInfo(video.thumbnailKey);
      const stream = await getMediaStream(video.thumbnailKey);
      return reply.type(video.thumbnailMimeType).header("Content-Length", String(info.size))
        .header("Cache-Control", cache).header("Vary", "Cookie")
        .header("X-Content-Type-Options", "nosniff").send(stream);
    } catch {
      return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
    }
  });

  app.get("/media/:videoId", async (request, reply) => {
    const { videoId } = request.params as { videoId: string };
    if (!publicId(videoId)) return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
    const viewerId = await authenticate(request, { rejectInvalidCredential: false });
    const video = await VideoModel.findById(videoId);
    if (!video || !(await canView(video, viewerId))) return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);

    const local = config.MEDIA_STORAGE_PROVIDER === "local";
    const path = local ? mediaPath(video.mediaKey) : "";
    try {
      const info = local ? await stat(path) : await getMediaInfo(video.mediaKey);
      const range = request.headers.range;
      const cache = video.privacy === "public" ? "public, max-age=3600" : "private, no-store";

      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
        const start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2] || 0));
        let end = match[2] && match[1] ? Number(match[2]) : info.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= info.size) {
          return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
        }
        end = Math.min(end, info.size - 1);
        const stream = local ? createReadStream(path, { start, end }) : await getMediaStream(video.mediaKey, { start, end });
        return reply.code(206).type(video.mimeType).header("Accept-Ranges", "bytes")
          .header("Content-Range", `bytes ${start}-${end}/${info.size}`)
          .header("Content-Length", String(end - start + 1)).header("Cache-Control", cache)
          .header("Vary", "Cookie").header("X-Content-Type-Options", "nosniff").send(stream);
      }

      const stream = local ? createReadStream(path) : await getMediaStream(video.mediaKey);
      return reply.type(video.mimeType).header("Accept-Ranges", "bytes")
        .header("Content-Length", String(info.size)).header("Cache-Control", cache)
        .header("Vary", "Cookie").header("X-Content-Type-Options", "nosniff").send(stream);
    } catch {
      return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
    }
  });

  for (const kind of ["like", "save", "repost"] as const) {
    app.post(`/videos/:videoId/${kind}`, async (request, reply) => changeReaction(request, reply, kind, true));
    app.delete(`/videos/:videoId/${kind}`, async (request, reply) => changeReaction(request, reply, kind, false));
  }

  async function changeReaction(request: FastifyRequest, reply: { code: (status: number) => { send: (body: unknown) => unknown }; send: (body: unknown) => unknown }, kind: VideoReactionKind, active: boolean) {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to interact with videos.", request.id);
    const { videoId } = request.params as { videoId: string };
    if (!publicId(videoId)) return fail(reply, 400, "INVALID_VIDEO_ID", "Video id is invalid.", request.id);
    const video = await VideoModel.findById(videoId);
    if (!video || !(await canView(video, userId))) return fail(reply, 404, "VIDEO_UNAVAILABLE", "This video is unavailable.", request.id);
     let changed = false;
     if (active) {
       try {
         const result = await VideoReactionModel.updateOne({ userId, videoId, kind }, { $setOnInsert: { userId, videoId, kind } }, { upsert: true });
         changed = result.upsertedCount > 0;
       } catch (error) {
         if ((error as { code?: number }).code !== 11000) throw error;
       }
    } else {
      const result = await VideoReactionModel.deleteOne({ userId, videoId, kind });
      changed = result.deletedCount > 0;
     }
     const field = kind === "like" ? "likeCount" : kind === "save" ? "saveCount" : "repostCount";
     const updatedVideo = changed
       ? await VideoModel.findOneAndUpdate({ _id: videoId, ...(active ? {} : { [field]: { $gt: 0 } }) }, { $inc: { [field]: active ? 1 : -1 } }, { new: true }).select(field).lean()
       : null;
      if (changed && active && (kind === "like" || kind === "repost")) await createNotification(video.creatorId.toString(), userId, kind, video._id, undefined, undefined, request.log);
     const count = updatedVideo?.[field] as number | undefined ?? await VideoReactionModel.countDocuments({ videoId, kind });
    return reply.send(envelope({ active: await VideoReactionModel.exists({ userId, videoId, kind }).then(Boolean), count }, request.id));
  }

  app.get("/videos/:videoId/comments", async (request, reply) => {
    const { videoId } = request.params as { videoId: string };
    if (!publicId(videoId)) return fail(reply, 400, "INVALID_VIDEO_ID", "Video id is invalid.", request.id);
    const viewerId = await authenticate(request);
    const video = await VideoModel.findById(videoId);
    if (!video || !(await canView(video, viewerId))) return fail(reply, 404, "VIDEO_UNAVAILABLE", "This video is unavailable.", request.id);
    const query = request.query as { cursor?: string; limit?: string };
    const limit = clampPaginationLimit(Number(query.limit) || undefined, 1, 50, 20);
    const filter = cursorFilter(query.cursor);
    const rows = await CommentModel.find({ videoId, status: "visible", ...filter }).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const comments = await Promise.all(page.map(async (comment) => {
      const author = await UserModel.findById(comment.authorId).select("username displayName avatarUrl verified").lean();
      return author ? { id: comment._id.toString(), videoId, author: actor({ _id: author._id, username: author.username, displayName: author.displayName, avatarUrl: author.avatarUrl, verified: author.verified }), parentCommentId: comment.parentCommentId?.toString() ?? null, text: comment.text, likeCount: comment.likeCount, replyCount: comment.replyCount, likedByViewer: false, createdAt: comment.createdAt.toISOString(), updatedAt: comment.updatedAt.toISOString() } : null;
    }));
     const last = page.at(-1);
     return reply.send(envelope({ items: comments.filter(Boolean), pagination: { cursor: hasMore && last ? encodeCursor(last.createdAt, last._id) : null, hasMore, limit } }, request.id));
  });

  app.post("/videos/:videoId/comments", { config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to comment.", request.id);
    const { videoId } = request.params as { videoId: string };
    if (!publicId(videoId)) return fail(reply, 400, "INVALID_VIDEO_ID", "Video id is invalid.", request.id);
    const video = await VideoModel.findById(videoId);
    if (!video || !(await canView(video, userId))) return fail(reply, 404, "VIDEO_UNAVAILABLE", "This video is unavailable.", request.id);
    if (!video.commentsAllowed) return fail(reply, 403, "COMMENTS_DISABLED", "Comments are disabled for this video.", request.id);
    const body = request.body as { text?: unknown; parentCommentId?: unknown };
    const text = typeof body?.text === "string" ? body.text.trim() : "";
     if (!text || text.length > 2000) return fail(reply, 400, "INVALID_COMMENT", "Comments must be between 1 and 2,000 characters.", request.id);
    let parentCommentId: Types.ObjectId | null = null;
      if (body?.parentCommentId !== undefined && body.parentCommentId !== null) {
      if (typeof body.parentCommentId !== "string" || !Types.ObjectId.isValid(body.parentCommentId)) return fail(reply, 400, "INVALID_PARENT_COMMENT", "Parent comment id is invalid.", request.id);
      const parent = await CommentModel.findOne({ _id: body.parentCommentId, videoId, status: "visible" });
      if (!parent) return fail(reply, 404, "PARENT_COMMENT_UNAVAILABLE", "The comment you replied to is unavailable.", request.id);
       parentCommentId = parent._id;
     }
     const comment = await CommentModel.create({ videoId, authorId: userId, parentCommentId, text });
     try {
       if (parentCommentId) {
         const parentUpdate = await CommentModel.updateOne({ _id: parentCommentId, status: "visible" }, { $inc: { replyCount: 1 } });
         if (parentUpdate.modifiedCount !== 1) throw Object.assign(new Error("The parent comment is unavailable."), { statusCode: 404, code: "PARENT_COMMENT_UNAVAILABLE" });
       }
       const videoUpdate = await VideoModel.updateOne({ _id: videoId, status: "published" }, { $inc: { commentCount: 1 } });
       if (videoUpdate.modifiedCount !== 1) throw Object.assign(new Error("This video is unavailable."), { statusCode: 404, code: "VIDEO_UNAVAILABLE" });
     } catch (error) {
       await CommentModel.deleteOne({ _id: comment._id });
       if (parentCommentId) await CommentModel.updateOne({ _id: parentCommentId, replyCount: { $gt: 0 } }, { $inc: { replyCount: -1 } });
       throw error;
     }
     await createNotification(parentCommentId ? (await CommentModel.findById(parentCommentId).select("authorId"))?.authorId.toString() ?? video.creatorId.toString() : video.creatorId.toString(), userId, parentCommentId ? "reply" : "comment", video._id, comment._id, undefined, request.log);
    const author = await UserModel.findById(userId).select("username displayName avatarUrl verified").lean();
    return reply.code(201).send(envelope({ comment: author ? { id: comment._id.toString(), videoId, author: actor({ _id: author._id, username: author.username, displayName: author.displayName, avatarUrl: author.avatarUrl, verified: author.verified }), parentCommentId: parentCommentId?.toString() ?? null, text, likeCount: 0, replyCount: 0, likedByViewer: false, createdAt: comment.createdAt.toISOString(), updatedAt: comment.updatedAt.toISOString() } : null }, request.id));
  });

  app.delete("/comments/:commentId", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to manage comments.", request.id);
    const { commentId } = request.params as { commentId: string };
    if (!publicId(commentId)) return fail(reply, 400, "INVALID_COMMENT_ID", "Comment id is invalid.", request.id);
    const comment = await CommentModel.findById(commentId);
    if (!comment || comment.status !== "visible") return fail(reply, 404, "COMMENT_UNAVAILABLE", "Comment is unavailable.", request.id);
    const video = await VideoModel.findById(comment.videoId);
    if (comment.authorId.toString() !== userId && video?.creatorId.toString() !== userId) return fail(reply, 403, "FORBIDDEN", "You cannot remove this comment.", request.id);
    comment.status = "removed";
    await comment.save();
     await VideoModel.updateOne({ _id: comment.videoId, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } });
    if (comment.parentCommentId) await CommentModel.updateOne({ _id: comment.parentCommentId, replyCount: { $gt: 0 } }, { $inc: { replyCount: -1 } });
    return reply.send(envelope({ removed: true }, request.id));
  });

  app.post("/users/:userId/follow", async (request, reply) => updateFollow(request, reply, true));
  app.delete("/users/:userId/follow", async (request, reply) => updateFollow(request, reply, false));
  async function updateFollow(request: FastifyRequest, reply: { code: (status: number) => { send: (body: unknown) => unknown }; send: (body: unknown) => unknown }, active: boolean) {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to follow creators.", request.id);
    const { userId: creatorId } = request.params as { userId: string };
    if (!publicId(creatorId) || userId === creatorId) return fail(reply, 400, "INVALID_FOLLOW_TARGET", "Choose a valid creator to follow.", request.id);
    const creator = await UserModel.findOne({ _id: creatorId, status: "active" }).select("isPrivate followerCount").lean();
    if (!creator) return fail(reply, 404, "PROFILE_UNAVAILABLE", "This profile is unavailable.", request.id);
    if (await UserBlockModel.exists({ $or: [{ blockerId: userId, blockedId: creatorId }, { blockerId: creatorId, blockedId: userId }] })) return fail(reply, 403, "BLOCKED_RELATIONSHIP", "Following is unavailable for this account relationship.", request.id);
     let activeChanged = false;
     let requestCreated = false;
     let requested = false;
     if (active) {
       const requestedStatus = creator.isPrivate ? "requested" : "active";
       if (!creator.isPrivate) {
         const promoted = await FollowModel.findOneAndUpdate({ followerId: userId, creatorId, status: "requested" }, { $set: { status: "active" } }, { new: true }).lean();
         activeChanged = !!promoted;
       }
       if (!activeChanged) {
         try {
           const result = await FollowModel.updateOne({ followerId: userId, creatorId }, { $setOnInsert: { followerId: userId, creatorId, status: requestedStatus } }, { upsert: true });
           activeChanged = result.upsertedCount > 0 && requestedStatus === "active";
           requestCreated = result.upsertedCount > 0 && requestedStatus === "requested";
         } catch (error) {
           if ((error as { code?: number }).code !== 11000) throw error;
         }
       }
       const current = await FollowModel.findOne({ followerId: userId, creatorId }).select("status").lean();
       requested = current?.status === "requested";
     } else {
       const previous = await FollowModel.findOne({ followerId: userId, creatorId }).select("status").lean();
       const result = await FollowModel.deleteOne({ followerId: userId, creatorId });
       activeChanged = result.deletedCount > 0 && previous?.status === "active";
       requested = false;
     }
     if (activeChanged) await Promise.all([
       UserModel.updateOne({ _id: creatorId, ...(active ? {} : { followerCount: { $gt: 0 } }) }, { $inc: { followerCount: active ? 1 : -1 } }),
       UserModel.updateOne({ _id: userId, ...(active ? {} : { followingCount: { $gt: 0 } }) }, { $inc: { followingCount: active ? 1 : -1 } }),
     ]);
      if (requestCreated) await createNotification(creatorId, userId, "follow", undefined, undefined, "requested to follow you", request.log);
      if (activeChanged && active && !requested) await createNotification(creatorId, userId, "follow", undefined, undefined, undefined, request.log);
    const currentCreator = await UserModel.findById(creatorId).select("followerCount").lean();
    const follower = await UserModel.findById(userId).select("followingCount").lean();
    return reply.send(envelope({ following: active && !requested, requested, followerCount: currentCreator?.followerCount ?? 0, followingCount: follower?.followingCount ?? 0 }, request.id));
  }

  app.post("/videos/:videoId/report", { config: { rateLimit: { max: 8, timeWindow: 60_000 } } }, async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to report content.", request.id);
    const { videoId } = request.params as { videoId: string };
    if (!publicId(videoId)) return fail(reply, 400, "INVALID_VIDEO_ID", "Video id is invalid.", request.id);
     const reportedVideo = await VideoModel.findOne({ _id: videoId, status: "published" });
     if (!reportedVideo || !(await canView(reportedVideo, userId))) return fail(reply, 404, "VIDEO_UNAVAILABLE", "Video is unavailable.", request.id);
    const body = request.body as { reason?: unknown; details?: unknown };
    const reasons: readonly string[] = ["spam", "harassment", "hate", "violence", "sexual_content", "dangerous_activity", "misinformation", "copyright", "privacy", "impersonation", "other"];
    if (typeof body?.reason !== "string" || !reasons.includes(body.reason)) return fail(reply, 400, "INVALID_REPORT_REASON", "Choose a valid report reason.", request.id);
    const details = typeof body.details === "string" ? body.details.trim().slice(0, 1000) : null;
    try {
      await ContentReportModel.create({ reporterId: userId, targetId: videoId, targetType: "video", reason: body.reason as ReportReason, details });
      return reply.code(201).send(envelope({ received: true, status: "pending" }, request.id));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) return fail(reply, 409, "REPORT_ALREADY_RECEIVED", "You already reported this video.", request.id);
      throw error;
    }
  });

  app.post("/users/:userId/block", async (request, reply) => changeBlock(request, reply, true));
  app.delete("/users/:userId/block", async (request, reply) => changeBlock(request, reply, false));
  async function changeBlock(request: FastifyRequest, reply: { code: (status: number) => { send: (body: unknown) => unknown }; send: (body: unknown) => unknown }, active: boolean) {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to manage blocked accounts.", request.id);
    const { userId: targetId } = request.params as { userId: string };
    if (!publicId(targetId) || userId === targetId) return fail(reply, 400, "INVALID_BLOCK_TARGET", "Choose a valid account to block.", request.id);
    if (!(await UserModel.exists({ _id: targetId }))) return fail(reply, 404, "PROFILE_UNAVAILABLE", "This profile is unavailable.", request.id);
    if (active) {
      await UserBlockModel.updateOne({ blockerId: userId, blockedId: targetId }, { $setOnInsert: { blockerId: userId, blockedId: targetId } }, { upsert: true });
      const relations = await FollowModel.find({ status: "active", $or: [{ followerId: userId, creatorId: targetId }, { followerId: targetId, creatorId: userId }] }).lean();
       await FollowModel.deleteMany({ $or: [{ followerId: userId, creatorId: targetId }, { followerId: targetId, creatorId: userId }] });
       for (const relation of relations) await Promise.all([
         UserModel.updateOne({ _id: relation.creatorId, followerCount: { $gt: 0 } }, { $inc: { followerCount: -1 } }),
         UserModel.updateOne({ _id: relation.followerId, followingCount: { $gt: 0 } }, { $inc: { followingCount: -1 } }),
      ]);
      disconnectRealtimeUser(userId);
      disconnectRealtimeUser(targetId);
    } else await UserBlockModel.deleteOne({ blockerId: userId, blockedId: targetId });
    return reply.send(envelope({ blocked: active }, request.id));
  }

  app.post("/users/:userId/mute", async (request, reply) => changeMute(request, reply, true));
  app.delete("/users/:userId/mute", async (request, reply) => changeMute(request, reply, false));
  async function changeMute(request: FastifyRequest, reply: { code: (status: number) => { send: (body: unknown) => unknown }; send: (body: unknown) => unknown }, active: boolean) {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to manage muted accounts.", request.id);
    const { userId: targetId } = request.params as { userId: string };
    if (!publicId(targetId) || userId === targetId) return fail(reply, 400, "INVALID_MUTE_TARGET", "Choose a valid account to mute.", request.id);
    if (!(await UserModel.exists({ _id: targetId }))) return fail(reply, 404, "PROFILE_UNAVAILABLE", "This profile is unavailable.", request.id);
    if (active) await UserMuteModel.updateOne({ userId, mutedId: targetId }, { $setOnInsert: { userId, mutedId: targetId } }, { upsert: true });
    else await UserMuteModel.deleteOne({ userId, mutedId: targetId });
    return reply.send(envelope({ muted: active }, request.id));
  }

  app.get("/me/follow-requests", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to view follow requests.", request.id);
    const rows = await FollowModel.find({ creatorId: userId, status: "requested" }).sort({ createdAt: -1 }).limit(100).lean();
    const users = await UserModel.find({ _id: { $in: rows.map(row => row.followerId) }, status: "active" }).select("username displayName avatarUrl verified").lean();
    return reply.send(envelope(users.map(user => actor({ _id: user._id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, verified: user.verified })), request.id));
  });
  app.post("/me/follow-requests/:followerId/accept", async (request, reply) => resolveFollowRequest(request, reply, true));
  app.delete("/me/follow-requests/:followerId", async (request, reply) => resolveFollowRequest(request, reply, false));
  async function resolveFollowRequest(request: FastifyRequest, reply: { code: (status: number) => { send: (body: unknown) => unknown }; send: (body: unknown) => unknown }, accepted: boolean) {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to manage follow requests.", request.id);
    const { followerId } = request.params as { followerId: string };
    if (!publicId(followerId)) return fail(reply, 400, "INVALID_FOLLOWER_ID", "Follower id is invalid.", request.id);
    const relation = await FollowModel.findOne({ followerId, creatorId: userId, status: "requested" });
    if (!relation) return fail(reply, 404, "FOLLOW_REQUEST_UNAVAILABLE", "Follow request is unavailable.", request.id);
    if (accepted) {
       const promoted = await FollowModel.findOneAndUpdate({ _id: relation._id, status: "requested" }, { $set: { status: "active" } }, { new: true });
       if (!promoted) return fail(reply, 409, "FOLLOW_REQUEST_UNAVAILABLE", "Follow request has already been resolved.", request.id);
       await Promise.all([UserModel.updateOne({ _id: userId }, { $inc: { followerCount: 1 } }), UserModel.updateOne({ _id: followerId }, { $inc: { followingCount: 1 } })]);
        await createNotification(followerId, userId, "follow", undefined, undefined, "accepted your follow request", request.log);
    } else await relation.deleteOne();
    return reply.send(envelope({ accepted }, request.id));
  }

  app.get("/me/blocks", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to view blocked accounts.", request.id);
    const rows = await UserBlockModel.find({ blockerId: userId }).sort({ createdAt: -1 }).lean();
    const users = await UserModel.find({ _id: { $in: rows.map(row => row.blockedId) } }).select("username displayName avatarUrl verified").lean();
    return reply.send(envelope(users.map(user => actor({ _id: user._id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, verified: user.verified })), request.id));
  });

  app.get("/me/mutes", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to view muted accounts.", request.id);
    const rows = await UserMuteModel.find({ userId }).sort({ createdAt: -1 }).lean();
    const users = await UserModel.find({ _id: { $in: rows.map(row => row.mutedId) } }).select("username displayName avatarUrl verified").lean();
    return reply.send(envelope(users.map(user => actor({ _id: user._id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, verified: user.verified })), request.id));
  });

   app.post("/videos/:videoId/share", { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (request, reply) => {
     const viewerId = await authenticate(request, { rejectInvalidCredential: false });
     const { videoId } = request.params as { videoId: string };
     if (!publicId(videoId)) return fail(reply, 400, "INVALID_VIDEO_ID", "Video id is invalid.", request.id);
     const video = await VideoModel.findById(videoId);
     if (!video || !(await canView(video, viewerId))) return fail(reply, 404, "VIDEO_UNAVAILABLE", "This video is unavailable.", request.id);
    const updated = await VideoModel.findByIdAndUpdate(videoId, { $inc: { shareCount: 1 } }, { new: true }).select("shareCount");
    return reply.send(envelope({ shareCount: updated?.shareCount ?? video.shareCount }, request.id));
  });

  app.post("/videos/:videoId/view", async (request, reply) => {
    const { videoId } = request.params as { videoId: string };
    if (!publicId(videoId)) return fail(reply, 400, "INVALID_VIDEO_ID", "Video id is invalid.", request.id);
     const viewerId = await authenticate(request, { rejectInvalidCredential: false });
    const video = await VideoModel.findById(videoId);
    if (!video || !(await canView(video, viewerId))) return fail(reply, 404, "VIDEO_UNAVAILABLE", "This video is unavailable.", request.id);
    if (viewerId !== video.creatorId.toString()) await VideoModel.updateOne({ _id: videoId }, { $inc: { viewCount: 1 } });
    return reply.send(envelope({ counted: viewerId !== video.creatorId.toString() }, request.id));
  });
};
