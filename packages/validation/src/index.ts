import { z } from "zod";

export const idSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, "Invalid identifier.");

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must contain at least 3 characters.")
  .max(30, "Username cannot exceed 30 characters.")
  .regex(
    /^[A-Za-z0-9._]+$/,
    "Username may contain only letters, numbers, periods and underscores.",
  )
  .transform((value) => value.toLowerCase());

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(254);

export const passwordSchema = z
  .string()
  .min(12, "Password must contain at least 12 characters.")
  .max(128, "Password cannot exceed 128 characters.")
  .refine(
    (value) => /[A-Z]/.test(value),
    "Password must contain at least one uppercase letter.",
  )
  .refine(
    (value) => /[a-z]/.test(value),
    "Password must contain at least one lowercase letter.",
  )
  .refine(
    (value) => /\d/.test(value),
    "Password must contain at least one number.",
  )
  .refine(
    (value) => /[^A-Za-z0-9]/.test(value),
    "Password must contain at least one special character.",
  );

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name is required.")
  .max(80, "Display name cannot exceed 80 characters.");

export const bioSchema = z
  .string()
  .trim()
  .max(500, "Bio cannot exceed 500 characters.");

export const urlSchema = z
  .string()
  .trim()
  .url("Enter a valid URL.")
  .max(2048);

export const isoDateSchema = z
  .string()
  .datetime({ offset: true });

export const paginationLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20);

export const cursorSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .optional();

export const registerSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(254),
    password: z
      .string()
      .min(1)
      .max(128),
  })
  .strict();

export const refreshTokenSchema = z
  .object({
    refreshToken: z
      .string()
      .trim()
      .min(20)
      .max(4096),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(20)
      .max(4096),
    password: passwordSchema,
  })
  .strict();

export const updateProfileSchema = z
  .object({
    username: usernameSchema.optional(),
    displayName: displayNameSchema.optional(),
    bio: bioSchema.optional(),
    websiteUrl: urlSchema.nullable().optional(),
    avatarUrl: urlSchema.nullable().optional(),
    isPrivate: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one profile field must be supplied.",
  );

export const followUserSchema = z
  .object({
    userId: idSchema,
  })
  .strict();

export const blockUserSchema = z
  .object({
    userId: idSchema,
  })
  .strict();

export const videoPrivacySchema = z.enum([
  "public",
  "followers",
  "private",
]);

export const videoIdSchema = z
  .object({
    videoId: idSchema,
  })
  .strict();

export const createVideoSchema = z
  .object({
    mediaAssetId: idSchema,
    caption: z
      .string()
      .trim()
      .max(4000, "Caption cannot exceed 4000 characters.")
      .default(""),
    privacy: videoPrivacySchema.default("public"),
    soundId: idSchema.nullable().default(null),
    productLinks: z
      .array(
        z
          .object({
            type: z.enum([
              "product",
              "collection",
              "store",
              "external",
            ]),
            targetId: idSchema.nullable(),
            title: z.string().trim().min(1).max(200),
            url: urlSchema,
            startMs: z.number().int().min(0).nullable(),
            endMs: z.number().int().min(0).nullable(),
          })
          .strict()
          .refine(
            (value) =>
              value.endMs === null ||
              value.startMs === null ||
              value.endMs >= value.startMs,
            "Product link end time must be after its start time.",
          ),
      )
      .max(50)
      .default([]),
    interactiveLayers: z
      .array(
        z
          .object({
            type: z.enum([
              "link",
              "poll",
              "question",
              "product",
              "location",
              "mention",
              "hashtag",
              "custom",
            ]),
            startMs: z.number().int().min(0),
            endMs: z.number().int().min(0).nullable(),
            payload: z.record(z.string(), z.unknown()),
          })
          .strict()
          .refine(
            (value) =>
              value.endMs === null || value.endMs >= value.startMs,
            "Interactive layer end time must be after its start time.",
          ),
      )
      .max(100)
      .default([]),
  })
  .strict();

export const updateVideoSchema = z
  .object({
    caption: z
      .string()
      .trim()
      .max(4000)
      .optional(),
    privacy: videoPrivacySchema.optional(),
    soundId: idSchema.nullable().optional(),
    productLinks: z
      .array(
        z
          .object({
            type: z.enum([
              "product",
              "collection",
              "store",
              "external",
            ]),
            targetId: idSchema.nullable(),
            title: z.string().trim().min(1).max(200),
            url: urlSchema,
            startMs: z.number().int().min(0).nullable(),
            endMs: z.number().int().min(0).nullable(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    interactiveLayers: z
      .array(
        z
          .object({
            type: z.enum([
              "link",
              "poll",
              "question",
              "product",
              "location",
              "mention",
              "hashtag",
              "custom",
            ]),
            startMs: z.number().int().min(0),
            endMs: z.number().int().min(0).nullable(),
            payload: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one video field must be supplied.",
  );

export const createCommentSchema = z
  .object({
    videoId: idSchema,
    parentCommentId: idSchema.nullable().default(null),
    text: z
      .string()
      .trim()
      .min(1, "Comment cannot be empty.")
      .max(2000, "Comment cannot exceed 2000 characters."),
  })
  .strict();

export const updateCommentSchema = z
  .object({
    commentId: idSchema,
    text: z
      .string()
      .trim()
      .min(1)
      .max(2000),
  })
  .strict();

export const interactionSchema = z
  .object({
    videoId: idSchema,
  })
  .strict();

export const shareVideoSchema = z
  .object({
    videoId: idSchema,
    destination: z
      .enum([
        "internal",
        "copy_link",
        "native_share",
        "external",
      ])
      .default("internal"),
  })
  .strict();

export const searchSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(200),
    cursor: cursorSchema,
    limit: paginationLimitSchema,
  })
  .strict();

export const feedSchema = z
  .object({
    cursor: cursorSchema,
    limit: paginationLimitSchema,
    excludeVideoIds: z
      .array(idSchema)
      .max(100)
      .default([]),
  })
  .strict();

export const messageTypeSchema = z.enum([
  "text",
  "image",
  "video",
  "audio",
  "file",
  "sticker",
]);

export const createConversationSchema = z
  .object({
    participantIds: z
      .array(idSchema)
      .min(1)
      .max(100),
    type: z.enum(["direct", "group"]).default("direct"),
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((value, context) => {
    const uniqueIds = new Set(value.participantIds);

    if (uniqueIds.size !== value.participantIds.length) {
      context.addIssue({
        code: "custom",
        path: ["participantIds"],
        message: "Participant IDs must be unique.",
      });
    }

    if (value.type === "direct" && value.participantIds.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["participantIds"],
        message: "A direct conversation must specify exactly one other participant.",
      });
    }
  });

export const sendMessageSchema = z
  .object({
    conversationId: idSchema,
    type: messageTypeSchema,
    text: z
      .string()
      .trim()
      .max(10000)
      .nullable()
      .default(null),
    replyToMessageId: idSchema.nullable().default(null),
    attachmentIds: z
      .array(idSchema)
      .max(20)
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const hasText = value.text !== null && value.text.length > 0;
    const hasAttachments = value.attachmentIds.length > 0;

    if (!hasText && !hasAttachments) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "A message must contain text or at least one attachment.",
      });
    }

    if (value.type === "text" && !hasText) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Text messages require non-empty text.",
      });
    }

    if (value.type !== "text" && !hasAttachments) {
      context.addIssue({
        code: "custom",
        path: ["attachmentIds"],
        message: "Media messages require at least one attachment.",
      });
    }
  });

export const markConversationReadSchema = z
  .object({
    conversationId: idSchema,
  })
  .strict();

export const createStorySchema = z
  .object({
    mediaAssetId: idSchema,
    caption: z
      .string()
      .trim()
      .max(2000)
      .default(""),
    mentions: z
      .array(idSchema)
      .max(50)
      .default([]),
    hashtags: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(100)
          .regex(/^#?[A-Za-z0-9_]+$/),
      )
      .max(50)
      .default([]),
  })
  .strict();

export const storyIdSchema = z
  .object({
    storyId: idSchema,
  })
  .strict();

export const createReportSchema = z
  .object({
    targetId: idSchema,
    targetType: z.enum([
      "user",
      "video",
      "comment",
      "message",
      "story",
    ]),
    reason: z.enum([
      "spam",
      "harassment",
      "hate",
      "violence",
      "sexual_content",
      "dangerous_activity",
      "misinformation",
      "copyright",
      "privacy",
      "impersonation",
      "other",
    ]),
    details: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .default(null),
  })
  .strict();

export const createDraftSchema = z
  .object({
    mediaAssetId: idSchema.nullable().default(null),
    caption: z
      .string()
      .trim()
      .max(4000)
      .default(""),
    privacy: videoPrivacySchema.default("public"),
    soundId: idSchema.nullable().default(null),
  })
  .strict();

export const updateDraftSchema = createDraftSchema.partial().strict();

export const uploadInitializationSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255),
    mimeType: z
      .string()
      .trim()
      .min(1)
      .max(255),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(524288000),
    checksum: z
      .string()
      .trim()
      .min(16)
      .max(256),
  })
  .strict();

export const uploadChunkSchema = z
  .object({
    uploadSessionId: idSchema,
    chunkIndex: z
      .number()
      .int()
      .min(0),
    checksum: z
      .string()
      .trim()
      .min(16)
      .max(256),
  })
  .strict();

export const completeUploadSchema = z
  .object({
    uploadSessionId: idSchema,
    totalChunks: z
      .number()
      .int()
      .positive()
      .max(10000),
  })
  .strict();

export const playbackTelemetrySchema = z
  .object({
    videoId: idSchema,
    sessionId: idSchema,
    positionMs: z
      .number()
      .finite()
      .min(0),
    bufferedMs: z
      .number()
      .finite()
      .min(0),
    watchTimeMs: z
      .number()
      .finite()
      .min(0),
    completed: z.boolean(),
    source: z.enum(["cdn", "p2p"]),
    p2pPeerCount: z
      .number()
      .int()
      .min(0)
      .max(8),
    clientTimestamp: isoDateSchema,
  })
  .strict();

export const p2pPeerCapabilitySchema = z
  .object({
    peerId: idSchema,
    sessionId: idSchema,
    videoId: idSchema,
    supportedMimeTypes: z
      .array(z.string().trim().min(1).max(255))
      .min(1)
      .max(20),
    maxUploadBytesPerSecond: z
      .number()
      .int()
      .positive()
      .max(10485760),
    maxUploadPeers: z
      .number()
      .int()
      .min(0)
      .max(8),
    dataChannelSupported: z.boolean(),
  })
  .strict();

export const p2pChunkRequestSchema = z
  .object({
    videoId: idSchema,
    manifestId: idSchema,
    segmentIndex: z
      .number()
      .int()
      .min(0),
    checksum: z
      .string()
      .trim()
      .min(16)
      .max(256),
  })
  .strict();

export const productLinkSchema = z
  .object({
    type: z.enum([
      "product",
      "collection",
      "store",
      "external",
    ]),
    targetId: idSchema.nullable(),
    title: z.string().trim().min(1).max(200),
    url: urlSchema,
    startMs: z.number().int().min(0).nullable(),
    endMs: z.number().int().min(0).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.endMs === null ||
      value.startMs === null ||
      value.endMs >= value.startMs,
    "Product link end time must be after its start time.",
  );

export const videoLayerSchema = z
  .object({
    type: z.enum([
      "link",
      "poll",
      "question",
      "product",
      "location",
      "mention",
      "hashtag",
      "custom",
    ]),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0).nullable(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine(
    (value) =>
      value.endMs === null || value.endMs >= value.startMs,
    "Interactive layer end time must be after its start time.",
  );

export const notificationQuerySchema = z
  .object({
    cursor: cursorSchema,
    limit: paginationLimitSchema,
    unreadOnly: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .default(false),
  })
  .strict();

export const deviceSessionIdSchema = z
  .object({
    sessionId: idSchema,
  })
  .strict();

export const hashtagSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^#?[A-Za-z0-9_]+$/)
  .transform((value) => value.startsWith("#") ? value.slice(1).toLowerCase() : value.toLowerCase());

export const mentionSchema = z
  .string()
  .trim()
  .min(2)
  .max(31)
  .regex(/^@?[A-Za-z0-9._]+$/)
  .transform((value) => value.startsWith("@") ? value.slice(1).toLowerCase() : value.toLowerCase());

export const videoReplySchema = z
  .object({
    videoId: idSchema,
    commentId: idSchema,
    mediaAssetId: idSchema,
    caption: z
      .string()
      .trim()
      .max(4000)
      .default(""),
  })
  .strict();

export const duetSchema = z
  .object({
    sourceVideoId: idSchema,
    mediaAssetId: idSchema,
    caption: z
      .string()
      .trim()
      .max(4000)
      .default(""),
  })
  .strict();

export const stitchSchema = z
  .object({
    sourceVideoId: idSchema,
    mediaAssetId: idSchema,
    startMs: z
      .number()
      .int()
      .min(0),
    endMs: z
      .number()
      .int()
      .positive(),
    caption: z
      .string()
      .trim()
      .max(4000)
      .default(""),
  })
  .strict()
  .refine(
    (value) => value.endMs > value.startMs,
    "Stitch end time must be after its start time.",
  );

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateVideoInput = z.infer<typeof createVideoSchema>;
export type UpdateVideoInput = z.infer<typeof updateVideoSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type CreateStoryInput = z.infer<typeof createStorySchema>;
export type CreateReportInput = z.infer<typeof createReportSchema>;
export type UploadInitializationInput = z.infer<typeof uploadInitializationSchema>;
export type PlaybackTelemetryInput = z.infer<typeof playbackTelemetrySchema>;
export type P2PPeerCapabilityInput = z.infer<typeof p2pPeerCapabilitySchema>;
export type ProductLinkInput = z.infer<typeof productLinkSchema>;
export type VideoLayerInput = z.infer<typeof videoLayerSchema>;

export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  input: unknown,
): T {
  return schema.parse(input);
}

export function safeParse<T>(
  schema: z.ZodType<T>,
  input: unknown,
): {
  success: true;
  data: T;
} | {
  success: false;
  errors: readonly {
    path: readonly PropertyKey[];
    message: string;
  }[];
} {
  const result = schema.safeParse(input);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
    })),
  };
}

export const userSettingsSchema = z.object({
  allowMessageRequests: z.boolean().optional(),
  notifications: z.object({ likes: z.boolean().optional(), comments: z.boolean().optional(), follows: z.boolean().optional(), messages: z.boolean().optional(), system: z.boolean().optional() }).strict().optional(),
  playback: z.object({ autoplay: z.boolean().optional(), muteByDefault: z.boolean().optional(), captions: z.boolean().optional() }).strict().optional(),
  reduceMotion: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0, "At least one setting must be supplied.");
