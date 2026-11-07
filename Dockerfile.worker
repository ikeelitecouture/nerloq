FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN npm ci
RUN npm run build

CMD ["node", "apps/api/dist/workers/video-processing.worker.js"]
