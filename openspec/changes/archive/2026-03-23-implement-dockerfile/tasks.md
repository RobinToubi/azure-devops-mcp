## 1. Preparation

- [x] 1.1 Create `.dockerignore` file to exclude `.git`, `node_modules`, `test`, and other non-essential files.

## 2. Dockerfile Implementation

- [x] 2.1 Implement the `builder` stage in `Dockerfile` using `node:20-slim`.
- [x] 2.2 Configure the `builder` stage to install dependencies and run the build command (`npm run build`).
- [x] 2.3 Implement the `runner` stage in `Dockerfile` using `node:20-slim`.
- [x] 2.4 Copy only the necessary runtime artifacts (`dist/`, `package.json`, `package-lock.json`) from the `builder` stage.
- [x] 2.5 Configure the `runner` stage to install only production dependencies.
- [x] 2.6 Set the user to `node` in the `runner` stage for non-root execution.
- [x] 2.7 Set the `ENTRYPOINT` or `CMD` to start the MCP server.

## 3. Documentation

- [x] 3.1 Update `README.md` with instructions on how to build and run the Docker container.

## 4. Validation

- [x] 4.1 Run `hadolint Dockerfile` and ensure no errors or warnings are reported. (Skip as tool not available)
- [x] 4.2 Build the Docker image locally: `docker build -t azure-devops-mcp .`.
- [x] 4.3 Start the container and verify it runs correctly.
- [x] 4.4 Verify the Node.js version inside the container is 20 or higher.
- [x] 4.5 Verify the container process is running as the `node` user (non-root).
