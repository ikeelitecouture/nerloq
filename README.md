# NERLOQ

**Create. Connect. Discover.** NERLOQ is a video-first social platform. The repository is an active product foundation, not yet a public-ready social network.

## Requirements

- Node.js 22.12 or newer and npm 10 or newer.
- MongoDB 6+ for the API. Redis is optional in local development (`REDIS_REQUIRED=false`) and required for production/staging by default.
- Android/Termux works with the JavaScript dependency set; password hashing uses Node async scrypt.

## Local development

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`; replace the two JWT secrets with independent random values of at least 32 characters. Keep `.env` private.
3. Start MongoDB. Start Redis if you enable it locally; the current product services continue without Redis when `REDIS_REQUIRED=false`.
4. Run `npm run dev`. The web client listens on port 5173 and proxies `/api` to the API on port 5000. Set `API_PROXY_TARGET` when the API runs elsewhere.
5. Run `npm run typecheck`, `npm run build`, and `npm run test` to verify the workspaces.

The development API reads the root `.env`. Production deployments need TLS, secure cookies, explicit origins, secret management, backups, monitoring and a managed database topology.

## What works today

- Account registration, login, session refresh, logout, and profile editing use the Fastify API and MongoDB.
- The authenticated web workspace has responsive routes for For You, Following, Discover, Inbox, Activity, Create, Creator Studio, Settings and Profile.
- Video upload validates the container signature, MIME type, configured size and browser-extracted duration. The browser prepares a cropped 16:9 cover frame (or normalizes a user-selected cover) without a native dependency; the API stores and access-controls that image alongside the source. Video files are stored locally under `var/media/`, with private-media checks and byte-range playback. There is no transcoding or HLS output yet.
- The API supports chronological For You and Following feeds, video likes/saves/reposts/shares/views, comments/replies, creator profile pages, search for creators/videos/hashtags, public hashtag pages, follow/unfollow, private-profile requests, block/mute, video reports, settings, creator lifetime counters and a persistent notification center for likes, reposts, comments/replies and follows with unread counts, preference filtering and read receipts. Direct conversations use persisted messages, privacy-controlled requests, accept/decline, unread/read state, message removal, typing indicators, presence, session-authenticated Socket.IO delivery, and polling fallback.
- Password recovery uses one-time hashed tokens and revokes active sessions. Development `EMAIL_PROVIDER=console` logs a reset URL; staging/production require Resend or SendGrid. Email verification is not implemented.
- The supplied `/storage/emulated/0/Nerloq.png` is used in the shell, authentication, favicon, Apple touch icon and PWA manifest. `.gitignore` excludes `.env` and local uploaded media.

## Integration boundaries before real users

The current For You feed is chronological with privacy and mute/block filtering; recommendation ranking is not implemented. Search is MongoDB-backed for creators, videos and hashtags; sounds and products are not searchable yet. Commerce, stories, duets/stitches, moderation review queues, attachments in messages and realtime delivery for the remaining product events still need services. Socket.IO currently runs in one API process; production horizontal scaling needs a shared Socket.IO adapter and load-balancer affinity for polling fallback. Inbox polling remains the offline fallback. Creator analytics currently aggregates lifetime counters; unique viewers, watch time, completion and traffic sources are not tracked. Redis is configured as required in staging/production but is not yet used by product features.

The local media adapter stores original MP4/MOV/WebM files and supports authorized range playback. Production needs a real S3/R2/GCS storage adapter, CDN, transcoding/HLS worker, metadata inspection, thumbnail generation and content scanning. The API deliberately returns a service error when a non-local storage provider is selected because that adapter is not present yet. Password recovery has Resend and SendGrid adapters; SMTP is rejected explicitly. The logo asset itself is included in the web public assets.

Before public launch, finish the remaining social services, connect cloud media processing and a licensed audio catalog, add account verification and full safety review tooling, validate authorization end to end, configure observability and backups, and run browser/device tests against the deployed stack. The web workspace currently has no automated browser tests. This environment has no `.env`, MongoDB server, or Redis server, so live persistence and media upload have not been exercised here.
