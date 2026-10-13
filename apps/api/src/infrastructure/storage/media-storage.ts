import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "@nerloq/config";

const cloudProvider = config.MEDIA_STORAGE_PROVIDER !== "local";

const client = cloudProvider
  ? new S3Client({
      region: config.MEDIA_STORAGE_REGION,
      ...(config.MEDIA_STORAGE_ENDPOINT
        ? { endpoint: config.MEDIA_STORAGE_ENDPOINT }
        : {}),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.MEDIA_STORAGE_ACCESS_KEY!,
        secretAccessKey: config.MEDIA_STORAGE_SECRET_KEY!,
      },
    })
  : null;

function requireCloud() {
  if (!client) {
    throw new Error("Cloud media storage is not configured.");
  }
  return client;
}

export async function uploadMediaFile(
  key: string,
  filePath: string,
  contentType: string,
): Promise<number> {
  const file = await stat(filePath);

  if (!file.isFile() || file.size < 1) {
    throw new Error("Cannot upload an empty media file.");
  }

  await requireCloud().send(
    new PutObjectCommand({
      Bucket: config.MEDIA_STORAGE_BUCKET,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: file.size,
      ContentType: contentType,
    }),
  );

  return file.size;
}

export async function getMediaInfo(key: string): Promise<{
  size: number;
  contentType?: string;
}> {
  const result = await requireCloud().send(
    new HeadObjectCommand({
      Bucket: config.MEDIA_STORAGE_BUCKET,
      Key: key,
    }),
  );

  if (typeof result.ContentLength !== "number") {
    throw new Error("Media size is unavailable.");
  }

  return {
    size: result.ContentLength,
    ...(result.ContentType ? { contentType: result.ContentType } : {}),
  };
}

export async function getMediaStream(
  key: string,
  range?: { start: number; end: number },
) {
  const result = await requireCloud().send(
    new GetObjectCommand({
      Bucket: config.MEDIA_STORAGE_BUCKET,
      Key: key,
      ...(range
        ? { Range: `bytes=${range.start}-${range.end}` }
        : {}),
    }),
  );

  if (!result.Body) {
    throw new Error("Media content is unavailable.");
  }

  return result.Body;
}

export async function deleteMediaFile(key: string): Promise<void> {
  await requireCloud().send(
    new DeleteObjectCommand({
      Bucket: config.MEDIA_STORAGE_BUCKET,
      Key: key,
    }),
  );
}
