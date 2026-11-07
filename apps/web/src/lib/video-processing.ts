const COVER_WIDTH = 640;
const COVER_HEIGHT = 360;
const COVER_QUALITY = 0.82;
const MAX_COVER_BYTES = 512 * 1024;

function canvasFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    const qualities = [COVER_QUALITY, 0.68, 0.54, 0.42];
    const encode = (index: number) => canvas.toBlob(blob => {
      if (!blob) { reject(new Error("This browser could not prepare a cover image.")); return; }
      if (blob.size > MAX_COVER_BYTES && index + 1 < qualities.length) { encode(index + 1); return; }
      if (blob.size > MAX_COVER_BYTES) { reject(new Error("The cover image could not be compressed below 512 KB.")); return; }
      const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
      resolve(new File([blob], `${name}.${extension}`, { type: blob.type, lastModified: Date.now() }));
    }, "image/webp", qualities[index]);
    encode(0);
  });
}

function drawCover(source: CanvasImageSource, width: number, height: number, name: string): Promise<File> {
  if (width < 1 || height < 1) return Promise.reject(new Error("The selected media has no readable image frame."));
  const canvas = document.createElement("canvas");
  canvas.width = COVER_WIDTH;
  canvas.height = COVER_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return Promise.reject(new Error("This browser could not prepare a cover image."));
  const scale = Math.max(COVER_WIDTH / width, COVER_HEIGHT / height);
  const cropWidth = COVER_WIDTH / scale;
  const cropHeight = COVER_HEIGHT / scale;
  const sx = (width - cropWidth) / 2;
  const sy = (height - cropHeight) / 2;
  context.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, COVER_WIDTH, COVER_HEIGHT);
  return canvasFile(canvas, name.replace(/\.[^.]+$/, ""));
}

export async function createVideoCover(file: File, timeSeconds = 1): Promise<File> {
  const video = document.createElement("video");
  const sourceUrl = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Video details took too long to load.")), 15_000);
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => { window.clearTimeout(timer); reject(new Error("This browser could not read the video frame.")); };
      video.src = sourceUrl;
      video.load();
    });
    if (video.readyState < 2) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("The video frame could not be prepared.")), 10_000);
        video.onloadeddata = () => { window.clearTimeout(timer); resolve(); };
        video.onerror = () => { window.clearTimeout(timer); reject(new Error("The video frame could not be prepared.")); };
      });
    }
    if (video.duration > 0.2) {
      const seekTo = Math.min(Math.max(timeSeconds, 0), video.duration - 0.05);
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("The video frame could not be prepared.")), 10_000);
        video.onseeked = () => { window.clearTimeout(timer); resolve(); };
        video.onerror = () => { window.clearTimeout(timer); reject(new Error("The video frame could not be prepared.")); };
        video.currentTime = seekTo;
      });
    }
    return await drawCover(video, video.videoWidth, video.videoHeight, file.name);
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function normalizeCoverImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file for the video cover.");
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    return await drawCover(bitmap, bitmap.width, bitmap.height, file.name);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("The selected cover image could not be read.");
  } finally {
    bitmap?.close();
  }
}
