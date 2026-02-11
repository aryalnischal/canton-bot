# -------- Build Stage --------
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app


# Accept Stripe key as a build ARG
ARG NEXT_PUBLIC_CENTRAL_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_ENV

ENV NEXT_PUBLIC_CENTRAL_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_CENTRAL_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_ENV=$NEXT_PUBLIC_ENV

# Copy dependencies first (leveraging Docker cache)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy rest of the application
COPY . .

# Set standalone output in next.config.js
# Ensure: module.exports = { output: 'standalone' }

# Build the standalone Next.js app
RUN npm run build

# -------- Production Stage --------
FROM node:20-alpine AS runner

# Set working directory
WORKDIR /app

# Install PM2 globally
RUN npm install -g pm2

# Copy the standalone app and required files from builder
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/ecosystem.config.js ./ecosystem.config.js

# Expose the port Next.js listens on
EXPOSE 3000

# Start using PM2 in no-daemon mode (for container)
CMD ["pm2-runtime", "ecosystem.config.js"]
