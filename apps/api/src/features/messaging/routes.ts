import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { Types } from "mongoose";
import { clampPaginationLimit } from "@nerloq/shared";
import { ConversationModel } from "../../infrastructure/models/conversation.js";
import { MessageModel } from "../../infrastructure/models/message.js";
import { authenticate } from "../../infrastructure/authentication.js";
import { UserModel } from "../../infrastructure/models/user.js";
import { UserBlockModel } from "../../infrastructure/models/user-block.js";
import { FollowModel } from "../../infrastructure/models/follow.js";
import { UserSettingsModel } from "../../infrastructure/models/user-settings.js";
import { NotificationModel } from "../../infrastructure/models/notification.js";
import { emitToConversation, emitToUser } from "../../infrastructure/realtime/socket.js";
import { decodeCursor, encodeCursor } from "../../infrastructure/pagination.js";

function envelope<T>(data: T, requestId: string) { return { data, requestId, timestamp: new Date().toISOString() }; }
function fail(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, status: number, code: string, message: string, requestId: string) { return reply.code(status).send({ code, message, requestId, timestamp: new Date().toISOString() }); }
function userSummary(user: { _id: Types.ObjectId; username: string; displayName: string; avatarUrl: string | null; verified: boolean }) { return { id: user._id.toString(), username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, verified: user.verified }; }
async function peerFor(conversationId: Types.ObjectId, userId: string) { return ConversationModel.findById(conversationId).select("participantIds").lean().then(async row => { const peerId = row?.participantIds.find(id => id.toString() !== userId); return peerId ? UserModel.findById(peerId).select("username displayName avatarUrl verified status").lean() : null; }); }
async function notifyMessageRecipient(recipientId: string, actorId: string, logger: FastifyRequest["log"]): Promise<void> {
  try {
    const prefs = await UserSettingsModel.findOne({ userId: recipientId }).select("notifications.messages").lean();
    if (prefs?.notifications?.messages === false) return;
    const notification = await NotificationModel.create({ recipientId, actorId, kind: "system", message: "sent you a message", readAt: null });
    emitToUser(recipientId, "notification:new", { notificationId: notification._id.toString(), kind: "system" });
  } catch (error) {
    logger.error({ err: error, recipientId, actorId }, "Message notification side effect failed");
  }
}

export const messagingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/inbox/conversations", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to view your inbox.", request.id);
    const query = request.query as { cursor?: string; limit?: string };
    const limit = clampPaginationLimit(Number(query.limit) || undefined, 1, 50, 30);
     const filter = decodeCursor(query.cursor, "updatedAt");
    const [blockedByMe, blockingMe] = await Promise.all([UserBlockModel.find({ blockerId: userId }).distinct("blockedId"), UserBlockModel.find({ blockedId: userId }).distinct("blockerId")]);
    const hiddenIds = [...blockedByMe, ...blockingMe];
     const rows = await ConversationModel.find({ ...(hiddenIds.length ? { participantIds: { $all: [userId], $nin: hiddenIds } } : { participantIds: userId }), requestStatus: { $ne: "declined" }, ...filter }).sort({ updatedAt: -1, _id: -1 }).limit(limit + 1).lean();
    const hasMore = rows.length > limit; const page = rows.slice(0, limit);
    const userIds = [...new Set(page.flatMap(conversation => conversation.participantIds.map(id => id.toString())))];
    const lastMessageIds = page.flatMap(conversation => conversation.lastMessageId ? [conversation.lastMessageId] : []);
    const [users, lastMessages, unreadRows] = await Promise.all([
      UserModel.find({ _id: { $in: userIds }, status: "active" }).select("username displayName avatarUrl verified").lean(),
      MessageModel.find({ _id: { $in: lastMessageIds } }).lean(),
      MessageModel.aggregate([{ $match: { conversationId: { $in: page.map(row => row._id) }, senderId: { $ne: new Types.ObjectId(userId) }, readAt: null, deletedAt: null } }, { $group: { _id: "$conversationId", count: { $sum: 1 } } }]),
    ]);
    const userById = new Map(users.map(user => [user._id.toString(), user]));
    const messageById = new Map(lastMessages.map(message => [message._id.toString(), message]));
    const unreadByConversation = new Map(unreadRows.map(row => [row._id.toString(), row.count as number]));
    const items = page.map(conversation => {
      const peerId = conversation.participantIds.find(id => id.toString() !== userId)?.toString();
      const peer = peerId ? userById.get(peerId) : undefined;
      const message = conversation.lastMessageId ? messageById.get(conversation.lastMessageId.toString()) : undefined;
      const sender = message ? userById.get(message.senderId.toString()) : undefined;
      return peer ? { id: conversation._id.toString(), peer: userSummary(peer), requestStatus: conversation.requestStatus, incomingRequest: conversation.requestStatus === "pending" && conversation.requesterId?.toString() !== userId, unreadCount: unreadByConversation.get(conversation._id.toString()) ?? 0, lastMessage: message ? { id: message._id.toString(), sender: sender ? userSummary(sender) : null, text: message.deletedAt ? "Message removed" : message.text, createdAt: message.createdAt.toISOString(), readAt: message.readAt?.toISOString() ?? null } : null, updatedAt: (conversation.lastMessageAt ?? conversation.createdAt).toISOString() } : null;
    });
     const last = page.at(-1);
     return reply.send(envelope({ items: items.filter(Boolean), pagination: { cursor: hasMore && last ? encodeCursor(last.updatedAt, last._id) : null, hasMore, limit } }, request.id));
  });

  app.post("/inbox/conversations", { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to message a creator.", request.id);
    const body = request.body as { recipientId?: unknown; text?: unknown };
    if (typeof body?.recipientId !== "string" || !Types.ObjectId.isValid(body.recipientId) || typeof body.text !== "string" || !body.text.trim() || body.text.trim().length > 4000) return fail(reply, 400, "INVALID_MESSAGE", "Choose a recipient and write a message of up to 4,000 characters.", request.id);
    const recipientId = body.recipientId;
    if (recipientId === userId) return fail(reply, 400, "INVALID_RECIPIENT", "You cannot message yourself.", request.id);
    if (await UserBlockModel.exists({ $or: [{ blockerId: userId, blockedId: recipientId }, { blockerId: recipientId, blockedId: userId }] })) return fail(reply, 403, "BLOCKED_RELATIONSHIP", "Messaging is unavailable for this account relationship.", request.id);
    const recipient = await UserModel.findOne({ _id: recipientId, status: "active" }).select("username displayName isPrivate").lean();
    if (!recipient) return fail(reply, 404, "RECIPIENT_UNAVAILABLE", "This account is unavailable.", request.id);
    const pair = [new Types.ObjectId(userId), new Types.ObjectId(recipientId)];
    const pairKey = [userId, recipientId].sort().join(":");
    let conversation = await ConversationModel.findOne({ pairKey });
    if (conversation?.requestStatus === "declined") return fail(reply, 403, "REQUEST_DECLINED", "This message request was declined.", request.id);
    if (conversation?.requestStatus === "pending") return fail(reply, 409, "MESSAGE_REQUEST_PENDING", "Your message request is awaiting a response.", request.id);
    let requestStatus: "accepted" | "pending" = "accepted";
    if (!conversation) {
      const [recipientFollowsSender, settings] = await Promise.all([FollowModel.exists({ followerId: recipientId, creatorId: userId, status: "active" }), UserSettingsModel.findOne({ userId: recipientId }).select("allowMessageRequests").lean()]);
      if (!recipientFollowsSender) {
        if (settings?.allowMessageRequests === false) return fail(reply, 403, "MESSAGE_REQUESTS_DISABLED", "This account is not accepting message requests.", request.id);
        requestStatus = "pending";
      }
      try { conversation = await ConversationModel.create({ pairKey, participantIds: pair, requesterId: userId, requestStatus, lastMessageId: null, lastMessageAt: null }); }
      catch (cause) { if ((cause as { code?: number }).code !== 11000) throw cause; conversation = await ConversationModel.findOne({ pairKey }); if (!conversation) throw cause; if (conversation.requestStatus === "pending") return fail(reply, 409, "MESSAGE_REQUEST_PENDING", "Your message request is awaiting a response.", request.id); if (conversation.requestStatus === "declined") return fail(reply, 403, "REQUEST_DECLINED", "This message request was declined.", request.id); }
    }
    const message = await MessageModel.create({ conversationId: conversation._id, senderId: userId, text: body.text.trim(), replyToMessageId: null });
    conversation.lastMessageId = message._id; conversation.lastMessageAt = message.createdAt; await conversation.save();
    const sender = await UserModel.findById(userId).select("username displayName avatarUrl verified").lean();
     const messageView = sender ? { id: message._id.toString(), conversationId: conversation._id.toString(), sender: userSummary(sender), type: "text" as const, text: message.text, attachments: [], replyToMessageId: null, createdAt: message.createdAt.toISOString(), editedAt: null, deletedAt: null, readAt: null } : null;
     emitToConversation(conversation._id.toString(), "message:new", { conversationId: conversation._id.toString(), message: messageView });
     for (const participant of conversation.participantIds) emitToUser(participant.toString(), "inbox:updated", { conversationId: conversation._id.toString() });
     if (requestStatus === "pending") emitToUser(recipientId, "message:request", { conversationId: conversation._id.toString() });
     await notifyMessageRecipient(recipientId, userId, request.log);
    return reply.code(201).send(envelope({ conversationId: conversation._id.toString(), requestStatus, message: messageView }, request.id));
  });

  app.get("/inbox/conversations/:conversationId/messages", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to read messages.", request.id);
    const { conversationId } = request.params as { conversationId: string };
    if (!Types.ObjectId.isValid(conversationId)) return fail(reply, 400, "INVALID_CONVERSATION_ID", "Conversation id is invalid.", request.id);
    const conversation = await ConversationModel.findOne({ _id: conversationId, participantIds: userId });
    if (!conversation || conversation.requestStatus === "declined") return fail(reply, 404, "CONVERSATION_UNAVAILABLE", "This conversation is unavailable.", request.id);
    const peerId = conversation.participantIds.find(id => id.toString() !== userId)?.toString();
    if (!peerId || await UserBlockModel.exists({ $or: [{ blockerId: userId, blockedId: peerId }, { blockerId: peerId, blockedId: userId }] })) return fail(reply, 404, "CONVERSATION_UNAVAILABLE", "This conversation is unavailable.", request.id);
    const query = request.query as { cursor?: string; limit?: string };
    const limit = clampPaginationLimit(Number(query.limit) || undefined, 1, 50, 30);
     const filter = decodeCursor(query.cursor);
    const rows = await MessageModel.find({ conversationId, ...filter }).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
    const hasMore = rows.length > limit; const page = rows.slice(0, limit);
     const unreadMessageIds = page.filter(row => row.senderId.toString() !== userId && row.readAt === null && row.deletedAt === null).map(row => row._id);
     const readAt = new Date();
     if (unreadMessageIds.length > 0) {
       await MessageModel.updateMany({ conversationId, senderId: { $ne: userId }, readAt: null, _id: { $in: unreadMessageIds } }, { $set: { readAt } });
       for (const messageId of unreadMessageIds) emitToConversation(conversationId, "message:updated", { conversationId, messageId: messageId.toString(), readAt: readAt.toISOString() });
     }
    const senderIds = [...new Set(page.map(row => row.senderId.toString()))];
    const senders = await UserModel.find({ _id: { $in: senderIds } }).select("username displayName avatarUrl verified").lean();
    const byId = new Map(senders.map(user => [user._id.toString(), user]));
    const messages = page.reverse().map(row => { const sender = byId.get(row.senderId.toString()); return sender ? { id: row._id.toString(), conversationId, sender: userSummary(sender), type: "text", text: row.deletedAt ? null : row.text, attachments: [], replyToMessageId: row.replyToMessageId?.toString() ?? null, createdAt: row.createdAt.toISOString(), editedAt: row.editedAt?.toISOString() ?? null, deletedAt: row.deletedAt?.toISOString() ?? null, readAt: row.senderId.toString() === userId ? row.readAt?.toISOString() ?? null : new Date().toISOString() } : null; });
    const peer = await peerFor(conversation._id, userId);
     const oldest = page.at(0);
     return reply.send(envelope({ conversation: { id: conversationId, peer: peer ? userSummary(peer) : null, requestStatus: conversation.requestStatus, incomingRequest: conversation.requestStatus === "pending" && conversation.requesterId?.toString() !== userId }, items: messages.filter(Boolean), pagination: { cursor: hasMore && oldest ? encodeCursor(oldest.createdAt, oldest._id) : null, hasMore, limit } }, request.id));
  });

  app.post("/inbox/conversations/:conversationId/messages", { config: { rateLimit: { max: 40, timeWindow: 60_000 } } }, async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to send messages.", request.id);
    const { conversationId } = request.params as { conversationId: string }; const body = request.body as { text?: unknown };
    if (!Types.ObjectId.isValid(conversationId) || typeof body?.text !== "string" || !body.text.trim() || body.text.trim().length > 4000) return fail(reply, 400, "INVALID_MESSAGE", "Write a message of up to 4,000 characters.", request.id);
    const conversation = await ConversationModel.findOne({ _id: conversationId, participantIds: userId, requestStatus: "accepted" });
    if (!conversation) return fail(reply, 403, "CONVERSATION_NOT_ACCEPTED", "Accept this message request before replying.", request.id);
    const peerId = conversation.participantIds.find(id => id.toString() !== userId)?.toString();
    if (!peerId || await UserBlockModel.exists({ $or: [{ blockerId: userId, blockedId: peerId }, { blockerId: peerId, blockedId: userId }] })) return fail(reply, 403, "BLOCKED_RELATIONSHIP", "Messaging is unavailable for this account relationship.", request.id);
    const message = await MessageModel.create({ conversationId, senderId: userId, text: body.text.trim(), replyToMessageId: null });
    conversation.lastMessageId = message._id; conversation.lastMessageAt = message.createdAt; await conversation.save();
    const sender = await UserModel.findById(userId).select("username displayName avatarUrl verified").lean();
     const messageView = sender ? { id: message._id.toString(), conversationId, sender: userSummary(sender), type: "text" as const, text: message.text, attachments: [], replyToMessageId: null, createdAt: message.createdAt.toISOString(), editedAt: null, deletedAt: null, readAt: null } : null;
     emitToConversation(conversationId, "message:new", { conversationId, message: messageView });
     for (const participant of conversation.participantIds) emitToUser(participant.toString(), "inbox:updated", { conversationId });
     await notifyMessageRecipient(peerId, userId, request.log);
    return reply.code(201).send(envelope({ message: messageView }, request.id));
  });

  app.delete("/inbox/messages/:messageId", async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to remove messages.", request.id);
    const { messageId } = request.params as { messageId: string };
    if (!Types.ObjectId.isValid(messageId)) return fail(reply, 400, "INVALID_MESSAGE_ID", "Message id is invalid.", request.id);
    const message = await MessageModel.findById(messageId);
    if (!message || message.senderId.toString() !== userId || message.deletedAt) return fail(reply, 404, "MESSAGE_UNAVAILABLE", "This message is unavailable or cannot be removed.", request.id);
    const conversation = await ConversationModel.findOne({ _id: message.conversationId, participantIds: userId });
    if (!conversation) return fail(reply, 404, "CONVERSATION_UNAVAILABLE", "This conversation is unavailable.", request.id);
    message.text = "Message removed";
    message.deletedAt = new Date();
    await message.save();
    emitToConversation(message.conversationId.toString(), "message:updated", { conversationId: message.conversationId.toString(), messageId: message._id.toString(), deletedAt: message.deletedAt.toISOString() });
    return reply.send(envelope({ removed: true }, request.id));
  });

  app.post("/inbox/conversations/:conversationId/accept", async (request, reply) => {
    const userId = await authenticate(request); if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to accept message requests.", request.id);
    const { conversationId } = request.params as { conversationId: string }; if (!Types.ObjectId.isValid(conversationId)) return fail(reply, 400, "INVALID_CONVERSATION_ID", "Conversation id is invalid.", request.id);
    const candidate = await ConversationModel.findOne({ _id: conversationId, participantIds: userId, requestStatus: "pending", requesterId: { $ne: userId } });
    if (!candidate) return fail(reply, 404, "REQUEST_UNAVAILABLE", "This message request is unavailable.", request.id);
    const peerId = candidate.participantIds.find(id => id.toString() !== userId)?.toString();
    if (!peerId || await UserBlockModel.exists({ $or: [{ blockerId: userId, blockedId: peerId }, { blockerId: peerId, blockedId: userId }] })) return fail(reply, 404, "REQUEST_UNAVAILABLE", "This message request is unavailable.", request.id);
     candidate.requestStatus = "accepted"; await candidate.save();
     emitToConversation(conversationId, "conversation:accepted", { conversationId });
     for (const participant of candidate.participantIds) {
       emitToUser(participant.toString(), "conversation:accepted", { conversationId });
       emitToUser(participant.toString(), "inbox:updated", { conversationId });
     }
    return reply.send(envelope({ accepted: true }, request.id));
  });

  app.delete("/inbox/conversations/:conversationId/request", async (request, reply) => {
    const userId = await authenticate(request); if (!userId) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "Sign in to manage message requests.", request.id);
    const { conversationId } = request.params as { conversationId: string }; if (!Types.ObjectId.isValid(conversationId)) return fail(reply, 400, "INVALID_CONVERSATION_ID", "Conversation id is invalid.", request.id);
    const conversation = await ConversationModel.findOneAndUpdate({ _id: conversationId, participantIds: userId, requestStatus: "pending", requesterId: { $ne: userId } }, { $set: { requestStatus: "declined" } }, { new: true });
    if (!conversation) return fail(reply, 404, "REQUEST_UNAVAILABLE", "This message request is unavailable.", request.id);
     emitToConversation(conversationId, "conversation:declined", { conversationId });
     for (const participant of conversation.participantIds) {
       emitToUser(participant.toString(), "conversation:declined", { conversationId });
       emitToUser(participant.toString(), "inbox:updated", { conversationId });
     }
    return reply.send(envelope({ declined: true }, request.id));
  });
};
