## Context

The Azure DevOps MCP server is currently distributed as a Node.js application. While it can be run directly via `node` or `npx`, providing a Docker image simplifies deployment in containerized environments and ensures a consistent runtime environment across different host systems.

## Goals / Non-Goals

**Goals:**

- Provide a production-ready, multi-stage `Dockerfile`.
- Ensure the Dockerfile is optimized for size and security.
- Achieve `hadolint` compliance.
- Automate the exclusion of unnecessary files via `.dockerignore`.

**Non-Goals:**

- Setting up a full CI/CD pipeline for image publishing (this is out of scope for the Dockerfile implementation itself).
- Providing Kubernetes manifests or Helm charts.

## Decisions

### 1. Base Image: `node:20-slim`

- **Decision**: Use `node:20-slim` for the final runtime image.
- **Rationale**: Node.js 20 is the current LTS/recommended version for this project. The `slim` variant significantly reduces the image size by excluding unnecessary packages compared to the full `node:20` image, while still providing a compatible runtime.
- **Alternatives**:
  - `node:20-alpine`: Even smaller, but can occasionally have compatibility issues with native modules (though none are currently critical here). `slim` (Debian-based) is a safer default for broad compatibility.
  - `node:20`: Too large for production use.

### 2. Multi-stage Build

- **Decision**: Implement a two-stage build: `builder` and `runner`.
- **Rationale**: The `builder` stage will handle `npm install` and `npm run build` (TypeScript compilation). The `runner` stage will only copy the compiled `dist` folder and production `node_modules`, ensuring the final image doesn't contain source code or build tools (like the TypeScript compiler).

### 3. Security: Non-Root User

- **Decision**: Use the built-in `node` user in the final image.
- **Rationale**: Running as root inside a container is a security risk. The official Node.js images provide a `node` user (UID 1000) that should be used to run the application process.

### 4. CLI Arguments and Environment Variables

- **Decision**: No changes to `src/config.ts` or CLI parsing are required.
- **Rationale**: The application already accepts configuration via environment variables and CLI arguments, which are easily passed into a Docker container.

### 5. Authentication Handling

- **Decision**: No changes to authentication logic.
- **Rationale**: Authentication (PAT, interactive, etc.) is handled via environment variables or interactive prompts. Containerized deployment typically uses PAT via environment variables (`AZURE_DEVOPS_EXT_PAT`), which the application already supports.

## Risks / Trade-offs

- **[Risk] Image Size** → **Mitigation**: Using `node:slim` and multi-stage builds minimizes the footprint.
- **[Risk] Native Module Compilation** → **Mitigation**: If future dependencies require native compilation, the `builder` stage can include necessary build-essential tools without bloating the final `runner` image.
- **[Risk] Cache Invalidation** → **Mitigation**: Order `COPY package.json package-lock.json` before `COPY src/` to leverage Docker's layer caching for `npm install`.
