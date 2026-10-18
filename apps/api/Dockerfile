# ============================================
# THE BURGER FACTORY — API DOCKERFILE
# Multi-stage lightweight Node.js 22 alpine build
# ============================================

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

FROM base AS dependencies
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema=./apps/api/prisma/schema.prisma
RUN npm run build --workspace=@burger-factory/api

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/packages/shared ./packages/shared

EXPOSE 4000
CMD ["node", "dist/server.js"]
