## 1. Dependencies

- [x] 1.1 Add `express` to `dependencies` in `package.json`
- [x] 1.2 Add `@types/express` to `devDependencies` in `package.json`
- [x] 1.3 Run `npm install` and verify no version conflicts with the SDK's transitive `express` usage

## 2. CLI Flags

- [x] 2.1 Add `--transport <stdio|http>` yargs option to `src/index.ts` (choices: `["stdio", "http"]`, default: `"stdio"`)
- [x] 2.2 Add `--port <number>` yargs option (default: `3000`)
- [x] 2.3 Add `--host <string>` yargs option (default: `"127.0.0.1"`)

## 3. HTTP Server Module

- [x] 3.1 Create `src/http-server.ts` with an exported `startHttpServer(options)` function
- [x] 3.2 Import and call `createMcpExpressApp({ host })` from `@modelcontextprotocol/sdk/server/express.js`
- [x] 3.3 Declare `const transports = new Map<string, StreamableHTTPServerTransport>()` for session management
- [x] 3.4 Implement `POST /mcp` handler: create `StreamableHTTPServerTransport` with `sessionIdGenerator: () => randomUUID()` and `eventStore: new InMemoryEventStore()` for new `InitializeRequest`s; route existing sessions via `MCP-Session-Id` header; return 400 for non-init requests without a session ID; return 404 for unknown session IDs
- [x] 3.5 Set `transport.onclose` to remove the session from the `transports` map
- [x] 3.6 Per new session: instantiate a fresh `McpServer`, call `configureAllTools(...)` on it, then `mcpServer.connect(transport)`, then `transport.handleRequest(req, res, req.body)`
- [x] 3.7 Implement `GET /mcp` handler: require valid `MCP-Session-Id` (400 if missing/unknown), call `transport.handleRequest(req, res)` to open the SSE stream
- [x] 3.8 Implement `DELETE /mcp` handler: require valid `MCP-Session-Id` (400 if missing/unknown), call `transport.handleRequest(req, res)` to process termination
- [x] 3.9 Add `SIGINT` and `SIGTERM` handlers: iterate `transports`, call `transport.close()` on each, then `process.exit(0)`
- [x] 3.10 Log a Winston `warn` when `host` is not `127.0.0.1` or `localhost`
- [x] 3.11 Log a Winston `info` with host and port once `app.listen` succeeds

## 4. Entry Point Integration

- [x] 4.1 In `src/index.ts`, extract a `buildServerDependencies()` helper that returns the auth provider, connection provider, userAgent provider, and enabled domains (shared between both transport paths)
- [x] 4.2 Add branch in `main()`: when `--transport http`, import and call `startHttpServer`; otherwise use existing `StdioServerTransport` logic
- [x] 4.3 Wire `server.server.oninitialized` per-session so `userAgentComposer.appendMcpClientInfo(...)` is called for each HTTP session's `McpServer`
- [x] 4.4 Add `"start:http"` script to `package.json`: `"node dist/index.js $npm_config_org --transport http"`

## 5. Tests and Validation

- [x] 5.1 Create `test/src/http-server.test.ts`
- [x] 5.2 Test: `POST /mcp` with an `InitializeRequest` returns `MCP-Session-Id` header and a valid `InitializeResult`
- [x] 5.3 Test: `POST /mcp` with a valid session ID routes to the existing transport and returns a result
- [x] 5.4 Test: `POST /mcp` with an unknown session ID returns HTTP 404
- [x] 5.5 Test: `POST /mcp` with no session ID and a non-init body returns HTTP 400
- [x] 5.6 Test: `GET /mcp` with a valid session ID returns `Content-Type: text/event-stream`
- [x] 5.7 Test: `GET /mcp` with no or invalid session ID returns HTTP 400
- [x] 5.8 Test: `DELETE /mcp` with a valid session ID closes the transport and removes the session from the map
- [x] 5.9 Test: `DELETE /mcp` with an unknown session ID returns HTTP 400
- [x] 5.10 Test: launching with default `--transport` still uses `StdioServerTransport` (no HTTP server started)
- [x] 5.11 Test: `--host 0.0.0.0` logs a warning about reduced DNS rebinding protection
- [x] 5.12 Run `npm run build` — no TypeScript errors
- [x] 5.13 Run `npm test` — coverage remains above 98%

## 6. Documentation

- [x] 6.1 Add an "HTTP Transport" section to `README.md` with a usage example, port/host options, and a note recommending `--authentication envvar` or `pat` for server deployments
- [x] 6.2 Document that `interactive` and `azcli` auth modes may open a browser popup on the first tool call in HTTP mode
