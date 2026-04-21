FROM node:22-bookworm-slim AS client-builder

WORKDIR /app/client

COPY client/package*.json ./
RUN npm install

COPY client ./
RUN npm run build


FROM node:22-bookworm-slim AS server-builder

WORKDIR /app/server

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server ./


FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DB_PATH=/data/clinic.db \
    CLIENT_DIST_PATH=/app/client/dist

RUN mkdir -p /data /app/client/dist

COPY --from=server-builder /app/server ./server
COPY --from=client-builder /app/client/dist ./client/dist

EXPOSE 3001

WORKDIR /app/server

CMD ["node", "src/index.js"]
