import type { FastifyInstance } from "fastify";
import { Server, type Socket } from "socket.io";
import { corsOrigins } from "@nerloq/config";
import { ACCESS_COOKIE } from "../../features/auth/cookies.js";
import { ConversationModel } from "../models/conversation.js";
import { SessionModel } from "../models/session.js";
import { UserBlockModel } from "../models/user-block.js";
import { UserModel } from "../models/user.js";

type SocketIdentity = { userId: string; sessionId: string };
type RealtimeSocket = Socket & { data: Socket["data"] & SocketIdentity & { connectedAt: number; lastTypingAt: number; conversationRooms: string[]; validationTimer: NodeJS.Timeout | null } };
let realtime: Server | null = null;
const activeCounts = new Map<string, number>();
const SESSION_REVALIDATION_INTERVAL_MS = 30_000;

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
  }
  return null;
}
function conversationRoom(id: string): string { return `conversation:${id}`; }
function userRoom(id: string): string { return `user:${id}`; }

export function emitToUser(userId: string, event: string, payload: unknown): void {
  realtime?.to(userRoom(userId)).emit(event, payload);
}
export function emitToConversation(conversationId: string, event: string, payload: unknown): void {
  realtime?.to(conversationRoom(conversationId)).emit(event, payload);
}
export function disconnectRealtimeSession(sessionId: string): void {
  realtime?.in(`session:${sessionId}`).disconnectSockets(true);
}
export function disconnectRealtimeUser(userId: string): void {
  realtime?.in(userRoom(userId)).disconnectSockets(true);
}
export function emitToConversationParticipants(conversationId: string, event: string, payload: unknown): void {
  realtime?.to(conversationRoom(conversationId)).emit(event, payload);
}

async function loadAcceptedRooms(userId: string): Promise<{ room: string; peerId: string }[]> {
  const conversations = await ConversationModel.find({ participantIds: userId, requestStatus: "accepted" }).select("_id participantIds").sort({ updatedAt: -1 }).limit(100).lean();
  if (!conversations.length) return [];
  const [blockedByMe, blockingMe] = await Promise.all([UserBlockModel.find({ blockerId: userId }).distinct("blockedId"), UserBlockModel.find({ blockedId: userId }).distinct("blockerId")]);
  const blocked = new Set([...blockedByMe, ...blockingMe].map(id => id.toString()));
  return conversations.flatMap(row => {
    const peerId = row.participantIds.find(id => id.toString() !== userId)?.toString();
    return peerId && !blocked.has(peerId) ? [{ room: conversationRoom(row._id.toString()), peerId }] : [];
  });
}

async function hasActiveSession(userId: string, sessionId: string): Promise<boolean> {
  const [session, user] = await Promise.all([
    SessionModel.exists({ _id: sessionId, userId, expiresAt: { $gt: new Date() } }),
    UserModel.exists({ _id: userId, status: "active" }),
  ]);
  return Boolean(session && user);
}

export async function attachRealtime(app: FastifyInstance): Promise<void> {
  if (realtime) throw new Error("Realtime server is already attached.");
  const io = new Server(app.server, {
    path: "/socket.io",
    cors: { origin: [...corsOrigins], credentials: true, methods: ["GET", "POST"] },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, typeof origin !== "string" || origin.length === 0 || corsOrigins.includes(origin));
    },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    connectTimeout: 10_000,
  });
  realtime = io;

  io.use(async (socket, next) => {
    try {
      const token = cookieValue(socket.handshake.headers.cookie, ACCESS_COOKIE);
      if (!token) return next(new Error("AUTHENTICATION_REQUIRED"));
      const claims = await app.jwt.verify<{ sub: string; sid: string }>(token);
      if (!claims.sub || !claims.sid) return next(new Error("AUTHENTICATION_REQUIRED"));
       if (!(await hasActiveSession(claims.sub, claims.sid))) return next(new Error("SESSION_EXPIRED"));
      socket.data.userId = claims.sub;
      socket.data.sessionId = claims.sid;
      next();
    } catch { next(new Error("SESSION_EXPIRED")); }
  });

  io.on("connection", async rawSocket => {
    const socket = rawSocket as RealtimeSocket;
    const userId = socket.data.userId;
    const sessionId = socket.data.sessionId;
    socket.data.connectedAt = Date.now();
    socket.data.lastTypingAt = 0;
    socket.data.validationTimer = null;
    let acceptedRooms: { room: string; peerId: string }[];
    try {
      acceptedRooms = await loadAcceptedRooms(userId);
    } catch (error) {
      app.log.error({ err: error, userId }, "Realtime conversation rooms could not be loaded");
      socket.disconnect(true);
      return;
    }
    const conversationRooms = acceptedRooms.map(item => item.room);
    socket.data.conversationRooms = conversationRooms;
    await socket.join([userRoom(userId), `session:${sessionId}`, ...conversationRooms]);
    const previousCount = activeCounts.get(userId) ?? 0;
    activeCounts.set(userId, previousCount + 1);
    if (previousCount === 0) {
      socket.to(userRoom(userId)).emit("presence:update", { userId, online: true });
      for (const room of conversationRooms) socket.to(room).emit("presence:update", { userId, online: true });
    }
    for (const item of acceptedRooms) if ((activeCounts.get(item.peerId) ?? 0) > 0) socket.emit("presence:update", { userId: item.peerId, online: true });
    socket.emit("realtime:ready", { userId, connectedAt: socket.data.connectedAt });

    socket.data.validationTimer = setInterval(() => {
      void hasActiveSession(userId, sessionId).then(active => {
        if (!active) socket.disconnect(true);
      }).catch(() => socket.disconnect(true));
    }, SESSION_REVALIDATION_INTERVAL_MS);
    socket.data.validationTimer.unref?.();

    socket.on("conversation:join", async (input: { conversationId?: unknown }, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
      if (typeof input?.conversationId !== "string" || !/^[a-f\d]{24}$/i.test(input.conversationId)) { acknowledge?.({ ok: false, error: "INVALID_CONVERSATION" }); return; }
      const conversation = await ConversationModel.findOne({ _id: input.conversationId, participantIds: userId, requestStatus: { $in: ["pending", "accepted"] } }).select("participantIds").lean();
      if (!conversation) { acknowledge?.({ ok: false, error: "CONVERSATION_UNAVAILABLE" }); return; }
      const peerId = conversation.participantIds.find(id => id.toString() !== userId)?.toString();
      if (!peerId || await UserBlockModel.exists({ $or: [{ blockerId: userId, blockedId: peerId }, { blockerId: peerId, blockedId: userId }] })) { acknowledge?.({ ok: false, error: "CONVERSATION_UNAVAILABLE" }); return; }
      await socket.join(conversationRoom(input.conversationId));
      if (activeCounts.get(peerId) && conversation.requestStatus === "accepted") socket.emit("presence:update", { userId: peerId, online: true });
      acknowledge?.({ ok: true });
    });

    socket.on("conversation:leave", (input: { conversationId?: unknown }) => {
      if (typeof input?.conversationId === "string" && /^[a-f\d]{24}$/i.test(input.conversationId)) void socket.leave(conversationRoom(input.conversationId));
    });

    socket.on("typing:update", async (input: { conversationId?: unknown; typing?: unknown }) => {
      if (typeof input?.conversationId !== "string" || !/^[a-f\d]{24}$/i.test(input.conversationId) || typeof input.typing !== "boolean") return;
      if (!socket.rooms.has(conversationRoom(input.conversationId))) return;
      const now = Date.now();
      if (input.typing && now - socket.data.lastTypingAt < 700) return;
      socket.data.lastTypingAt = now;
      const conversation = await ConversationModel.findOne({ _id: input.conversationId, participantIds: userId, requestStatus: "accepted" }).select("participantIds").lean();
      if (!conversation) return;
      const peerId = conversation.participantIds.find(id => id.toString() !== userId)?.toString();
      if (!peerId || await UserBlockModel.exists({ $or: [{ blockerId: userId, blockedId: peerId }, { blockerId: peerId, blockedId: userId }] })) return;
      socket.to(conversationRoom(input.conversationId)).emit("typing:update", { conversationId: input.conversationId, userId, typing: input.typing });
    });

    socket.on("disconnect", () => {
      if (socket.data.validationTimer) {
        clearInterval(socket.data.validationTimer);
        socket.data.validationTimer = null;
      }
      const count = activeCounts.get(userId) ?? 1;
      if (count <= 1) {
        activeCounts.delete(userId);
        io.to(userRoom(userId)).emit("presence:update", { userId, online: false });
        for (const room of socket.data.conversationRooms) io.to(room).emit("presence:update", { userId, online: false });
      } else activeCounts.set(userId, count - 1);
    });
  });

  app.addHook("onClose", async () => {
    await new Promise<void>(resolve => io.close(() => resolve()));
    if (realtime === io) realtime = null;
    activeCounts.clear();
  });
}
