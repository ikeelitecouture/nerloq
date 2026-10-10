import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { config, corsOrigins } from "@nerloq/config";
import { authRoutes } from "./features/auth/routes.js";
import { videoRoutes } from "./features/videos/routes.js";
import { notificationRoutes } from "./features/notifications/routes.js";
import { messagingRoutes } from "./features/messaging/routes.js";
import { extendedRoutes } from "./features/extended/routes.js";
import { attachRealtime } from "./infrastructure/realtime/socket.js";
import { ACCESS_COOKIE } from "./features/auth/cookies.js";
import { getDatabaseHealth, getDatabaseManager } from "./infrastructure/database.js";
import {
  NERLOQ_VERSION,
  type ApiError,
  type ApiSuccess,
} from "@nerloq/shared";

export interface BuildAppOptions {
  readonly logger?: boolean;
  readonly trustProxy?: boolean;
}

function createLoggerOptions(): NonNullable<FastifyServerOptions["logger"]> {
  return {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "headers.authorization",
        "headers.cookie",
        "password",
        "passwordHash",
        "accessToken",
        "refreshToken",
        "token",
      ],
      censor: "[REDACTED]",
    },
  };
}

function createApiSuccess<T>(
  data: T,
  requestId: string,
): ApiSuccess<T> {
  return {
    data,
    requestId,
    timestamp: new Date().toISOString(),
  };
}

function createApiError(
  code: string,
  message: string,
  requestId: string,
): ApiError {
  return {
    code,
    message,
    requestId,
    timestamp: new Date().toISOString(),
  };
}

function normalizeError(error: unknown): {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
} {
  if (error instanceof Error) {
    const fastifyError = error as FastifyError;

    const statusCode =
      typeof fastifyError.statusCode === "number" &&
      fastifyError.statusCode >= 400 &&
      fastifyError.statusCode <= 599
        ? fastifyError.statusCode
        : 500;

    return {
      statusCode,
      code:
        typeof fastifyError.code === "string"
          ? fastifyError.code
          : "INTERNAL_SERVER_ERROR",
      message:
        statusCode >= 500 && config.NODE_ENV === "production"
          ? "An unexpected server error occurred."
          : error.message,
    };
  }

  return {
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message:
      config.NODE_ENV === "production"
        ? "An unexpected server error occurred."
        : String(error),
  };
}

function registerCoreRoutes(app: FastifyInstance): void {
  app.get(
    "/health",
    { config: { rateLimit: false } },
    async (request, reply) => {
      const database = getDatabaseHealth();
      const response = createApiSuccess(
        {
          service: config.APP_NAME,
          version: NERLOQ_VERSION,
          status: database.ready ? "ok" as const : "degraded" as const,
          database,
          timestamp: new Date().toISOString(),
        },
        request.id,
      );

      return reply.code(database.ready ? 200 : 503).send(response);
    },
  );

  app.get(
    "/health/live",
    { config: { rateLimit: false } },
    async (request, reply) => {
      const response = createApiSuccess(
        {
          service: config.APP_NAME,
          status: "alive" as const,
          timestamp: new Date().toISOString(),
        },
        request.id,
      );

      return reply.code(200).send(response);
    },
  );

  app.get(
    "/health/version",
    { config: { rateLimit: false } },
    async (request, reply) => {
      const response = createApiSuccess(
        {
          service: config.APP_NAME,
          version: config.APP_VERSION,
          environment: config.NODE_ENV,
        },
        request.id,
      );

      return reply.code(200).send(response);
    },
  );
}

function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler(async (request, reply) => {
    const response = createApiError(
      "ROUTE_NOT_FOUND",
      `Route ${request.method} ${request.url} was not found.`,
      request.id,
    );

    return reply.code(404).send(response);
  });

  app.setErrorHandler(async (error, request, reply) => {
    const normalized = normalizeError(error);

    request.log.error(
      {
        err: error,
        statusCode: normalized.statusCode,
        code: normalized.code,
      },
      "NERLOQ request failed",
    );

    const response = createApiError(
      normalized.code,
      normalized.message,
      request.id,
    );

    return reply.code(normalized.statusCode).send(response);
  });
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const loggerEnabled = options.logger ?? true;
  const trustProxy = options.trustProxy ?? config.TRUST_PROXY;

  const fastifyOptions: FastifyServerOptions = {
    logger: loggerEnabled
      ? createLoggerOptions()
      : false,
    trustProxy,
    requestIdHeader: "x-request-id",
    logController: new LogController({ disableRequestLogging: false }),
    bodyLimit: 2 * 1024 * 1024,
  };

  const app = Fastify(fastifyOptions);

  app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });

  app.register(cors, {
    origin: [...corsOrigins],
    credentials: true,
    methods: [
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Accept",
      "Authorization",
      "Content-Type",
      "Origin",
      "X-Requested-With",
      "X-Request-ID",
      "X-Chunk-Checksum",
    ],
    exposedHeaders: ["X-Request-ID"],
    maxAge: 86400,
  });

  app.register(cookie, {
    hook: "onRequest",
  });

  app.register(jwt, {
    secret: config.JWT_ACCESS_SECRET,
    cookie: { cookieName: ACCESS_COOKIE, signed: false },
    sign: { expiresIn: config.JWT_ACCESS_EXPIRES_IN },
  });

  app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    hook: "onRequest",
    continueExceeding: false,
    skipOnError: false,
    ...(config.NODE_ENV === "production" || config.NODE_ENV === "staging" ? { redis: getDatabaseManager().redis } : {}),
    errorResponseBuilder: (_request, context) => {
      const error = new Error(`Rate limit exceeded, retry in ${context.after}`) as FastifyError;
      error.statusCode = context.statusCode;
      error.code = "RATE_LIMIT_EXCEEDED";
      return error;
    },
  });

  app.addHook("onRequest", async (request) => {
    request.headers["x-request-id"] = request.id;
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !corsOrigins.includes(origin)) {
      return reply.code(403).send(createApiError("CSRF_ORIGIN_REJECTED", "The request origin is not allowed.", request.id));
    }
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header("X-Request-ID", request.id);
  });

  registerCoreRoutes(app);
  app.register(authRoutes, { prefix: "/api/v1/auth" });
  app.register(videoRoutes, { prefix: "/api/v1" });
  app.register(notificationRoutes, { prefix: "/api/v1" });
  app.register(messagingRoutes, { prefix: "/api/v1" });
  app.register(extendedRoutes, { prefix: "/api/v1" });
  registerErrorHandling(app);
  app.addHook("onReady", async () => attachRealtime(app));

  return app;
}

export async function verifyAppReadiness(
  app: FastifyInstance,
): Promise<void> {
  await app.ready();

  if (!app.server.listening) {
    throw new Error("NERLOQ API is not listening.");
  }
}

export async function closeApp(
  app: FastifyInstance,
): Promise<void> {
  await app.close();
}
