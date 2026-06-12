# ── Build stage ──────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY server/package*.json server/
COPY client/package*.json client/
RUN cd server && npm ci && cd ../client && npm ci

COPY server server
COPY client client
RUN cd server && npm run build && cd ../client && npm run build

# ── Runtime stage ────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY server/package*.json server/
RUN cd server && npm ci --omit=dev

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

EXPOSE 2567
CMD ["node", "server/dist/index.js"]
