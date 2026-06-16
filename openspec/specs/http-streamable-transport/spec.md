## ADDED Requirements

### Requirement: Transport selection via CLI flag

The server SHALL accept a `--transport <stdio|http>` CLI flag. When omitted, the server SHALL default to `stdio` transport, preserving full backwards compatibility. When `--transport http` is specified, the server SHALL start an HTTP server instead of reading from stdin/writing to stdout.

#### Scenario: Default behavior is unchanged

- **WHEN** the server is launched without `--transport`
- **THEN** it connects via `StdioServerTransport` exactly as before

#### Scenario: HTTP transport selected explicitly

- **WHEN** the server is launched with `--transport http`
- **THEN** it starts an HTTP server and does NOT read from stdin

#### Scenario: Invalid transport value rejected

- **WHEN** the server is launched with `--transport foobar`
- **THEN** yargs exits with a non-zero code and prints the valid choices

---

### Requirement: HTTP server bind address and port configuration

When HTTP transport is active, the server SHALL accept `--port <number>` (default `3000`) and `--host <string>` (default `127.0.0.1`) CLI flags controlling where the HTTP server listens.

#### Scenario: Default port and host

- **WHEN** `--transport http` is used without `--port` or `--host`
- **THEN** the server listens on `127.0.0.1:3000`

#### Scenario: Custom port

- **WHEN** `--transport http --port 8080` is used
- **THEN** the server listens on port 8080

#### Scenario: Custom host

- **WHEN** `--transport http --host 0.0.0.0` is used
- **THEN** the server binds to all interfaces and logs a warning that DNS rebinding protection is reduced

---

### Requirement: MCP endpoint POST handler

The server SHALL expose a `POST /mcp` HTTP endpoint that accepts JSON-RPC requests from MCP clients. The endpoint SHALL return `Content-Type: text/event-stream` for JSON-RPC requests (initiating an SSE stream with the response) or `Content-Type: application/json` for a direct response. For JSON-RPC notifications and responses, the endpoint SHALL return HTTP 202 Accepted with no body.

When the server is configured with `--authentication request`, the endpoint SHALL additionally enforce that any `InitializeRequest` includes a non-empty `X-Azure-DevOps-PAT` header, returning HTTP 401 if absent or empty. The extracted PAT SHALL be passed to the per-session server factory to construct session-scoped Azure DevOps API credentials.

#### Scenario: Client sends InitializeRequest (new session)

- **WHEN** a POST with an `InitializeRequest` body and no `MCP-Session-Id` header is received
- **THEN** the server creates a new session, responds with `InitializeResult`, and includes `MCP-Session-Id: <uuid>` in the response headers

#### Scenario: Client sends request to existing session

- **WHEN** a POST includes a valid `MCP-Session-Id` header matching a live session
- **THEN** the request is routed to that session's transport and handled normally

#### Scenario: Client sends request with unknown session ID

- **WHEN** a POST includes an `MCP-Session-Id` that does not match any active session
- **THEN** the server responds with HTTP 404 Not Found

#### Scenario: Client sends notification (no session yet)

- **WHEN** a POST contains a JSON-RPC notification without a session ID (not an InitializeRequest)
- **THEN** the server responds with HTTP 400 Bad Request

#### Scenario: Malformed JSON body

- **WHEN** a POST contains a body that is not valid JSON
- **THEN** the server responds with HTTP 400 Bad Request

#### Scenario: InitializeRequest missing PAT header in request-auth mode

- **WHEN** the server is configured with `--authentication request` and a client sends an `InitializeRequest` without an `X-Azure-DevOps-PAT` header (or with an empty value)
- **THEN** the server SHALL respond with HTTP 401 Unauthorized and SHALL NOT create a session

#### Scenario: InitializeRequest with valid PAT header in request-auth mode

- **WHEN** the server is configured with `--authentication request` and a client sends an `InitializeRequest` with a non-empty `X-Azure-DevOps-PAT` header
- **THEN** the server SHALL create a session whose ADO credentials are derived solely from the supplied header value

---

### Requirement: MCP endpoint GET handler (SSE stream)

The server SHALL expose a `GET /mcp` endpoint that opens a persistent SSE stream for an existing session, allowing the server to push JSON-RPC requests and notifications to the client without a preceding client POST.

#### Scenario: Client opens SSE stream for valid session

- **WHEN** a GET to `/mcp` includes a valid `MCP-Session-Id` header
- **THEN** the server responds with `Content-Type: text/event-stream` and keeps the connection open

#### Scenario: Client opens SSE stream with no or invalid session ID

- **WHEN** a GET to `/mcp` has no `MCP-Session-Id` or an unrecognized one
- **THEN** the server responds with HTTP 400 Bad Request

#### Scenario: Client reconnects with Last-Event-ID

- **WHEN** a GET includes `Last-Event-ID` referencing a previously received event
- **THEN** the server replays any missed SSE events from that point forward on the new stream

---

### Requirement: MCP endpoint DELETE handler (session termination)

The server SHALL expose a `DELETE /mcp` endpoint that allows a client to explicitly terminate its session, freeing server-side resources.

#### Scenario: Client terminates a valid session

- **WHEN** a DELETE to `/mcp` includes a valid `MCP-Session-Id`
- **THEN** the server closes the transport, removes the session from the active map, and responds with HTTP 200

#### Scenario: Client sends DELETE for unknown session

- **WHEN** a DELETE includes an unrecognized `MCP-Session-Id`
- **THEN** the server responds with HTTP 400 Bad Request

---

### Requirement: Stateful session management

The server SHALL maintain a `Map<sessionId, StreamableHTTPServerTransport>` of active sessions. Session IDs SHALL be cryptographically random UUIDs. When a transport is closed (by client termination, server shutdown, or error), its session SHALL be removed from the map.

#### Scenario: Session stored on initialization

- **WHEN** a new session is successfully initialized
- **THEN** the transport is stored in the session map under the assigned session ID

#### Scenario: Session removed on transport close

- **WHEN** a transport's `onclose` callback fires
- **THEN** the session is deleted from the session map

#### Scenario: Multiple concurrent sessions

- **WHEN** two clients initialize simultaneously
- **THEN** each gets a distinct session ID and their requests are routed independently

---

### Requirement: DNS rebinding protection

The server SHALL use `createMcpExpressApp({ host })` from `@modelcontextprotocol/sdk/server/express.js`, which automatically applies host-header validation middleware when the bind host is `127.0.0.1` or `localhost`.

#### Scenario: Request with invalid Origin on localhost

- **WHEN** the server is bound to `127.0.0.1` and receives a request with an `Origin` header from a non-localhost origin
- **THEN** the middleware responds with HTTP 403 Forbidden before the request reaches the MCP handler

#### Scenario: Valid localhost request passes

- **WHEN** the server is bound to `127.0.0.1` and receives a request without an `Origin` header (or with a localhost origin)
- **THEN** the request proceeds to the MCP handler normally

---

### Requirement: SSE resumability via InMemoryEventStore

The server SHALL enable resumability on each `StreamableHTTPServerTransport` instance by passing an `InMemoryEventStore` from `@modelcontextprotocol/sdk`. SSE events SHALL carry `id` fields so that clients can reconnect using `Last-Event-ID`.

#### Scenario: Events have IDs

- **WHEN** the server sends SSE events to a client
- **THEN** each event includes an `id` field

#### Scenario: Client reconnects after dropped connection

- **WHEN** a client reconnects with a `Last-Event-ID` from a previous session stream
- **THEN** the server replays events that were sent after that ID on the recovered stream

---

### Requirement: Graceful shutdown

The server SHALL handle `SIGINT` and `SIGTERM` signals by closing all active transports before exiting, ensuring clients receive connection-closed signals cleanly.

#### Scenario: SIGINT closes all sessions

- **WHEN** the server process receives `SIGINT`
- **THEN** it calls `transport.close()` on every entry in the session map, then exits with code 0

#### Scenario: SIGTERM closes all sessions

- **WHEN** the server process receives `SIGTERM`
- **THEN** it calls `transport.close()` on every entry in the session map, then exits with code 0

---

### Requirement: Startup log on HTTP mode

When starting in HTTP transport mode, the server SHALL log the listening address (host and port) so operators can confirm the server is ready.

#### Scenario: HTTP server ready log

- **WHEN** the Express server successfully binds
- **THEN** the server logs a message containing the host and port at `info` level via the Winston logger
