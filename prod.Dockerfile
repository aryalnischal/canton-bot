# ──────────────────────────────────────────────────────────────────────────────
# prod.Dockerfile  •  PRODUCTION
# Multi-stage build for a hardened, minimal production image.
# ──────────────────────────────────────────────────────────────────────────────

# --- Stage 1: Dependencies ---
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package*.json ./
RUN npm ci --omit=dev


# --- Stage 2: Builder ---
FROM node:20-alpine AS builder
WORKDIR /app

# Build-time ARGs for public environment variables
ARG NEXT_PUBLIC_ENV=production
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_CENTRAL_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_USER_REDIRECT_BASE_URL
ARG NEXT_PUBLIC_CENTRAL_FRONTEND_REDIRECT_URL

ENV NEXT_PUBLIC_ENV=$NEXT_PUBLIC_ENV \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_CENTRAL_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_CENTRAL_STRIPE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_USER_REDIRECT_BASE_URL=$NEXT_PUBLIC_USER_REDIRECT_BASE_URL \
    NEXT_PUBLIC_CENTRAL_FRONTEND_REDIRECT_URL=$NEXT_PUBLIC_CENTRAL_FRONTEND_REDIRECT_URL \
    NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci
COPY . .

# Build the standalone Next.js app
RUN npm run build


# --- Stage 3: Runner ---
FROM node:20-alpine AS runner

# Create non-root user for execution
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Set production environment defaults
ENV NODE_ENV=production \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    PM2_HOME=/tmp/.pm2

# Install PM2 globally for process management
RUN npm install -g pm2 && npm cache clean --force

# Copy only necessary files from builder
# Next.js standalone output includes a minimal 'node_modules' 
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=builder --chown=appuser:appgroup /app/public ./public
COPY --from=builder --chown=appuser:appgroup /app/ecosystem.config.js ./ecosystem.config.js

# Correct permissions for the workdir to ensure appuser can write if needed (e.g. for PM2 logs)
RUN chown appuser:appgroup /app

USER appuser
EXPOSE 3000

# Start the application using PM2
CMD ["pm2-runtime", "ecosystem.config.js"]
