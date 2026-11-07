import type { FastifyPluginAsync } from "fastify";
import { Types } from "mongoose";
import { clampPaginationLimit } from "@nerloq/shared";
import { authenticate } from "../../infrastructure/authentication.js";
import { UserModel } from "../../infrastructure/models/user.js";
import { NotificationModel } from "../../infrastructure/models/notification.js";
import { decodeCursor, encodeCursor } from "../../infrastructure/pagination.js";

function envelope<T>(data: T, requestId: string) { return { data, requestId, timestamp: new Date().toISOString() }; }
function fail(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, status: number, code: string, message: string, requestId: string) { return reply.code(status).send({ code, message, requestId, timestamp: new Date().toISOString() }); }

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/notifications", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to view notifications.", request.id);
     const query = request.query as { cursor?: string; limit?: string; unreadOnly?: string };
     const limit = clampPaginationLimit(Number(query.limit) || undefined, 1, 50, 20);
     const filter = decodeCursor(query.cursor);
     if (query.unreadOnly && query.unreadOnly !== "true" && query.unreadOnly !== "false") return fail(reply, 400, "INVALID_UNREAD_FILTER", "The unread filter is invalid.", request.id);
     const rows = await NotificationModel.find({ recipientId: userId, ...(query.unreadOnly === "true" ? { readAt: null } : {}), ...filter }).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const actorIds = page.flatMap(row => row.actorId ? [row.actorId] : []);
    const actors = await UserModel.find({ _id: { $in: actorIds }, status: "active" }).select("username displayName avatarUrl verified").lean();
    const byId = new Map(actors.map(user => [user._id.toString(), user]));
    const items = page.map(row => {
      const actor = row.actorId ? byId.get(row.actorId.toString()) : undefined;
      return { id: row._id.toString(), kind: row.kind, message: row.message, actor: actor ? { id: actor._id.toString(), username: actor.username, displayName: actor.displayName, avatarUrl: actor.avatarUrl, verified: actor.verified } : null, videoId: row.videoId?.toString() ?? null, commentId: row.commentId?.toString() ?? null, readAt: row.readAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
    });
    const unreadCount = await NotificationModel.countDocuments({ recipientId: userId, readAt: null });
     const last = page.at(-1);
     return reply.send(envelope({ items, unreadCount, pagination: { cursor: hasMore && last ? encodeCursor(last.createdAt, last._id) : null, hasMore, limit } }, request.id));
  });

  app.post("/notifications/read", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to update notifications.", request.id);
    const body = request.body as { ids?: unknown };
    if (body?.ids !== undefined && (!Array.isArray(body.ids) || body.ids.length > 100 || body.ids.some(id => typeof id !== "string" || !Types.ObjectId.isValid(id)))) return fail(reply, 400, "INVALID_NOTIFICATION_IDS", "Choose up to 100 valid notifications.", request.id);
    const filter = Array.isArray(body?.ids) ? { _id: { $in: body.ids } } : {};
    const result = await NotificationModel.updateMany({ recipientId: userId, readAt: null, ...filter }, { $set: { readAt: new Date() } });
    return reply.send(envelope({ updated: result.modifiedCount }, request.id));
  });
};
