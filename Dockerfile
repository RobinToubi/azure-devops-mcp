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

# HTTP server defaults — override at runtime via docker run -e or docker-compose environment:
#   AZURE_DEVOPS_ORG   Azure DevOps organization name (required)
#   AZURE_DEVOPS_URL   Custom base URL, e.g. https://tfs.contoso.com/tfs/DefaultCollection (optional)
#   PORT               Port to listen on (default: 3000)
#   HOST               Host to bind to (default: 0.0.0.0 — all interfaces inside the container)
#   AUTHENTICATION     Auth type: request | envvar | pat | azcli | interactive (default: request)
#   INSECURE           Set to any non-empty value to disable SSL certificate verification
#   TENANT             Azure tenant ID (for interactive/azcli auth)
#   API_VERSION        Azure DevOps REST API version (e.g. "7.1")
#   DOMAINS            Space-separated list of domains to enable (default: all)
ENV PORT=3000
ENV HOST=0.0.0.0
ENV AUTHENTICATION=request
ENV INSECURE=
ENV TENANT=
ENV API_VERSION=
ENV DOMAINS=

# Copy only the necessary runtime artifacts from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json /app/package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts

EXPOSE 3000

# Use the non-root 'node' user provided by the official image
USER node

# Shell form with exec preserves proper signal handling (SIGTERM, etc.) while allowing env var expansion.
# AZURE_DEVOPS_ORG is passed as the required positional <organization> argument.
# Append AZURE_DEVOPS_URL only when set (--url "" would override the compiled-in default).
ENTRYPOINT ["sh", "-c", "exec node dist/index.js \"${AZURE_DEVOPS_ORG}\" --transport http --host \"${HOST}\" --port \"${PORT}\" --authentication \"${AUTHENTICATION}\" ${AZURE_DEVOPS_URL:+--url \"${AZURE_DEVOPS_URL}\"} ${INSECURE:+--insecure} ${TENANT:+--tenant \"${TENANT}\"} ${API_VERSION:+--api-version \"${API_VERSION}\"} ${DOMAINS:+--domains ${DOMAINS}}"]
