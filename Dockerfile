# Multi-stage production build
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json tsconfig*.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
RUN npm ci

# Copy full application source
COPY src ./src

# Build client frontend bundle and verify typescript
RUN npm run build

# Production runtime stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
# Do NOT omit dev dependencies because we need tsx and typescript to run the server directly from source
RUN npm ci --include=dev

# Copy source and migrations for tsx runtime
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./

EXPOSE 3000

CMD ["npx", "tsx", "src/server/index.ts"]
