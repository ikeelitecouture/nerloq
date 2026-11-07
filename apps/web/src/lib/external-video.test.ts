import { describe, expect, it } from "vitest";
import { resolveExternalVideoEmbed } from "./external-video.js";

describe("resolveExternalVideoEmbed", () => {
  it("supports standard and short YouTube URLs", () => {
    expect(resolveExternalVideoEmbed("https://www.youtube.com/watch?v=abcdefghijk")?.embedUrl)
      .toBe("https://www.youtube-nocookie.com/embed/abcdefghijk");
    expect(resolveExternalVideoEmbed("https://youtu.be/abcdefghijk?t=10")?.provider)
      .toBe("youtube");
  });

  it("supports YouTube Shorts and Vimeo player URLs", () => {
    expect(resolveExternalVideoEmbed("https://youtube.com/shorts/abcdefghijk")?.provider)
      .toBe("youtube");
    expect(resolveExternalVideoEmbed("https://vimeo.com/123456789")?.embedUrl)
      .toBe("https://player.vimeo.com/video/123456789");
  });

  it("does not embed arbitrary or malformed URLs", () => {
    expect(resolveExternalVideoEmbed("https://example.com/video.mp4")).toBeNull();
    expect(resolveExternalVideoEmbed("javascript:alert(1)")).toBeNull();
    expect(resolveExternalVideoEmbed("https://youtube.com/watch?v=bad")).toBeNull();
    expect(resolveExternalVideoEmbed("https://youtube.com.evil.example/watch?v=abcdefghijk")).toBeNull();
    expect(resolveExternalVideoEmbed("https://user:pass@vimeo.com/123456")).toBeNull();
  });
});
