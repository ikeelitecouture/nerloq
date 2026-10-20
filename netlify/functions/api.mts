import type { Handler } from "@netlify/functions";
import { buildApp } from "../../apps/api/src/app.js";
import {
  connectDatabase,
  getDatabaseHealth,
} from "../../apps/api/src/infrastructure/database.js";

const app = buildApp({ realtime: false });

let initialization: Promise<void> | undefined;

async function initialize(): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      await connectDatabase();
      await app.ready();

      if (!getDatabaseHealth().ready) {
        throw new Error("NERLOQ database is not ready.");
      }
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }

  await initialization;
}

export const handler: Handler = async (event) => {
  try {
    await initialize();

    const rawPath = event.path || "/";
    const prefix = "/.netlify/functions/api";
    const path = rawPath.startsWith(prefix)
      ? rawPath.slice(prefix.length) || "/"
      : rawPath;

    const query = event.rawQuery ? `?${event.rawQuery}` : "";

    const headers = Object.fromEntries(
      Object.entries(event.headers).filter(
        ([, value]) => value !== undefined,
      ),
    ) as Record<string, string>;

    const payload = event.body
      ? event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body
      : undefined;

    const response = await app.inject({
      method: event.httpMethod as
        | "GET"
        | "HEAD"
        | "POST"
        | "PUT"
        | "PATCH"
        | "DELETE"
        | "OPTIONS",
      url: `${path}${query}`,
      headers,
      ...(payload !== undefined ? { payload } : {}),
    });

    const responseHeaders = { ...response.headers };
    delete responseHeaders["content-length"];
    delete responseHeaders["transfer-encoding"];

    return {
      statusCode: response.statusCode,
      headers: Object.fromEntries(
        Object.entries(responseHeaders).filter(
          ([, value]) => value !== undefined,
        ),
      ) as Record<string, string>,
      body: response.body,
    };
  } catch (error) {
    console.error("NERLOQ serverless API initialization/request failed:", error);

    return {
      statusCode: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
      body: JSON.stringify({
        error: {
          code: "API_UNAVAILABLE",
          message: "NERLOQ API is temporarily unavailable.",
        },
      }),
    };
  }
};
