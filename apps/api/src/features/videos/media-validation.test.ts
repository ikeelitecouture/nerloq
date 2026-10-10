import { describe, expect, it } from "vitest";
import { isSafeCoverImage, isSupportedVideoContent } from "./media-validation.js";

function png(width: number, height: number): Buffer {
  const data = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  data.writeUInt32BE(width, 16); data.writeUInt32BE(height, 20);
  return data;
}
function jpeg(width: number, height: number): Buffer {
  const data = Buffer.alloc(15);
  data.set([0xff, 0xd8, 0xff, 0xc0]); data.writeUInt16BE(11, 4);
  data[6] = 8; data.writeUInt16BE(height, 7); data.writeUInt16BE(width, 9); data[11] = 3;
  return data;
}
function webp(width: number, height: number): Buffer {
  const data = Buffer.alloc(30);
  data.write("RIFF", 0); data.write("WEBP", 8); data.write("VP8X", 12);
  data.writeUIntLE(width - 1, 24, 3); data.writeUIntLE(height - 1, 27, 3);
  return data;
}

describe("video and cover file validation", () => {
  it("checks MP4, QuickTime, and WebM container signatures", () => {
    const mp4 = Buffer.alloc(12); mp4.write("ftyp", 4);
    expect(isSupportedVideoContent("video/mp4", mp4)).toBe(true);
    expect(isSupportedVideoContent("video/quicktime", mp4)).toBe(true);
    expect(isSupportedVideoContent("video/webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true);
    expect(isSupportedVideoContent("video/mp4", Buffer.from("not a video"))).toBe(false);
    expect(isSupportedVideoContent("video/avi", mp4)).toBe(false);
  });

  it("accepts correctly signed cover images within the dimension limit", () => {
    expect(isSafeCoverImage("image/png", png(640, 360))).toBe(true);
    expect(isSafeCoverImage("image/jpeg", jpeg(640, 360))).toBe(true);
    expect(isSafeCoverImage("image/webp", webp(640, 360))).toBe(true);
  });

  it("rejects mismatched image types, missing dimensions, and oversized images", () => {
    expect(isSafeCoverImage("image/png", jpeg(640, 360))).toBe(false);
    expect(isSafeCoverImage("image/webp", Buffer.from("RIFF----WEBPbad"))).toBe(false);
    expect(isSafeCoverImage("image/png", png(8192, 4320))).toBe(false);
    expect(isSafeCoverImage("image/png", png(0, 360))).toBe(false);
  });
});
