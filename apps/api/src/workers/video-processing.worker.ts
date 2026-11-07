import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { config, getRedisConnectionOptions } from "@nerloq/config";
import {
  connectDatabase,
  disconnectDatabase,
} from "../infrastructure/database.js";
import {
  VideoModel,
  type VideoRecord,
} from "../infrastructure/models/video.js";
import {
  deleteMediaFile,
  getMediaStream,
  uploadMediaFile,
} from "../infrastructure/storage/media-storage.js";
import {
  VIDEO_PROCESSING_QUEUE,
  type VideoProcessingJobData,
} from "../features/videos/video-processing-queue.js";

const VIDEO_HEIGHTS = [
  { height: 360, bandwidth: 650000 },
  { height: 480, bandwidth: 1100000 },
  { height: 720, bandwidth: 2500000 },
  { height: 1080, bandwidth: 4500000 },
];

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.FFMPEG_BINARY, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-12000);
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `FFmpeg exited with code ${code}: ${stderr.slice(-5000)}`,
          ),
        );
      }
    });
  });
}

async function downloadOriginal(
  video: VideoRecord,
  destination: string,
): Promise<void> {
  const keys =
    video.mediaSegments?.length > 0
      ? video.mediaSegments
      : [video.mediaKey];

  for (const key of keys) {
    const body = await getMediaStream(key);

    await pipeline(
      Readable.from(body as AsyncIterable<Uint8Array>),
      createWriteStream(destination, {
        flags: "a",
        mode: 0o600,
      }),
    );
  }
}

async function uploadDirectory(
  directory: string,
  prefix: string,
  uploadedKeys: string[],
): Promise<void> {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      await uploadDirectory(
        path,
        `${prefix}/${entry.name}`,
        uploadedKeys,
      );
      continue;
    }

    if (!entry.isFile()) continue;

    const extension = entry.name.split(".").pop()?.toLowerCase();

    const contentType =
      extension === "m3u8"
        ? "application/vnd.apple.mpegurl"
        : extension === "ts"
          ? "video/mp2t"
          : "application/octet-stream";

    const key = `${prefix}/${entry.name}`;

    await uploadMediaFile(key, path, contentType);
    uploadedKeys.push(key);
  }
}

async function processVideo(
  job: Job<VideoProcessingJobData>,
): Promise<void> {
  const videoId = job.data.videoId;

  const video = await VideoModel.findById(videoId);

  if (!video) {
    throw new Error(`Video ${videoId} does not exist.`);
  }

  if (video.status !== "published") {
    return;
  }

  await VideoModel.updateOne(
    { _id: video._id },
    {
      $set: {
        processingStatus: "processing",
      },
    },
  );

  const workDir = await mkdtemp(
    join(tmpdir(), "nerloq-video-"),
  );

  const uploadedKeys: string[] = [];
  const sourcePath = join(workDir, "original-video");
  const hlsRoot = join(workDir, "hls");

  const manifestKey = `${videoId}/hls/master.m3u8`;

  try {
    await job.updateProgress(5);

    await downloadOriginal(video, sourcePath);

    await job.updateProgress(25);

    const sourceHeight = video.mediaHeight ?? 720;

    const renditions = VIDEO_HEIGHTS.filter(
      (item) => item.height <= sourceHeight,
    );

    if (renditions.length === 0) {
      renditions.push({
        height: Math.max(240, sourceHeight),
        bandwidth: 500000,
      });
    }

    const masterEntries: string[] = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
    ];

    await mkdir(hlsRoot, { recursive: true });

    for (let index = 0; index < renditions.length; index++) {
      const rendition = renditions[index]!;
      const folder = `v${rendition.height}`;
      const outputDir = join(hlsRoot, folder);

      await mkdir(outputDir, { recursive: true });

      const playlistPath = join(outputDir, "index.m3u8");
      const segmentPattern = join(
        outputDir,
        "segment_%05d.ts",
      );

      await runFfmpeg([
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", sourcePath,
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-vf",
        `scale=-2:min(${rendition.height}\\,ih)`,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-profile:v", "main",
        "-sc_threshold", "0",
        "-g", "48",
        "-keyint_min", "48",
        "-c:a", "aac",
        "-b:a", "96k",
        "-ac", "2",
        "-ar", "48000",
        "-f", "hls",
        "-hls_time", "4",
        "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments",
        "-hls_segment_filename", segmentPattern,
        playlistPath,
      ]);

      const width = video.mediaWidth ?? 1280;
      const height = video.mediaHeight ?? rendition.height;

      const outputHeight = Math.min(
        rendition.height,
        height,
      );

      const outputWidth = Math.max(
        2,
        Math.floor(
          (width * outputHeight / height) / 2,
        ) * 2,
      );

      masterEntries.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bandwidth},RESOLUTION=${outputWidth}x${outputHeight}`,
        `${folder}/index.m3u8`,
      );

      await job.updateProgress(
        25 + Math.round(
          ((index + 1) / renditions.length) * 50,
        ),
      );
    }

    const masterPath = join(hlsRoot, "master.m3u8");

    await writeFile(
      masterPath,
      `${masterEntries.join("\n")}\n`,
      "utf8",
    );

    await uploadDirectory(
      hlsRoot,
      `${videoId}/hls`,
      uploadedKeys,
    );

    await job.updateProgress(95);

    await VideoModel.updateOne(
      { _id: video._id },
      {
        $set: {
          playbackManifestKey: manifestKey,
          processingStatus: "ready",
        },
      },
    );

    await job.updateProgress(100);
  } catch (error) {
    for (const key of uploadedKeys) {
      await deleteMediaFile(key).catch((cleanupError: unknown) => {
        console.error(
          "Could not clean incomplete HLS object:",
          key,
          cleanupError,
        );
      });
    }

    const attempts = job.opts.attempts ?? 1;
    const finalAttempt = job.attemptsMade + 1 >= attempts;

    await VideoModel.updateOne(
      { _id: video._id },
      {
        $set: {
          processingStatus: finalAttempt
            ? "failed"
            : "pending",
          playbackManifestKey: null,
        },
      },
    );

    throw error;
  } finally {
    await rm(workDir, {
      recursive: true,
      force: true,
    });
  }
}

async function startWorker(): Promise<void> {
  await connectDatabase();

  const { url } = getRedisConnectionOptions();

  const redis = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  const worker = new Worker<VideoProcessingJobData>(
    VIDEO_PROCESSING_QUEUE,
    processVideo,
    {
      connection: redis,
      concurrency: 1,
    },
  );

  worker.on("completed", (job) => {
    console.info(
      "Video processing completed:",
      job.data.videoId,
    );
  });

  worker.on("failed", (job, error) => {
    console.error(
      "Video processing attempt failed:",
      job?.data.videoId,
      error,
    );
  });

  console.info("NERLOQ video processing worker started.");

  const shutdown = async () => {
    await worker.close();
    await redis.quit();
    await disconnectDatabase();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

startWorker().catch((error: unknown) => {
  console.error("Could not start video processing worker:", error);
  process.exitCode = 1;
});
