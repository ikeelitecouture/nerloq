from pathlib import Path
from datetime import datetime
import re
import sys

root = Path.cwd()
p = root / "apps/api/src/features/videos/routes.ts"
original = p.read_text()
s = original

def one(old, new, label):
    global s
    n = s.count(old)
    if n != 1:
        raise ValueError(f"STOP: {label}: expected 1 match, found {n}. No source changes made.")
    s = s.replace(old, new, 1)

one(
    'import { decodeCursor, encodeCursor } from "../../infrastructure/pagination.js";',
    '''import { decodeCursor, encodeCursor } from "../../infrastructure/pagination.js";
import { deleteMediaFile, getMediaInfo, getMediaStream, uploadMediaFile } from "../../infrastructure/storage/media-storage.js";''',
    "imports"
)

one(
    '    if (config.MEDIA_STORAGE_PROVIDER !== "local") return fail(reply, 503, "MEDIA_PROVIDER_UNAVAILABLE", "The configured media provider does not have an upload adapter enabled.", request.id);\n',
    "",
    "cloud upload guard"
)

one(
    '    let thumbnailMimeType: string | null = null;\n',
    '    let thumbnailMimeType: string | null = null;\n'
    '    const uploadedCloudKeys: string[] = [];\n'
    '    const useCloudStorage = config.MEDIA_STORAGE_PROVIDER !== "local";\n',
    "cloud tracking"
)

one(
    '      const checksumHex = checksum.digest("hex");\n'
    '      const video = await VideoModel.create({ creatorId: userId, caption, hashtags: toHashtags(caption), mediaKey: `${mediaKey}${storedPath.endsWith(".webm") ? ".webm" : storedPath.endsWith(".mov") ? ".mov" : ".mp4"}`, mimeType, mediaSizeBytes: byteSize, mediaWidth, mediaHeight, checksum: checksumHex, durationMs, thumbnailKey, thumbnailMimeType, privacy, commentsAllowed, allowDownloads, status: "published" });',
    '''      const checksumHex = checksum.digest("hex");
      const finalMediaKey = `${mediaKey}${storedPath.endsWith(".webm") ? ".webm" : storedPath.endsWith(".mov") ? ".mov" : ".mp4"}`;

      if (useCloudStorage) {
        await uploadMediaFile(finalMediaKey, storedPath, mimeType);
        uploadedCloudKeys.push(finalMediaKey);
        if (thumbnailKey && thumbnailStoredPath && thumbnailMimeType) {
          await uploadMediaFile(thumbnailKey, thumbnailStoredPath, thumbnailMimeType);
          uploadedCloudKeys.push(thumbnailKey);
        }
      }

      const video = await VideoModel.create({ creatorId: userId, caption, hashtags: toHashtags(caption), mediaKey: finalMediaKey, mimeType, mediaSizeBytes: byteSize, mediaWidth, mediaHeight, checksum: checksumHex, durationMs, thumbnailKey, thumbnailMimeType, privacy, commentsAllowed, allowDownloads, status: "published" });''',
    "upload logic"
)

one(
    '     } catch (error) {\n'
    '       if (createdVideoId) await VideoModel.deleteOne({ _id: createdVideoId }).catch((cleanupError: unknown) => request.log.error({ err: cleanupError, videoId: createdVideoId }, "Video record cleanup failed after upload error"));',
    '''     } catch (error) {
       for (const key of uploadedCloudKeys) {
         await deleteMediaFile(key).catch((cleanupError: unknown) =>
           request.log.error({ err: cleanupError, key }, "Cloud media cleanup failed after upload error"),
         );
       }
       if (createdVideoId) await VideoModel.deleteOne({ _id: createdVideoId }).catch((cleanupError: unknown) => request.log.error({ err: cleanupError, videoId: createdVideoId }, "Video record cleanup failed after upload error"));''',
    "rollback cleanup"
)

one(
    '     const cleanup: Promise<unknown>[] = [unlink(mediaPath(video.mediaKey)), VideoReactionModel.deleteMany({ videoId }), CommentModel.deleteMany({ videoId }), UserModel.updateOne({ _id: userId, videoCount: { $gt: 0 } }, { $inc: { videoCount: -1 } })];\n'
    '     if (video.thumbnailKey) cleanup.push(unlink(mediaPath(video.thumbnailKey)));',
    '''     const removeMedia = (key: string) =>
       config.MEDIA_STORAGE_PROVIDER === "local" ? unlink(mediaPath(key)) : deleteMediaFile(key);
     const cleanup: Promise<unknown>[] = [
       removeMedia(video.mediaKey),
       VideoReactionModel.deleteMany({ videoId }),
       CommentModel.deleteMany({ videoId }),
       UserModel.updateOne({ _id: userId, videoCount: { $gt: 0 } }, { $inc: { videoCount: -1 } }),
     ];
     if (video.thumbnailKey) cleanup.push(removeMedia(video.thumbnailKey));''',
    "delete logic"
)

thumb = re.compile(r'   app\.get\("/media/:videoId/thumbnail", async \(request, reply\) => \{.*?\n  \}\);\n', re.S)
m = list(thumb.finditer(s))
if len(m) != 1:
    raise ValueError(f"STOP: thumbnail route match count {len(m)}. No source changes made.")

thumb_new = '''  app.get("/media/:videoId/thumbnail", async (request, reply) => {
    const { videoId } = request.params as { videoId: string };
    if (!publicId(videoId)) return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
    const viewerId = await authenticate(request, { rejectInvalidCredential: false });
    const video = await VideoModel.findById(videoId);
    if (!video || !video.thumbnailKey || !video.thumbnailMimeType || !(await canView(video, viewerId))) {
      return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
    }
    try {
      const cache = video.privacy === "public" ? "public, max-age=3600" : "private, no-store";
      if (config.MEDIA_STORAGE_PROVIDER === "local") {
        const path = mediaPath(video.thumbnailKey);
        const info = await stat(path);
        return reply.type(video.thumbnailMimeType).header("Content-Length", String(info.size))
          .header("Cache-Control", cache).header("Vary", "Cookie")
          .header("X-Content-Type-Options", "nosniff").send(createReadStream(path));
      }
      const info = await getMediaInfo(video.thumbnailKey);
      const stream = await getMediaStream(video.thumbnailKey);
      return reply.type(video.thumbnailMimeType).header("Content-Length", String(info.size))
        .header("Cache-Control", cache).header("Vary", "Cookie")
        .header("X-Content-Type-Options", "nosniff").send(stream);
    } catch {
      return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
    }
  });
'''
s = s[:m[0].start()] + thumb_new + s[m[0].end():]

media = re.compile(r'   app\.get\("/media/:videoId", async \(request, reply\) => \{.*?\n  \}\);\n(?=\n  for \(const kind of \["like", "save", "repost"\])', re.S)
m = list(media.finditer(s))
if len(m) != 1:
    raise ValueError(f"STOP: media stream route match count {len(m)}. No source changes made.")

media_new = r'''  app.get("/media/:videoId", async (request, reply) => {
    const { videoId } = request.params as { videoId: string };
    if (!publicId(videoId)) return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
    const viewerId = await authenticate(request, { rejectInvalidCredential: false });
    const video = await VideoModel.findById(videoId);
    if (!video || !(await canView(video, viewerId))) return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);

    const local = config.MEDIA_STORAGE_PROVIDER === "local";
    const path = local ? mediaPath(video.mediaKey) : "";
    try {
      const info = local ? await stat(path) : await getMediaInfo(video.mediaKey);
      const range = request.headers.range;
      const cache = video.privacy === "public" ? "public, max-age=3600" : "private, no-store";

      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
        const start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2] || 0));
        let end = match[2] && match[1] ? Number(match[2]) : info.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= info.size) {
          return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
        }
        end = Math.min(end, info.size - 1);
        const stream = local ? createReadStream(path, { start, end }) : await getMediaStream(video.mediaKey, { start, end });
        return reply.code(206).type(video.mimeType).header("Accept-Ranges", "bytes")
          .header("Content-Range", `bytes ${start}-${end}/${info.size}`)
          .header("Content-Length", String(end - start + 1)).header("Cache-Control", cache)
          .header("Vary", "Cookie").header("X-Content-Type-Options", "nosniff").send(stream);
      }

      const stream = local ? createReadStream(path) : await getMediaStream(video.mediaKey);
      return reply.type(video.mimeType).header("Accept-Ranges", "bytes")
        .header("Content-Length", String(info.size)).header("Cache-Control", cache)
        .header("Vary", "Cookie").header("X-Content-Type-Options", "nosniff").send(stream);
    } catch {
      return fail(reply, 404, "MEDIA_UNAVAILABLE", "Media is unavailable.", request.id);
    }
  });
'''
s = s[:m[0].start()] + media_new + s[m[0].end():]

if s == original:
    sys.exit("STOP: No changes produced.")

backup_dir = root / ".backups"
backup_dir.mkdir(exist_ok=True)
backup = backup_dir / f"video-routes-before-cloud-{datetime.now():%Y%m%d-%H%M%S}.ts"
backup.write_text(original)
p.write_text(s)
print("PASS: Cloud storage routes patched.")
print("Backup:", backup)
print("Changed only:", p.relative_to(root))
