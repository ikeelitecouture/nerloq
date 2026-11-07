# NERLOQ media and playback audit

## Findings from the supplied source archive

- Cloud media is stored through the S3-compatible `MEDIA_STORAGE_*` configuration. Uploads set `ContentType`, and the database records the MIME type used by playback.
- The project uses authenticated API media routes (`/api/v1/media/:videoId` and `/api/v1/media-assets/:assetId`) rather than direct public bucket URLs or signed URLs. `CDN_BASE_URL` is currently configuration-only and is not used to produce playback URLs. This preserves private/follower visibility checks. The S3 bucket therefore does not need public-read access for this design.
- Byte-range playback is implemented for both video posts and media assets. The API returns `206`, `Content-Range`, `Content-Length`, and `Accept-Ranges` for valid single ranges. Multi-range requests are not supported, which is normal for HTML video playback.
- API CORS already allows credentialed requests from configured origins. The API now exposes range and content headers for cross-origin clients. The storage bucket's CORS policy is not used by this server-proxy design because browsers do not fetch objects directly from S3.
- Resumable media uploads support JPEG, PNG, WebP, MP4, MOV, and WebM, with content-signature checks. The `/videos` publish route accepts MP4, MOV, and WebM plus an optional image cover.
- Before this update, a thumbnail was only available when the browser supplied a cover. The API now generates a JPEG poster with FFmpeg when a video upload omits one.
- Before this update, cloud retrieval errors were flattened into `404 MEDIA_UNAVAILABLE`. The video and thumbnail routes now log the underlying error and distinguish missing objects (`404`) from storage/provider failures (`503`).
- YouTube and Vimeo URLs found in video captions are now parsed against strict provider hostnames and ID formats and rendered with provider-owned HTTPS embed URLs. Other arbitrary URLs are not converted into iframes or downloaded.
- The source does not currently transcode uploaded videos into a normalized H.264/AAC MP4 rendition. It stores the original file after metadata and signature validation. A valid MP4 container can still contain a codec unsupported by a particular device; production transcoding remains a recommended deployment task.
- The source returns API-relative media URLs. `VITE_API_BASE_URL` must point to the reachable API origin (or a correctly configured reverse proxy). If it is unset, the client defaults to `/api/v1` on the web origin. The included `netlify.toml` has only an SPA fallback and no `/api/*` proxy, so a Netlify-only deployment must explicitly configure the API URL or add a suitable proxy. Do not route large video streams through a serverless function unless its body/response limits and range behavior have been verified.

## Bucket configuration issue found

The included local `.env` set `MEDIA_STORAGE_BUCKET` to `nerloq bucket` (contains a space), while the requested bucket name is `nerloq-bucket`. S3 bucket names cannot contain spaces. The sanitized `.env.example` now uses `nerloq-bucket`; confirm that this exact bucket exists in the storage provider and set the matching endpoint, region, and credentials in the deployment environment.

## Live checks not performed

This archive does not grant authenticated access to the Supabase project dashboard or a safe live object listing. Therefore the following are not claimed as verified: whether `nerloq-bucket` exists, whether the S3 keys have `ListBucket`/`GetObject`/`PutObject`/`DeleteObject` rights, whether stored objects are present under the exact keys in MongoDB, the provider's live CORS/policy configuration, or whether a deployed CDN/reverse proxy forwards `Range` correctly. Test these against the actual deployment with a known video ID and a second device.

Suggested production checks:
1. Confirm bucket ID is exactly `nerloq-bucket` and credentials are S3-compatible service credentials for that project.
2. From the API host, `HeadObject` a known database `mediaKey`; compare `ContentLength` and `ContentType` with the MongoDB record.
3. Request `GET /api/v1/media/<videoId>` with `Range: bytes=0-1`; expect `206`, `Content-Range: bytes 0-1/<size>`, `Content-Length: 2`, and `Accept-Ranges: bytes`.
4. Repeat through the public API/CDN hostname, not just localhost. Confirm cookies/authorization and CORS origins match the deployed web origin.
5. Verify the frontend build has `VITE_API_BASE_URL` set to the public API base, e.g. `https://api.example.com/api/v1`.
6. Add a production FFmpeg transcode worker if uploads must play consistently across older/mobile devices. Keep originals and publish a normalized H.264/AAC MP4 rendition after successful processing.

## Security action required

The supplied ZIP contained live-looking credentials in `.env`, `apps/api/.env`, and backup environment files. Those files are excluded from the corrected ZIP. Treat every credential in the supplied archive as exposed and rotate the MongoDB credentials, Redis password/URL, Supabase S3 access key and secret, JWT access/refresh secrets, and any third-party API key found in those files. Then update the production secret store. Do not copy the old `.env` back into the project.

## Validation performed in this workspace

- Manually exercised seven external-video URL cases (YouTube watch/shorts/short-link, Vimeo, malformed/unsupported URLs); all returned the expected embed/no-embed result.
- Ran `ffprobe` against the archive's sample MP4 and confirmed H.264 video metadata (1080×1440, 20.55 seconds).
- Ran the new FFmpeg thumbnail command against that sample; it generated a JPEG poster successfully.
- The full workspace dependency install (`npm ci`) timed out in this environment. Consequently the complete Vitest suite, TypeScript workspace checks, lint, and production build could not be run here. The new Vitest cases are included in the source ZIP but are not represented as passed.
