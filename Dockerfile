# ──────────────────────────────────────────────────────────────
# Dockerfile  •  LOCAL DEVELOPMENT
# ──────────────────────────────────────────────────────────────
# We're switching to 'alpine' to avoid the 'apt-get' hangs 
# seen in the 'slim' image. It's much lighter and faster.
FROM node:20-alpine AS dev

WORKDIR /app

# Copy ONLY the package manifests first for efficient caching
COPY package*.json ./

# Install ALL dependencies (including dev tools)
# Using '--legacy-peer-deps' if needed to resolve older module chains
RUN npm install

# Copy application source
COPY . .

# Next.js development settings
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

EXPOSE 3000

# Start the Next.js development server
CMD ["npm", "run", "dev"]
