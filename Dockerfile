# syntax=docker/dockerfile:1

# Build the client bundle and install dependencies.
FROM oven/bun:1.3-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json vite.config.ts ./
COPY shared ./shared
COPY client ./client
COPY server ./server
COPY types ./types
RUN bun run build

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app

# The server runs as a non-root user; the data volume is chowned to match.
RUN addgroup -S onsen && adduser -S -G onsen onsen

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/client ./dist/client
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/types ./types

# SQLite, uploads, avatars and the root secret all live here. Mount a volume.
ENV ONSEN_DATA_DIR=/data
ENV ONSEN_CLIENT_DIR=/app/dist/client
ENV ONSEN_PORT=8787
RUN mkdir -p /data && chown -R onsen:onsen /data /app

USER onsen
EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.ONSEN_PORT??8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "server/index.ts"]
