import { z } from "zod";

const booleanFromEnvironment = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const positiveInteger = z.coerce.number().int().positive();


const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),

  APP_NAME: z.string().trim().min(1).default("NERLOQ"),
  APP_VERSION: z.string().trim().min(1).default("1.0.0"),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: positiveInteger.max(65535).default(5000),

  API_PUBLIC_URL: z.string().url().default("http://localhost:5000"),
  WEB_PUBLIC_URL: z.string().url().default("http://localhost:5173"),

  MONGODB_URI: z.string().trim().min(1),
  MONGODB_DATABASE: z.string().trim().min(1).default("nerloq"),

  REDIS_URL: z.string().trim().min(1),
  REDIS_REQUIRED: booleanFromEnvironment.optional(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().trim().min(1).default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().trim().min(1).default("30d"),

  COOKIE_DOMAIN: z.string().trim().min(1).optional(),
  COOKIE_SECURE: booleanFromEnvironment.default(false),
  COOKIE_SAME_SITE: z
    .enum(["strict", "lax", "none"])
    .default("lax"),

  CORS_ORIGINS: z
    .string()
    .trim()
    .min(1)
    .default("http://localhost:5173"),

  RATE_LIMIT_MAX: positiveInteger.default(300),
  RATE_LIMIT_WINDOW_MS: positiveInteger.default(60000),

  MAX_UPLOAD_BYTES: positiveInteger.default(524288000),
  MAX_VIDEO_DURATION_MS: positiveInteger.default(600000),
  MAX_VIDEO_WIDTH: positiveInteger.default(3840),
  MAX_VIDEO_HEIGHT: positiveInteger.default(3840),

  MEDIA_STORAGE_PROVIDER: z
    .enum(["local", "s3", "r2", "gcs"])
    .default("local"),

  MEDIA_STORAGE_BUCKET: z.string().trim().min(1).default("nerloq-media"),
  MEDIA_STORAGE_REGION: z.string().trim().min(1).default("auto"),
  MEDIA_STORAGE_ENDPOINT: z.string().url().optional(),
  MEDIA_STORAGE_ACCESS_KEY: z.string().trim().min(1).optional(),
  MEDIA_STORAGE_SECRET_KEY: z.string().trim().min(1).optional(),

  CDN_BASE_URL: z.string().url().optional(),

  FFMPEG_BINARY: z.string().trim().min(1).default("ffmpeg"),
  FFPROBE_BINARY: z.string().trim().min(1).default("ffprobe"),

  WEBRTC_ENABLED: booleanFromEnvironment.default(true),
  P2P_ENABLED: booleanFromEnvironment.default(true),
  P2P_MAX_PEERS_PER_VIEWER: positiveInteger.max(8).default(3),
  P2P_MAX_UPLOAD_BYTES_PER_SECOND: positiveInteger.default(1048576),

  EMAIL_PROVIDER: z
    .enum(["console", "smtp", "resend", "sendgrid"])
    .default("console"),
  EMAIL_FROM: z.string().email().optional(),
  EMAIL_API_KEY: z.string().trim().min(1).optional(),
  SMTP_HOST: z.string().trim().min(1).optional(),
  SMTP_PORT: positiveInteger.max(65535).default(587),
  SMTP_USERNAME: z.string().trim().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),

  PUSH_PROVIDER: z
    .enum(["none", "fcm", "webpush"])
    .default("none"),

  FCM_PROJECT_ID: z.string().trim().min(1).optional(),
  FCM_CLIENT_EMAIL: z.string().email().optional(),
  FCM_PRIVATE_KEY: z.string().min(1).optional(),

  WEB_PUSH_VAPID_PUBLIC_KEY: z.string().trim().min(1).optional(),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.string().trim().min(1).optional(),
  WEB_PUSH_VAPID_SUBJECT: z.string().url().optional(),

  SEARCH_PROVIDER: z
    .enum(["mongodb", "opensearch", "meilisearch"])
    .default("mongodb"),
  SEARCH_URL: z.string().url().optional(),
  SEARCH_API_KEY: z.string().trim().min(1).optional(),

  OBSERVABILITY_ENABLED: booleanFromEnvironment.default(false),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  TRUST_PROXY: booleanFromEnvironment.default(false),

  SESSION_IDLE_TIMEOUT_MS: positiveInteger.default(2592000000),
  PASSWORD_MIN_LENGTH: positiveInteger.min(8).max(128).default(12),

  ENABLE_REGISTRATION: booleanFromEnvironment.default(true),
  ENABLE_COMMERCE: booleanFromEnvironment.default(true),
  ENABLE_STORIES: booleanFromEnvironment.default(true),
  ENABLE_DUETS: booleanFromEnvironment.default(true),
  ENABLE_STITCHES: booleanFromEnvironment.default(true),
  ENABLE_LIVE: booleanFromEnvironment.default(false),
});

export type EnvironmentConfig = z.infer<typeof environmentSchema>;

function normalizeEnvironment(input: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const normalized = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]),
  );
  normalized["REDIS_REQUIRED"] ??= input["NODE_ENV"] === "production" || input["NODE_ENV"] === "staging" ? "true" : "false";
  return normalized;
}

function validateEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): EnvironmentConfig {
  const result = environmentSchema.safeParse(normalizeEnvironment(input));

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "environment";
        return `${path}: ${issue.message}`;
      })
      .join("\n");

    throw new Error(`Invalid NERLOQ environment configuration:\n${issues}`);
  }

  const config = result.data;

  if (config.COOKIE_SAME_SITE === "none" && !config.COOKIE_SECURE) {
    throw new Error("COOKIE_SAME_SITE=none requires COOKIE_SECURE=true.");
  }

  if ((config.NODE_ENV === "production" || config.NODE_ENV === "staging") && !config.COOKIE_SECURE) {
    throw new Error("COOKIE_SECURE=true is required in staging and production.");
  }

  if ((config.NODE_ENV === "production" || config.NODE_ENV === "staging") && !config.REDIS_REQUIRED) {
    throw new Error("REDIS_REQUIRED=true is required in staging and production.");
  }

  if ((config.NODE_ENV === "production" || config.NODE_ENV === "staging") && config.MEDIA_STORAGE_PROVIDER === "local") {
    throw new Error("Staging and production require cloud media storage; local storage is for development only.");
  }

  if (config.EMAIL_PROVIDER === "smtp") {
    throw new Error("SMTP delivery is not supported by this build. Configure Resend or SendGrid.");
  }

  if (config.MEDIA_STORAGE_PROVIDER !== "local") {
    const requiredStorageValues = [
      ["MEDIA_STORAGE_ACCESS_KEY", config.MEDIA_STORAGE_ACCESS_KEY],
      ["MEDIA_STORAGE_SECRET_KEY", config.MEDIA_STORAGE_SECRET_KEY],
    ] as const;

    const missingStorageValues = requiredStorageValues
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missingStorageValues.length > 0) {
      throw new Error(
        `Cloud media storage requires: ${missingStorageValues.join(", ")}.`,
      );
    }
  }

  if ((config.NODE_ENV === "production" || config.NODE_ENV === "staging") && config.EMAIL_PROVIDER === "console") {
    throw new Error("Production requires an email delivery provider for account recovery.");
  }

  if (config.EMAIL_PROVIDER !== "console") {
    const requiredEmailValues = [
      ["EMAIL_FROM", config.EMAIL_FROM],
      ["EMAIL_API_KEY", config.EMAIL_API_KEY],
    ] as const;

    const missingEmailValues = requiredEmailValues
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missingEmailValues.length > 0) {
      throw new Error(
        `Configured email provider requires: ${missingEmailValues.join(", ")}.`,
      );
    }
  }

  if (config.PUSH_PROVIDER === "fcm") {
    const requiredFirebaseValues = [
      ["FCM_PROJECT_ID", config.FCM_PROJECT_ID],
      ["FCM_CLIENT_EMAIL", config.FCM_CLIENT_EMAIL],
      ["FCM_PRIVATE_KEY", config.FCM_PRIVATE_KEY],
    ] as const;

    const missingFirebaseValues = requiredFirebaseValues
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missingFirebaseValues.length > 0) {
      throw new Error(
        `FCM push notifications require: ${missingFirebaseValues.join(", ")}.`,
      );
    }
  }

  if (config.PUSH_PROVIDER === "webpush") {
    const requiredWebPushValues = [
      ["WEB_PUSH_VAPID_PUBLIC_KEY", config.WEB_PUSH_VAPID_PUBLIC_KEY],
      ["WEB_PUSH_VAPID_PRIVATE_KEY", config.WEB_PUSH_VAPID_PRIVATE_KEY],
      ["WEB_PUSH_VAPID_SUBJECT", config.WEB_PUSH_VAPID_SUBJECT],
    ] as const;

    const missingWebPushValues = requiredWebPushValues
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missingWebPushValues.length > 0) {
      throw new Error(
        `Web Push requires: ${missingWebPushValues.join(", ")}.`,
      );
    }
  }

  if (config.SEARCH_PROVIDER !== "mongodb") {
    if (!config.SEARCH_URL || !config.SEARCH_API_KEY) {
      throw new Error(
        "External search providers require SEARCH_URL and SEARCH_API_KEY.",
      );
    }
  }

  return config;
}

export const config = validateEnvironment();

export const corsOrigins = Object.freeze(
  config.CORS_ORIGINS
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

export function isProduction(): boolean {
  return config.NODE_ENV === "production";
}

export function isDevelopment(): boolean {
  return config.NODE_ENV === "development";
}

export function isTest(): boolean {
  return config.NODE_ENV === "test";
}

export function isStaging(): boolean {
  return config.NODE_ENV === "staging";
}

export function getMongoConnectionOptions(): Readonly<{
  uri: string;
  database: string;
}> {
  return Object.freeze({
    uri: config.MONGODB_URI,
    database: config.MONGODB_DATABASE,
  });
}

export function getRedisConnectionOptions(): Readonly<{
  url: string;
}> {
  return Object.freeze({
    url: config.REDIS_URL,
  });
}

export function getMediaConfiguration(): Readonly<{
  provider: EnvironmentConfig["MEDIA_STORAGE_PROVIDER"];
  bucket: string;
  region: string;
  endpoint: string | undefined;
  cdnBaseUrl: string | undefined;
  maxUploadBytes: number;
  maxVideoDurationMs: number;
  maxVideoWidth: number;
  maxVideoHeight: number;
  ffmpegBinary: string;
  ffprobeBinary: string;
}> {
  return Object.freeze({
    provider: config.MEDIA_STORAGE_PROVIDER,
    bucket: config.MEDIA_STORAGE_BUCKET,
    region: config.MEDIA_STORAGE_REGION,
    endpoint: config.MEDIA_STORAGE_ENDPOINT,
    cdnBaseUrl: config.CDN_BASE_URL,
    maxUploadBytes: config.MAX_UPLOAD_BYTES,
    maxVideoDurationMs: config.MAX_VIDEO_DURATION_MS,
    maxVideoWidth: config.MAX_VIDEO_WIDTH,
    maxVideoHeight: config.MAX_VIDEO_HEIGHT,
    ffmpegBinary: config.FFMPEG_BINARY,
    ffprobeBinary: config.FFPROBE_BINARY,
  });
}

export function getRealtimeConfiguration(): Readonly<{
  webRtcEnabled: boolean;
  p2pEnabled: boolean;
  maxPeersPerViewer: number;
  maxUploadBytesPerSecond: number;
}> {
  return Object.freeze({
    webRtcEnabled: config.WEBRTC_ENABLED,
    p2pEnabled: config.P2P_ENABLED,
    maxPeersPerViewer: config.P2P_MAX_PEERS_PER_VIEWER,
    maxUploadBytesPerSecond: config.P2P_MAX_UPLOAD_BYTES_PER_SECOND,
  });
}

export function getSecurityConfiguration(): Readonly<{
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
  cookieDomain: string | undefined;
  cookieSecure: boolean;
  cookieSameSite: "strict" | "lax" | "none";
  rateLimitMax: number;
  rateLimitWindowMs: number;
  sessionIdleTimeoutMs: number;
  passwordMinLength: number;
  trustProxy: boolean;
}> {
  return Object.freeze({
    accessTokenExpiresIn: config.JWT_ACCESS_EXPIRES_IN,
    refreshTokenExpiresIn: config.JWT_REFRESH_EXPIRES_IN,
    cookieDomain: config.COOKIE_DOMAIN,
    cookieSecure: config.COOKIE_SECURE,
    cookieSameSite: config.COOKIE_SAME_SITE,
    rateLimitMax: config.RATE_LIMIT_MAX,
    rateLimitWindowMs: config.RATE_LIMIT_WINDOW_MS,
    sessionIdleTimeoutMs: config.SESSION_IDLE_TIMEOUT_MS,
    passwordMinLength: config.PASSWORD_MIN_LENGTH,
    trustProxy: config.TRUST_PROXY,
  });
}

export function getFeatureFlags(): Readonly<{
  registration: boolean;
  commerce: boolean;
  stories: boolean;
  duets: boolean;
  stitches: boolean;
  live: boolean;
}> {
  return Object.freeze({
    registration: config.ENABLE_REGISTRATION,
    commerce: config.ENABLE_COMMERCE,
    stories: config.ENABLE_STORIES,
    duets: config.ENABLE_DUETS,
    stitches: config.ENABLE_STITCHES,
    live: config.ENABLE_LIVE,
  });
}

export function getPublicConfiguration(): Readonly<{
  appName: string;
  appVersion: string;
  apiPublicUrl: string;
  webPublicUrl: string;
  environment: EnvironmentConfig["NODE_ENV"];
  cdnBaseUrl: string | undefined;
  realtime: ReturnType<typeof getRealtimeConfiguration>;
  features: ReturnType<typeof getFeatureFlags>;
}> {
  return Object.freeze({
    appName: config.APP_NAME,
    appVersion: config.APP_VERSION,
    apiPublicUrl: config.API_PUBLIC_URL,
    webPublicUrl: config.WEB_PUBLIC_URL,
    environment: config.NODE_ENV,
    cdnBaseUrl: config.CDN_BASE_URL,
    realtime: getRealtimeConfiguration(),
    features: getFeatureFlags(),
  });
}

export { environmentSchema, validateEnvironment };
