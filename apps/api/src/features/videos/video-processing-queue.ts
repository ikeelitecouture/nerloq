import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { getRedisConnectionOptions } from "@nerloq/config";

export const VIDEO_PROCESSING_QUEUE = "nerloq-video-processing";

export interface VideoProcessingJobData {
  videoId: string;
}

let queue: Queue<VideoProcessingJobData> | null = null;
let redis: Redis | null = null;

function getQueue(): Queue<VideoProcessingJobData> {
  if (queue) return queue;

  const { url } = getRedisConnectionOptions();

  redis = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(attempt: number) {
      return Math.min(attempt * 500, 5000);
    },
  });

  queue = new Queue<VideoProcessingJobData>(
    VIDEO_PROCESSING_QUEUE,
    {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: {
          age: 86400,
          count: 1000,
        },
        removeOnFail: {
          age: 604800,
          count: 2000,
        },
      },
    },
  );

  return queue;
}

export async function enqueueVideoProcessing(
  videoId: string,
): Promise<void> {
  await getQueue().add(
    "process-video",
    { videoId },
    {
      jobId: `video-${videoId}`,
    },
  );
}

export async function closeVideoProcessingQueue(): Promise<void> {
  const currentQueue = queue;
  const currentRedis = redis;

  queue = null;
  redis = null;

  if (currentQueue) {
    await currentQueue.close();
  }

  if (currentRedis && currentRedis.status !== "end") {
    await currentRedis.quit();
  }
}
