## Why

The server currently only supports stdio transport, which requires the MCP client to launch it as a subprocess. Adding Streamable HTTP transport allows the server to run as a standalone HTTP process that multiple clients can connect to — enabling remote deployment, Docker/container-based setups, and clients that cannot manage subprocesses.

## What Changes

- Add `--transport <stdio|http>` CLI flag (default: `stdio`) to select transport at startup.
- Add `--port <number>` CLI flag (default: `3000`) for the HTTP server port.
- Add `--host <string>` CLI flag (default: `127.0.0.1`) to control the bind address.
- Create `src/http-server.ts`: Express-based HTTP server using `StreamableHTTPServerTransport` from the MCP SDK, exposing a `/mcp` endpoint that handles POST, GET (SSE), and DELETE (session termination).
- Session management: stateful sessions with UUID session IDs, stored in a `Map<sessionId, transport>`.
- DNS rebinding protection: use `createMcpExpressApp()` from the SDK (applies localhost host-header validation automatically when binding to `127.0.0.1`).
- Graceful shutdown: close all active transports on `SIGINT`/`SIGTERM`.
- Add `npm run start:http` script as a convenience shortcut.

## Capabilities

### New Capabilities

- `http-streamable-transport`: Expose the MCP server over HTTP using the MCP 2025-11-25 Streamable HTTP transport spec — supporting SSE streaming, session management (stateful), and server-to-client notifications via GET-initiated SSE streams.

### Modified Capabilities

<!-- None — stdio behavior is unchanged; this is purely additive. -->

## Impact

- **`src/index.ts`**: New CLI flags (`--transport`, `--port`, `--host`); startup branches into `startStdio()` or `startHttp()`.
- **`src/http-server.ts`** (new): Full HTTP server implementation.
- **`package.json`**: New `start:http` script; `express` and `@types/express` listed explicitly as dependencies (currently transitive via MCP SDK).
- **No Azure DevOps Server (on-premise) impact**: transport selection is orthogonal to the ADO API calls; both transports work identically with all authentication modes.
