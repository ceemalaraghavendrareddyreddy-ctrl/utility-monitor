# Node 22+ is required for the built-in node:sqlite module (see server/src/db.js).
FROM node:22-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY server ./server
COPY web ./web

ENV PORT=3000
EXPOSE 3000

# NOTE: server/data/ (the SQLite file) lives inside the container and is NOT
# persisted across restarts/redeploys by default — every restart re-backfills
# a fresh 48h of demo data. That's a deliberate simplification for a demo
# deploy (always opens calm, no volume to manage); it also means any
# alert_email you set via the dashboard or `users` you add are lost on
# restart. Mount a persistent volume at /app/server/data (e.g. `fly volumes
# create` + a `[[mounts]]` block in fly.toml) before this holds real data.
CMD ["node", "server/src/server.js"]
