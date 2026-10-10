import { config } from "@nerloq/config";
import { buildApp, closeApp } from "./app.js";
import {
  connectDatabase,
  disconnectDatabase,
  getDatabaseHealth,
} from "./infrastructure/database.js";

const app = buildApp();

let shuttingDown = false;
let shutdownPromise: Promise<void> | null = null;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shuttingDown = true;

  shutdownPromise = (async () => {
    app.log.info(
      {
        signal,
        exitCode,
      },
      "NERLOQ shutdown initiated",
    );

    const failures: Error[] = [];

    try {
      await closeApp(app);
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error
          : new Error(`Fastify shutdown failed: ${String(error)}`),
      );
    }

    try {
      await disconnectDatabase();
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error
          : new Error(`Database shutdown failed: ${String(error)}`),
      );
    }

    if (failures.length > 0) {
      for (const failure of failures) {
        app.log.error(
          {
            err: failure,
          },
          "NERLOQ shutdown component failed",
        );
      }

      process.exitCode = 1;
      return;
    }

    process.exitCode = exitCode;

    app.log.info(
      {
        signal,
        exitCode,
      },
      "NERLOQ shutdown completed",
    );
  })();

  return shutdownPromise;
}

async function start(): Promise<void> {
  try {
    await connectDatabase();

    const databaseHealth = getDatabaseHealth();

    if (!databaseHealth.ready) {
      throw new Error(
        `Database initialization completed without a ready state: ${JSON.stringify(
          databaseHealth,
        )}`,
      );
    }

    app.get(
      "/health/ready",
      {
        config: {
          rateLimit: false,
        },
      },
      async (_request, reply) => {
        const health = getDatabaseHealth();

        if (!health.ready || shuttingDown) {
          return reply.code(503).send({
            status: "not_ready",
            service: "nerloq-api",
            database: health,
          });
        }

        return reply.code(200).send({
          status: "ready",
          service: "nerloq-api",
          database: health,
        });
      },
    );

    app.get(
      "/health/database",
      {
        config: {
          rateLimit: false,
        },
      },
      async (_request, reply) => {
        const health = getDatabaseHealth();

        return reply.code(health.ready ? 200 : 503).send({
          status: health.ready ? "ok" : "degraded",
          service: "nerloq-api",
          database: health,
        });
      },
    );

    await app.listen({
      host: config.HOST,
      port: config.PORT,
    });

    app.log.info(
      {
        host: config.HOST,
        port: config.PORT,
        environment: config.NODE_ENV,
        version: config.APP_VERSION,
      },
      "NERLOQ API started",
    );
  } catch (error) {
    app.log.error(
      {
        err: error,
      },
      "NERLOQ API startup failed",
    );

    try {
      await closeApp(app);
    } catch (closeError) {
      app.log.error(
        {
          err: closeError,
        },
        "NERLOQ failed to close Fastify after startup failure",
      );
    }

    try {
      await disconnectDatabase();
    } catch (disconnectError) {
      app.log.error(
        {
          err: disconnectError,
        },
        "NERLOQ failed to disconnect databases after startup failure",
      );
    }

    process.exitCode = 1;
  }
}

function registerProcessHandlers(): void {
  const handleTermination = (signal: NodeJS.Signals): void => {
    void shutdown(signal, 0).then(() => {
      if (process.exitCode === 0) {
        process.exit(0);
      }
    });
  };

  process.once("SIGINT", handleTermination);
  process.once("SIGTERM", handleTermination);

  process.on("uncaughtException", (error: Error) => {
    app.log.fatal(
      {
        err: error,
      },
      "NERLOQ uncaught exception",
    );

    void shutdown("uncaughtException", 1).then(() => {
      process.exit(1);
    });
  });

  process.on(
    "unhandledRejection",
    (reason: unknown) => {
      const error =
        reason instanceof Error
          ? reason
          : new Error(String(reason));

      app.log.fatal(
        {
          err: error,
        },
        "NERLOQ unhandled promise rejection",
      );

      void shutdown("unhandledRejection", 1).then(() => {
        process.exit(1);
      });
    },
  );
}

registerProcessHandlers();

void start();
