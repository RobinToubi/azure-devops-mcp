## Why

Providing a Dockerfile enables consistent, containerized deployments of the Azure DevOps MCP server. This simplifies local development, testing, and production deployment across different environments (e.g., Kubernetes, Azure Container Instances) by ensuring the runtime environment is identical and reproducible.

## What Changes

- Add a multi-stage `Dockerfile` to the project root.
- Add a `.dockerignore` file to exclude unnecessary files (e.g., `node_modules`, `test`, `.git`) from the build context.
- Ensure the Dockerfile follows best practices and passes `hadolint` checks (e.g., using specific image tags, non-root user, proper instruction ordering).
- Update documentation (`README.md` or `GETTINGSTARTED.md`) with instructions on how to build and run the container.

## Capabilities

### New Capabilities

- `docker-support`: Define requirements for building, running, and linting the Docker container, ensuring compatibility with the MCP lifecycle.

### Modified Capabilities

<!-- No existing capability requirements are changing. -->

## Impact

- **Build System**: Requires `docker` or a compatible container engine for building images.
- **CI/CD**: Enables new automated build and scan pipelines (e.g., running `hadolint`).
- **Deployment**: Provides a new distribution format (OOCI image) alongside the existing NPM/Node.js package.
