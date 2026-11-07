import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { decodeCursor, encodeCursor } from "./pagination.js";

describe("cursor pagination", () => {
  it("round-trips the timestamp and object id into a stable range predicate", () => {
    const createdAt = new Date("2026-01-02T03:04:05.000Z");
    const id = new Types.ObjectId("68df8a0f5a2d8c871be12345");
    const filter = decodeCursor(encodeCursor(createdAt, id));

    expect(filter).toEqual({
      $or: [
        { createdAt: { $lt: createdAt } },
        { createdAt, _id: { $lt: id } },
      ],
    });
  });

  it("rejects malformed cursors with a client error", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrowError(
      expect.objectContaining({ statusCode: 400, code: "INVALID_CURSOR" }),
    );
  });
});
