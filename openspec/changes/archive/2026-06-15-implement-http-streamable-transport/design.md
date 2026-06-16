## Context

The server's entry point (`src/index.ts`) hardcodes `StdioServerTransport` as the only transport. All MCP tool logic, authentication setup, and the `McpServer` instance are created inside `main()`, which makes the code straightforward to extend — the transport is just the last step before `server.connect(transport)`.

The MCP SDK at version 1.29.0 already ships `StreamableHTTPServerTransport` (a thin wrapper over `WebStandardStreamableHTTPServerTransport` using `@hono/node-server`) and `createMcpExpressApp()` with DNS rebinding protection built in. No new npm dependencies are required.

## Goals / Non-Goals

**Goals:**

- Support `--transport http` flag that starts an Express-based HTTP server on a configurable port.
- Implement the full MCP 2025-11-25 Streamable HTTP spec: POST (JSON-RPC), GET (SSE), DELETE (session termination).
- Stateful session management: each client initialization gets a UUID session ID returned via `MCP-Session-Id` response header.
- DNS rebinding protection on localhost via `createMcpExpressApp()`.
- Graceful shutdown: drain active transports on `SIGINT`/`SIGTERM`.
- Stdio transport behavior is completely unchanged.

**Non-Goals:**

- OAuth/Bearer token authentication at the HTTP layer (the SDK's auth middleware is not wired — ADO auth happens inside tool handlers as today).
- TLS termination (users should use a reverse proxy for HTTPS in production).
- Horizontal scaling / shared session store (sessions are in-process memory only).
- Backwards-compatible HTTP+SSE transport from protocol version 2024-11-05.

## Decisions

### 1. New `src/http-server.ts` module, not inlining into `index.ts`

**Decision**: Extract the HTTP server logic into `src/http-server.ts`, exporting a `startHttpServer(server, options)` function. `index.ts` calls either `startStdio(server)` or `startHttpServer(server, { port, host })` based on the `--transport` flag.

**Rationale**: Keeps `index.ts` focused on bootstrapping (arg parsing, auth, tool registration). The HTTP server has its own lifecycle (listening, session map, shutdown handlers) that is self-contained.

**Alternative considered**: Single `index.ts` with an inline `if (transport === 'http')` block — rejected because it makes the already-long `main()` harder to read and test.

### 2. New `McpServer` per session vs. single shared server

**Decision**: Create **one `McpServer`** instance (shared across all sessions) and create a **new `StreamableHTTPServerTransport` per session**.

**Rationale**: The MCP SDK's `McpServer` is designed to be connected to one transport at a time via `server.connect(transport)`, but `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` supports multiple concurrent transports internally through its session-aware API. Tools are registered once and serve all sessions. This matches the official example (`simpleStreamableHttp.js` uses `getServer()` per session — but that's because the example tracks state per server; for this server, tools are stateless relative to ADO credentials so a single server instance is correct).

**Clarification on SDK behavior**: The `McpServer.connect(transport)` call is designed to be called once per session transport. The SDK does not support connecting multiple transports to the same `McpServer` instance simultaneously (the `server.connect()` call replaces any prior transport). Therefore, we follow the SDK example pattern: **create a new `McpServer` instance per session** and call `configureAllTools()` on each. The auth, connection provider, and userAgent are shared closures — safe to share across sessions.

**Alternative considered**: Reuse a single server — rejected because `server.connect()` replaces the transport, breaking concurrent sessions.

### 3. CLI flag: `--transport` with default `stdio`

**Decision**: Add `--transport <stdio|http>` option to yargs (default: `stdio`). Add `--port <number>` (default: `3000`) and `--host <string>` (default: `127.0.0.1`).

**Rationale**: Backward compatible — existing integrations launch without `--transport` and get stdio. HTTP mode requires an explicit opt-in.

**No changes to `src/config.ts`**: Transport selection is not part of the server's ADO configuration and doesn't need to be exported as global state. Port and host live only in `http-server.ts`.

### 4. Express via `createMcpExpressApp()`, not raw `http.createServer`

**Decision**: Use `createMcpExpressApp({ host })` from `@modelcontextprotocol/sdk/server/express.js`.

**Rationale**: The SDK helper automatically applies `hostHeaderValidation` / `localhostHostValidation` middleware for DNS rebinding protection when the host is `127.0.0.1` or `localhost`. Avoids reimplementing the Origin/Host header check required by the MCP spec's security warning. Also sets up `express.json()` body parsing.

**`express` dependency**: Express is currently a transitive dependency via the SDK. It will be promoted to a direct dependency in `package.json` (with `@types/express` in devDependencies) to avoid accidental breakage if the SDK removes it in the future.

### 5. Authentication: no change to auth flow

**Decision**: No HTTP-level authentication middleware. ADO credentials are acquired per tool invocation through the same `authenticator` closure used in stdio mode.

**Rationale**: The `interactive` and `azcli` auth modes open a browser/device flow on first token acquisition. These are not compatible with request-scoped HTTP auth middleware. PAT and envvar modes are credential-in-process, so they work fine. Adding HTTP Bearer auth would be a separate, larger change.

**Impact**: The `--authentication` flag and all auth types (`interactive`, `azcli`, `env`, `envvar`, `pat`) work identically in HTTP mode — the first tool call that needs a token will trigger auth just as in stdio mode.

### 6. Session cleanup

**Decision**: Store `Map<sessionId, StreamableHTTPServerTransport>` in `http-server.ts`. Set `transport.onclose` to delete the session. On `SIGINT`/`SIGTERM`, call `transport.close()` on all entries and exit.

**Rationale**: Prevents memory leaks for long-running server instances. Mirrors the official SDK example.

## Risks / Trade-offs

| Risk                                                                                                               | Mitigation                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `interactive` auth opens a browser popup on first HTTP request, blocking that request until the user authenticates | Document this in README; recommend `--authentication envvar` or `pat` for HTTP/server deployments                          |
| Multiple concurrent client sessions each create a new `McpServer` + tool registration — higher memory per session  | Tool registration is lightweight (closures, no heavy state); acceptable for expected usage (few concurrent clients)        |
| `express` promoted to direct dep may introduce version conflicts with SDK's own express usage                      | Pin to `^4.x` (same major as SDK uses); check for conflicts at build time                                                  |
| Sessions in memory are lost on server restart                                                                      | Expected behavior; clients re-initialize per the spec (receive 404 on stale session ID, then send new `InitializeRequest`) |
| `--host 0.0.0.0` disables DNS rebinding protection from `createMcpExpressApp`                                      | Warn in logs when host is not localhost; document in README                                                                |

## Migration Plan

1. Add `express` and `@types/express` to `package.json` dependencies.
2. Create `src/http-server.ts`.
3. Update `src/index.ts`: add CLI flags, extract `buildServer()` helper, branch on `--transport`.
4. Add `"start:http"` npm script: `node dist/index.js <org> --transport http`.
5. Update README with HTTP usage examples and auth recommendations.
6. No migration for existing users — stdio is still the default.

**Rollback**: Remove `--transport http` support; stdio path is unchanged throughout.

## Open Questions

- Should the HTTP server support a configurable MCP endpoint path (default `/mcp`) via `--path`? _Leave for follow-up — `/mcp` is sufficient for now._
- Should `resumability` (SSE event IDs + `InMemoryEventStore`) be enabled by default? _Yes, use `InMemoryEventStore` from the SDK to support reconnection without extra complexity._
