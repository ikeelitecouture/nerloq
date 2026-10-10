import { Types } from "mongoose";

interface CursorPayload {
  readonly version: 1;
  readonly timestamp: string;
  readonly id: string;
}

export function encodeCursor(createdAt: Date, id: Types.ObjectId): string {
  const payload: CursorPayload = {
    version: 1,
    timestamp: createdAt.toISOString(),
    id: id.toString(),
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: unknown, field = "createdAt"): Record<string, unknown> {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 2048) {
    return {};
  }

  let payload: Partial<CursorPayload>;
  try {
    payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorPayload>;
  } catch {
    throw Object.assign(new Error("Invalid pagination cursor."), {
      statusCode: 400,
      code: "INVALID_CURSOR",
    });
  }

  const timestamp = typeof payload.timestamp === "string" ? new Date(payload.timestamp) : null;
  if (
    payload.version !== 1 ||
    !timestamp ||
    !Number.isFinite(timestamp.getTime()) ||
    typeof payload.id !== "string" ||
    !Types.ObjectId.isValid(payload.id)
  ) {
    throw Object.assign(new Error("Invalid pagination cursor."), {
      statusCode: 400,
      code: "INVALID_CURSOR",
    });
  }

  const id = new Types.ObjectId(payload.id);
  return {
    $or: [
      { [field]: { $lt: timestamp } },
      { [field]: timestamp, _id: { $lt: id } },
    ],
  };
}
