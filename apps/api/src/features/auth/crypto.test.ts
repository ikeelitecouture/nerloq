import { describe, expect, it } from "vitest";
import { createRefreshToken, hashPassword, hashRefreshToken, verifyPassword } from "./crypto.js";

describe("authentication cryptography", () => {
  it("stores a salted password hash and verifies only the matching password", async () => {
    const encoded = await hashPassword("A long password!42");
    expect(encoded).not.toContain("A long password!42");
    expect(await verifyPassword("A long password!42", encoded)).toBe(true);
    expect(await verifyPassword("A different password!42", encoded)).toBe(false);
  });

  it("rejects malformed password hashes safely", async () => {
    await expect(verifyPassword("password", "invalid")).resolves.toBe(false);
    await expect(verifyPassword("password", "scrypt$salt$short")).resolves.toBe(false);
  });

  it("creates high-entropy opaque refresh tokens and deterministic non-reversible lookup hashes", () => {
    const first = createRefreshToken();
    const second = createRefreshToken();
    expect(first).not.toBe(second);
    expect(first).not.toContain(".");
    expect(hashRefreshToken(first, "test-secret")).toHaveLength(64);
    expect(hashRefreshToken(first, "test-secret")).toBe(hashRefreshToken(first, "test-secret"));
    expect(hashRefreshToken(first, "test-secret")).not.toBe(first);
  });
});
