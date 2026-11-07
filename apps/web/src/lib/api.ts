import type { ApiSuccess, ContentReportReason, User } from "@nerloq/shared";

const API_BASE = (import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1").replace(/\/$/, "");

/** API media paths can be returned by the server as relative URLs. Keep them
 * anchored to the API origin when the web client is deployed separately. */
export function resolveMediaUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (/^(?:https?:|blob:|data:)/i.test(value)) return value;
  if (typeof window === "undefined") return value;
  try {
    const apiUrl = API_BASE.startsWith("/") ? new URL(API_BASE, window.location.origin) : new URL(API_BASE);
    return new URL(value, value.startsWith("/") ? apiUrl.origin : apiUrl).toString();
  } catch {
    return value;
  }
}

export class ApiClientError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface SettingsView {
  readonly profilePrivate: boolean;
  readonly allowMessageRequests: boolean;
  readonly notifications: { readonly likes: boolean; readonly comments: boolean; readonly follows: boolean; readonly messages: boolean; readonly system: boolean };
  readonly playback: { readonly autoplay: boolean; readonly muteByDefault: boolean; readonly captions: boolean };
  readonly reduceMotion: boolean;
}

export interface SettingsPatch {
  readonly profilePrivate?: boolean;
  readonly allowMessageRequests?: boolean;
  readonly notifications?: Partial<SettingsView["notifications"]>;
  readonly playback?: Partial<SettingsView["playback"]>;
  readonly reduceMotion?: boolean;
}

export interface NotificationItem {
  readonly id: string; readonly kind: "like" | "comment" | "reply" | "follow" | "mention" | "repost" | "system";
  readonly message: string; readonly actor: import("@nerloq/shared").UserSummary | null; readonly videoId: string | null; readonly commentId: string | null; readonly readAt: string | null; readonly createdAt: string;
}
export interface NotificationPage { readonly items: readonly NotificationItem[]; readonly unreadCount: number; readonly pagination: { readonly cursor: string | null; readonly hasMore: boolean; readonly limit: number } }

export interface ConversationSummary {
  readonly id: string; readonly peer: import("@nerloq/shared").UserSummary; readonly requestStatus: "pending" | "accepted" | "declined";
  readonly incomingRequest: boolean; readonly unreadCount: number; readonly updatedAt: string;
  readonly lastMessage: { readonly id: string; readonly sender: import("@nerloq/shared").UserSummary | null; readonly text: string; readonly createdAt: string; readonly readAt: string | null } | null;
}
export interface MessagePage {
  readonly conversation: { readonly id: string; readonly peer: import("@nerloq/shared").UserSummary | null; readonly requestStatus: "pending" | "accepted" | "declined"; readonly incomingRequest: boolean };
  readonly items: readonly import("@nerloq/shared").Message[];
  readonly pagination: { readonly cursor: string | null; readonly hasMore: boolean; readonly limit: number };
}
export interface SessionView {
  readonly user: User;
  readonly expiresAt?: string;
}

let refreshInFlight: Promise<void> | null = null;

function apiPath(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

function canRefresh(path: string): boolean {
  return ![
    "/auth/login",
    "/auth/register",
    "/auth/refresh",
    "/auth/logout",
    "/auth/password/forgot",
    "/auth/password/reset",
  ].some(prefix => path.startsWith(prefix));
}

function errorMessage(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "Request failed.";

  const value = payload as {
    message?: unknown;
    error?: { message?: unknown };
    details?: unknown;
  };

  const message =
    typeof value.message === "string" && value.message.trim()
      ? value.message
      : typeof value.error?.message === "string" && value.error.message.trim()
        ? value.error.message
        : "Request failed.";

  if (Array.isArray(value.details)) {
    const details = value.details
      .map((item: unknown) => {
        if (typeof item !== "object" || item === null) return "";
        const detail = item as { path?: unknown; message?: unknown };
        if (typeof detail.message !== "string" || !detail.message.trim()) return "";
        const path = Array.isArray(detail.path)
          ? detail.path.filter((part): part is string => typeof part === "string").join(".")
          : "";
        return path ? `${path}: ${detail.message}` : detail.message;
      })
      .filter(Boolean);

    if (details.length) return `${message} ${details.join(" ")}`;
  }

  return message;
}

function dispatchSessionExpired(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("nerloq:session-expired"));
}

async function refreshSession(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = request<SessionView>("/auth/refresh", { method: "POST" }, false)
      .then(() => undefined)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiPath(path), {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body !== undefined && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiClientError(0, "The network is unavailable. Check your connection and try again.");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Empty responses are valid for some DELETE endpoints.
  }

  if (!response.ok) {
    if (response.status === 401 && allowRefresh && canRefresh(path)) {
      try {
        await refreshSession();
        return request<T>(path, init, false);
      } catch {
        dispatchSessionExpired();
      }
    }
    throw new ApiClientError(response.status, errorMessage(payload));
  }

  if (typeof payload === "object" && payload !== null && "data" in payload) {
    return (payload as ApiSuccess<T>).data;
  }
  return payload as T;
}

function upload<T>(path: string, body: FormData, onProgress?: (value: number) => void, allowRefresh = true): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiPath(path));
    xhr.withCredentials = true;
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(Math.min(100, Math.round(event.loaded / event.total * 100)));
    };
    xhr.onerror = () => reject(new ApiClientError(0, "The network is unavailable. Check your connection and try again."));
    xhr.onload = () => {
      let payload: unknown = null;
      try { payload = xhr.responseText ? JSON.parse(xhr.responseText) as unknown : null; } catch { payload = null; }
      if (xhr.status === 401 && allowRefresh && canRefresh(path)) {
        void refreshSession().then(() => upload<T>(path, body, onProgress, false)).then(resolve).catch(() => { dispatchSessionExpired(); reject(new ApiClientError(401, errorMessage(payload))); });
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) { reject(new ApiClientError(xhr.status, errorMessage(payload))); return; }
      resolve(typeof payload === "object" && payload !== null && "data" in payload ? (payload as ApiSuccess<T>).data : payload as T);
    };
    xhr.send(body);
  });
}

export const api = {
  requestPasswordReset: (email: string) => request<{ accepted: boolean; message: string }>("/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) => request<{ reset: boolean }>("/auth/password/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
  register: (input: { email: string; username: string; displayName: string; password: string }) =>
    request<SessionView>("/auth/register", { method: "POST", body: JSON.stringify(input) }),
  login: (input: { identifier: string; password: string }) =>
    request<SessionView>("/auth/login", { method: "POST", body: JSON.stringify(input) }),
  me: () => request<{ user: User }>("/auth/me"),
  refresh: () => request<SessionView>("/auth/refresh", { method: "POST" }),
  logout: () => request<{ signedOut: boolean }>("/auth/logout", { method: "POST" }),
  feed: (type: "for_you" | "following", cursor?: string) => request<import("@nerloq/shared").FeedResponse>(`/feed?type=${type}&limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  video: (videoId: string) => request<{ video: import("@nerloq/shared").Video }>(`/videos/${encodeURIComponent(videoId)}`),
  myVideos: () => request<readonly import("@nerloq/shared").Video[]>("/me/videos"),
  creatorAnalytics: () => request<{ scope: "lifetime"; videos: number; views: number; likes: number; comments: number; shares: number; saves: number; updatedAt: string }>("/me/analytics"),
  settings: () => request<SettingsView>("/me/settings"),
  updateSettings: (input: SettingsPatch) => request<SettingsView>("/me/settings", { method: "PATCH", body: JSON.stringify(input) }),
  blockedAccounts: () => request<readonly import("@nerloq/shared").UserSummary[]>("/me/blocks"),
  mutedAccounts: () => request<readonly import("@nerloq/shared").UserSummary[]>("/me/mutes"),
  block: (userId: string, active: boolean) => request<{ blocked: boolean }>(`/users/${encodeURIComponent(userId)}/block`, { method: active ? "POST" : "DELETE" }),
  deleteVideo: (videoId: string) => request<{ removed: boolean }>(`/videos/${encodeURIComponent(videoId)}`, { method: "DELETE" }),
  profile: (username: string) => request<{ profile: import("@nerloq/shared").Profile; videos: readonly import("@nerloq/shared").Video[] }>(`/profiles/${encodeURIComponent(username)}`),
  search: (query: string, type: "all"|"creators"|"videos"|"hashtags" = "all") => request<import("@nerloq/shared").SearchResult>(`/search?q=${encodeURIComponent(query)}&type=${type}`),
  hashtagFeed: (tag: string) => request<{ tag: string; items: readonly import("@nerloq/shared").Video[] }>(`/hashtags/${encodeURIComponent(tag)}/feed`),
  publishVideo: (form: FormData, onProgress?: (value: number) => void) => upload<{ video: import("@nerloq/shared").Video; checksum: string }>("/videos", form, onProgress),
  videoAction: (videoId: string, action: "like" | "save" | "repost", active: boolean) => request<{ active: boolean; count: number }>(`/videos/${encodeURIComponent(videoId)}/${action}`, { method: active ? "POST" : "DELETE" }),
  recordView: (videoId: string) => request<{ counted: boolean }>(`/videos/${encodeURIComponent(videoId)}/view`, { method: "POST" }),
  shareVideo: (videoId: string) => request<{ shareCount: number }>(`/videos/${encodeURIComponent(videoId)}/share`, { method: "POST" }),
  comments: (videoId: string, cursor?: string) => request<import("@nerloq/shared").PaginatedResult<import("@nerloq/shared").Comment>>(`/videos/${encodeURIComponent(videoId)}/comments?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  addComment: (videoId: string, text: string, parentCommentId?: string) => request<{ comment: import("@nerloq/shared").Comment }>(`/videos/${encodeURIComponent(videoId)}/comments`, { method: "POST", body: JSON.stringify({ text, parentCommentId }) }),
  removeComment: (commentId: string) => request<{ removed: boolean }>(`/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" }),
  follow: (userId: string, active: boolean) => request<{ following: boolean; requested: boolean; followerCount: number; followingCount: number }>(`/users/${encodeURIComponent(userId)}/follow`, { method: active ? "POST" : "DELETE" }),
  mute: (userId: string, active = true) => request<{ muted: boolean }>(`/users/${encodeURIComponent(userId)}/mute`, { method: active ? "POST" : "DELETE" }),
  conversations: (cursor?: string) => request<{ items: readonly ConversationSummary[]; pagination: { readonly cursor: string | null; readonly hasMore: boolean; readonly limit: number } }>(`/inbox/conversations?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  startConversation: (recipientId: string, text: string) => request<{ conversationId: string; requestStatus: "pending" | "accepted"; message: import("@nerloq/shared").Message }>("/inbox/conversations", { method: "POST", body: JSON.stringify({ recipientId, text }) }),
  messages: (conversationId: string, cursor?: string) => request<MessagePage>(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  deleteMessage: (messageId: string) => request<{ removed: boolean }>(`/inbox/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" }),
  sendMessage: (conversationId: string, text: string) => request<{ message: import("@nerloq/shared").Message }>(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
  acceptMessageRequest: (conversationId: string) => request<{ accepted: boolean }>(`/inbox/conversations/${encodeURIComponent(conversationId)}/accept`, { method: "POST" }),
  declineMessageRequest: (conversationId: string) => request<{ declined: boolean }>(`/inbox/conversations/${encodeURIComponent(conversationId)}/request`, { method: "DELETE" }),
  notifications: (cursor?: string) => request<NotificationPage>(`/notifications?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  markNotificationsRead: (ids?: readonly string[]) => request<{ updated: number }>("/notifications/read", { method: "POST", body: JSON.stringify(ids ? { ids } : {}) }),
  followRequests: () => request<readonly import("@nerloq/shared").UserSummary[]>("/me/follow-requests"),
  resolveFollowRequest: (followerId: string, accept: boolean) => request<{ accepted: boolean }>(`/me/follow-requests/${encodeURIComponent(followerId)}${accept?"/accept":""}`, { method: accept ? "POST" : "DELETE" }),
  reportVideo: (videoId: string, reason: ContentReportReason, details: string) => request<{ received: boolean; status: string }>(`/videos/${encodeURIComponent(videoId)}/report`, { method: "POST", body: JSON.stringify({ reason, details }) }),
  updateProfile: (input: { username?: string; displayName?: string; bio?: string; websiteUrl?: string | null; isPrivate?: boolean }) =>
    request<{ user: User }>("/auth/me", { method: "PATCH", body: JSON.stringify(input) }),
};
