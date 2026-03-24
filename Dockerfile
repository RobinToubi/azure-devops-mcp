# Stage 1: Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package.json and package-lock.json to leverage Docker layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
# Ignore scripts to avoid running build/husky before source is copied
RUN npm ci --ignore-scripts

# Copy the rest of the application code
COPY . .

# Build the application (compile TypeScript to JS)
RUN npm run build

# Stage 2: Runtime stage
FROM node:20-slim AS runner

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Copy only the necessary runtime artifacts from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json /app/package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts

# Use the non-root 'node' user provided by the official image
USER node

# Start the MCP server
# Use exec form for proper signal handling (SIGTERM, etc.)
ENTRYPOINT ["node", "dist/index.js"]
