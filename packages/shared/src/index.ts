export const NERLOQ_VERSION = "1.0.0" as const;

export type ID = string;
export type ISODateString = string;
export type URLString = string;
export type Username = string;
export type Hashtag = string;
export type MimeType = string;

export type UserRole =
  | "user"
  | "creator"
  | "business"
  | "moderator"
  | "administrator";

export type AccountStatus =
  | "active"
  | "suspended"
  | "deactivated"
  | "deleted"
  | "pending_verification";

export type Visibility = "public" | "followers" | "private";

export type FollowStatus =
  | "none"
  | "following"
  | "requested"
  | "blocked"
  | "blocked_by";

export type MediaProcessingStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "rejected";

export type VideoPrivacy = "public" | "followers" | "private";

export type VideoStatus =
  | "draft"
  | "uploading"
  | "processing"
  | "published"
  | "archived"
  | "removed";

export type VideoInteractionType =
  | "like"
  | "comment"
  | "reply"
  | "repost"
  | "save"
  | "share"
  | "view"
  | "complete_view";

export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "sticker"
  | "system";

export type ConversationType = "direct" | "group";

export type NotificationType =
  | "follow"
  | "follow_request"
  | "follow_accepted"
  | "like"
  | "comment"
  | "reply"
  | "repost"
  | "mention"
  | "message"
  | "story"
  | "duet"
  | "stitch"
  | "video_reply"
  | "system"
  | "commerce";

export type StoryStatus = "active" | "expired" | "removed";

export type ContentReportReason =
  | "spam"
  | "harassment"
  | "hate"
  | "violence"
  | "sexual_content"
  | "dangerous_activity"
  | "misinformation"
  | "copyright"
  | "privacy"
  | "impersonation"
  | "other";

export type ReportStatus =
  | "pending"
  | "reviewing"
  | "resolved"
  | "dismissed";

export type ProductLinkType =
  | "product"
  | "collection"
  | "store"
  | "external";

export interface UserSummary {
  readonly id: ID;
  readonly username: Username;
  readonly displayName: string;
  readonly avatarUrl: URLString | null;
  readonly verified: boolean;
}

export interface User extends UserSummary {
  readonly email: string;
  readonly isPrivate: boolean;
  readonly role: UserRole;
  readonly status: AccountStatus;
  readonly bio: string;
  readonly websiteUrl: URLString | null;
  readonly followerCount: number;
  readonly followingCount: number;
  readonly videoCount: number;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export interface Profile extends UserSummary {
  readonly bio: string;
  readonly websiteUrl: URLString | null;
  readonly followerCount: number;
  readonly followingCount: number;
  readonly videoCount: number;
  readonly followStatus: FollowStatus;
  readonly isOwnProfile: boolean;
  readonly isPrivate: boolean;
}

export interface MediaAsset {
  readonly id: ID;
  readonly url: URLString;
  readonly mimeType: MimeType;
  readonly byteSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
  readonly status: MediaProcessingStatus;
  readonly checksum: string;
  readonly createdAt: ISODateString;
}

export interface VideoSource {
  readonly id: ID;
  readonly mediaAssetId: ID;
  readonly url: URLString;
  readonly mimeType: MimeType;
  readonly width: number;
  readonly height: number;
  readonly bitrate: number;
  readonly frameRate: number;
  readonly durationMs: number;
  readonly sizeBytes: number;
}

export interface VideoManifest {
  readonly id: ID;
  readonly masterUrl: URLString;
  readonly variants: readonly VideoSource[];
  readonly durationMs: number;
  readonly segmentDurationMs: number;
}

export interface Sound {
  readonly id: ID;
  readonly title: string;
  readonly artistName: string;
  readonly coverUrl: URLString | null;
  readonly audioUrl: URLString;
  readonly durationMs: number;
  readonly usageCount: number;
  readonly originalCreatorId: ID | null;
}

export interface Mention {
  readonly userId: ID;
  readonly username: Username;
  readonly startIndex: number;
  readonly endIndex: number;
}

export interface HashtagEntity {
  readonly tag: Hashtag;
  readonly startIndex: number;
  readonly endIndex: number;
}

export interface ProductLink {
  readonly id: ID;
  readonly type: ProductLinkType;
  readonly targetId: ID | null;
  readonly title: string;
  readonly url: URLString;
  readonly startMs: number | null;
  readonly endMs: number | null;
}

export interface InteractiveVideoLayer {
  readonly id: ID;
  readonly type:
    | "link"
    | "poll"
    | "question"
    | "product"
    | "location"
    | "mention"
    | "hashtag"
    | "custom";
  readonly startMs: number;
  readonly endMs: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface Video {
  readonly id: ID;
  readonly creator: UserSummary;
  readonly caption: string;
  readonly hashtags: readonly HashtagEntity[];
  readonly mentions: readonly Mention[];
  readonly media: MediaAsset;
  readonly manifest: VideoManifest | null;
  readonly thumbnailUrl: URLString | null;
  readonly durationMs: number;
  readonly privacy: VideoPrivacy;
  readonly status: VideoStatus;
  readonly sound: Sound | null;
  readonly originalVideoId: ID | null;
  readonly duetSourceVideoId: ID | null;
  readonly stitchSourceVideoId: ID | null;
  readonly replyToCommentId: ID | null;
  readonly productLinks: readonly ProductLink[];
  readonly interactiveLayers: readonly InteractiveVideoLayer[];
  readonly likeCount: number;
  readonly commentCount: number;
  readonly repostCount: number;
  readonly shareCount: number;
  readonly saveCount: number;
  readonly viewCount: number;
  readonly likedByViewer: boolean;
  readonly savedByViewer: boolean;
  readonly repostedByViewer: boolean;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export interface Comment {
  readonly id: ID;
  readonly videoId: ID;
  readonly author: UserSummary;
  readonly parentCommentId: ID | null;
  readonly text: string;
  readonly likeCount: number;
  readonly replyCount: number;
  readonly likedByViewer: boolean;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export interface ConversationParticipant {
  readonly user: UserSummary;
  readonly role: "member" | "admin";
  readonly joinedAt: ISODateString;
  readonly lastReadAt: ISODateString | null;
}

export interface Conversation {
  readonly id: ID;
  readonly type: ConversationType;
  readonly title: string | null;
  readonly avatarUrl: URLString | null;
  readonly participants: readonly ConversationParticipant[];
  readonly lastMessage: Message | null;
  readonly unreadCount: number;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export interface MessageAttachment {
  readonly id: ID;
  readonly type: "image" | "video" | "audio" | "file";
  readonly url: URLString;
  readonly mimeType: MimeType;
  readonly name: string | null;
  readonly sizeBytes: number;
  readonly durationMs: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface Message {
  readonly id: ID;
  readonly conversationId: ID;
  readonly sender: UserSummary;
  readonly type: MessageType;
  readonly text: string | null;
  readonly attachments: readonly MessageAttachment[];
  readonly replyToMessageId: ID | null;
  readonly createdAt: ISODateString;
  readonly editedAt: ISODateString | null;
  readonly deletedAt: ISODateString | null;
  readonly readAt: ISODateString | null;
}

export interface Story {
  readonly id: ID;
  readonly creator: UserSummary;
  readonly media: MediaAsset;
  readonly caption: string;
  readonly mentions: readonly Mention[];
  readonly hashtags: readonly HashtagEntity[];
  readonly status: StoryStatus;
  readonly viewCount: number;
  readonly viewedByViewer: boolean;
  readonly expiresAt: ISODateString;
  readonly createdAt: ISODateString;
}

export interface Notification {
  readonly id: ID;
  readonly recipientId: ID;
  readonly actor: UserSummary | null;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly resourceId: ID | null;
  readonly resourceType: string | null;
  readonly read: boolean;
  readonly createdAt: ISODateString;
}

export interface ContentReport {
  readonly id: ID;
  readonly reporterId: ID;
  readonly targetId: ID;
  readonly targetType: "user" | "video" | "comment" | "message" | "story";
  readonly reason: ContentReportReason;
  readonly details: string | null;
  readonly status: ReportStatus;
  readonly createdAt: ISODateString;
  readonly resolvedAt: ISODateString | null;
}

export interface PaginationCursor {
  readonly cursor: string | null;
  readonly hasMore: boolean;
  readonly limit: number;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly pagination: PaginationCursor;
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: readonly Record<string, unknown>[];
  readonly requestId: string;
  readonly timestamp: ISODateString;
}

export interface ApiSuccess<T> {
  readonly data: T;
  readonly requestId: string;
  readonly timestamp: ISODateString;
}

export interface AuthSession {
  readonly user: User;
  readonly accessTokenExpiresAt: ISODateString;
  readonly refreshTokenExpiresAt: ISODateString;
}

export interface FeedRequest {
  readonly cursor?: string;
  readonly limit?: number;
  readonly excludeVideoIds?: readonly ID[];
}

export interface FeedResponse extends PaginatedResult<Video> {
  readonly feedType: "for_you" | "following";
  readonly generatedAt: ISODateString;
}

export interface SearchResult {
  readonly users: readonly Profile[];
  readonly videos: readonly Video[];
  readonly hashtags: readonly HashtagEntity[];
  readonly sounds: readonly Sound[];
  readonly query: string;
  readonly pagination: PaginationCursor;
}

export interface SocialCounts {
  readonly followers: number;
  readonly following: number;
  readonly likes: number;
  readonly videos: number;
}

export interface CreatorAnalytics {
  readonly periodStart: ISODateString;
  readonly periodEnd: ISODateString;
  readonly views: number;
  readonly uniqueViewers: number;
  readonly likes: number;
  readonly comments: number;
  readonly shares: number;
  readonly saves: number;
  readonly followersGained: number;
  readonly followersLost: number;
  readonly averageWatchTimeMs: number;
  readonly completionRate: number;
}

export interface VideoPlaybackTelemetry {
  readonly videoId: ID;
  readonly sessionId: ID;
  readonly positionMs: number;
  readonly bufferedMs: number;
  readonly watchTimeMs: number;
  readonly completed: boolean;
  readonly source: "cdn" | "p2p";
  readonly p2pPeerCount: number;
  readonly clientTimestamp: ISODateString;
}

export interface P2PPeerCapability {
  readonly peerId: ID;
  readonly sessionId: ID;
  readonly videoId: ID;
  readonly supportedMimeTypes: readonly MimeType[];
  readonly maxUploadBytesPerSecond: number;
  readonly maxUploadPeers: number;
  readonly dataChannelSupported: boolean;
  readonly connectedAt: ISODateString;
}

export interface P2PChunkDescriptor {
  readonly videoId: ID;
  readonly manifestId: ID;
  readonly segmentIndex: number;
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly checksum: string;
  readonly sourcePeerId: ID | null;
}

export interface UploadSession {
  readonly id: ID;
  readonly userId: ID;
  readonly mediaAssetId: ID;
  readonly status: "created" | "uploading" | "processing" | "completed" | "failed" | "cancelled";
  readonly chunkSizeBytes: number;
  readonly totalChunks: number;
  readonly uploadedChunks: number;
  readonly expiresAt: ISODateString;
}

export interface DraftVideo {
  readonly id: ID;
  readonly ownerId: ID;
  readonly mediaAssetId: ID | null;
  readonly caption: string;
  readonly privacy: VideoPrivacy;
  readonly soundId: ID | null;
  readonly productLinks: readonly ProductLink[];
  readonly interactiveLayers: readonly InteractiveVideoLayer[];
  readonly updatedAt: ISODateString;
}

export interface BlockRelationship {
  readonly blockerId: ID;
  readonly blockedId: ID;
  readonly createdAt: ISODateString;
}

export interface VerificationStatus {
  readonly verified: boolean;
  readonly verifiedAt: ISODateString | null;
  readonly verificationType: "identity" | "creator" | "business" | "official" | null;
}

export interface DeviceSession {
  readonly id: ID;
  readonly userId: ID;
  readonly deviceName: string;
  readonly platform: "web" | "android" | "ios" | "desktop";
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly lastActiveAt: ISODateString;
  readonly createdAt: ISODateString;
  readonly revokedAt: ISODateString | null;
}

export interface WebSocketEnvelope<TPayload> {
  readonly event: string;
  readonly requestId: string;
  readonly timestamp: ISODateString;
  readonly payload: TPayload;
}

export interface LivePresence {
  readonly userId: ID;
  readonly online: boolean;
  readonly lastSeenAt: ISODateString;
}

export interface CommerceReference {
  readonly id: ID;
  readonly merchantId: ID;
  readonly title: string;
  readonly priceMinor: number;
  readonly currency: string;
  readonly imageUrl: URLString | null;
  readonly productUrl: URLString;
  readonly available: boolean;
}

export interface NERLOQHealthStatus {
  readonly service: string;
  readonly version: string;
  readonly environment: "development" | "test" | "staging" | "production";
  readonly uptimeSeconds: number;
  readonly timestamp: ISODateString;
  readonly dependencies: Readonly<Record<string, "healthy" | "degraded" | "unhealthy">>;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidId(value: unknown): value is ID {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

export function isValidISODateString(value: unknown): value is ISODateString {
  if (typeof value !== "string" || value.length < 10) {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

export function clampPaginationLimit(
  value: number | undefined,
  minimum = 1,
  maximum = 100,
  fallback = 20,
): number {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 1 || maximum < minimum) {
    throw new RangeError("Invalid pagination bounds.");
  }

  if (value === undefined) {
    return fallback >= minimum && fallback <= maximum ? fallback : minimum;
  }

  if (!Number.isFinite(value)) {
    return fallback >= minimum && fallback <= maximum ? fallback : minimum;
  }

  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
