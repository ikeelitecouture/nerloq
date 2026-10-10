import { describe, expect, it } from "vitest";
import { registerSchema, updateProfileSchema } from "./index.js";

describe("account boundary validation", () => {
  it("normalizes email and username before persistence", () => {
    const result = registerSchema.parse({
      email: "  CREATOR@Example.com ",
      username: " Video.Maker ",
      displayName: "  Video Maker  ",
      password: "A strong password!42",
    });
    expect(result.email).toBe("creator@example.com");
    expect(result.username).toBe("video.maker");
    expect(result.displayName).toBe("Video Maker");
  });

  it("rejects weak credentials and unknown registration fields", () => {
    expect(registerSchema.safeParse({ email: "a@example.com", username: "ab", displayName: "A", password: "password", role: "administrator" }).success).toBe(false);
  });

  it("requires at least one valid profile edit", () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.safeParse({ bio: "A good day to make something." }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ websiteUrl: "not a url" }).success).toBe(false);
  });
});
