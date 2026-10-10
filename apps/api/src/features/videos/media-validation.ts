export function isSupportedVideoContent(type: string, signature: Buffer): boolean {
  if (type === "video/mp4" || type === "video/quicktime") return signature.length >= 8 && signature.toString("ascii", 4, 8) === "ftyp";
  if (type === "video/webm") return signature.length >= 4 && signature[0] === 0x1a && signature[1] === 0x45 && signature[2] === 0xdf && signature[3] === 0xa3;
  return false;
}

function isValidImageSignature(type: string, signature: Buffer): boolean {
  if (type === "image/jpeg") return signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
  if (type === "image/png") return signature.length >= 8 && signature.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/webp") return signature.length >= 12 && signature.toString("ascii", 0, 4) === "RIFF" && signature.toString("ascii", 8, 12) === "WEBP";
  return false;
}

function readImageDimensions(type: string, data: Buffer): { width: number; height: number } | null {
  if (type === "image/png" && data.length >= 24) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (type === "image/jpeg" && data.length >= 4) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) { offset += 1; continue; }
      const marker = data[offset + 1];
      if (marker === undefined) break;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const segmentLength = data.readUInt16BE(offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > data.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      offset += 2 + segmentLength;
    }
  }
  if (type === "image/webp" && data.length >= 30) {
    const chunk = data.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
    if (chunk === "VP8L" && data[21] === 0x2f) {
      const b1 = data[22] ?? 0; const b2 = data[23] ?? 0; const b3 = data[24] ?? 0; const b4 = data[25] ?? 0;
      return { width: 1 + b1 + ((b2 & 0x3f) << 8), height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10) };
    }
    if (chunk === "VP8 " && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

export function isSafeCoverImage(type: string, data: Buffer): boolean {
  if (!isValidImageSignature(type, data)) return false;
  const dimensions = readImageDimensions(type, data);
  return !!dimensions && dimensions.width >= 1 && dimensions.height >= 1 && dimensions.width <= 2048 && dimensions.height <= 2048;
}

export async function inspectVideoMetadata(
  binary: string,
  path: string,
): Promise<{ durationMs: number; width: number; height: number }> {
  let stdout: string;
  try {
    ({ stdout } = await execFile(binary, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:format=duration",
      "-of", "json",
      path,
    ], { maxBuffer: 64 * 1024, timeout: 15_000 }));
  } catch (error) {
    const processCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
    const temporarilyUnavailable = processCode === "ENOENT" || processCode === "ETIMEDOUT" || processCode === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    throw Object.assign(new Error(temporarilyUnavailable ? "Video metadata inspection is unavailable." : "Video metadata could not be inspected."), {
      statusCode: temporarilyUnavailable ? 503 : 422,
      code: temporarilyUnavailable ? "MEDIA_METADATA_UNAVAILABLE" : "INVALID_MEDIA_METADATA",
    });
  }

  try {
    const result = JSON.parse(stdout) as {
      readonly streams?: readonly [{ readonly width?: number; readonly height?: number }?];
      readonly format?: { readonly duration?: string };
    };
    const stream = result.streams?.[0];
    const durationMs = Math.round(Number(result.format?.duration) * 1000);
    const width = Number(stream?.width);
    const height = Number(stream?.height);
    if (!Number.isSafeInteger(durationMs) || durationMs < 1 || !Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
      throw new Error("invalid metadata");
    }
    return { durationMs, width, height };
  } catch {
    throw Object.assign(new Error("The uploaded video has invalid media metadata."), {
      statusCode: 422,
      code: "INVALID_MEDIA_METADATA",
    });
  }
}
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
