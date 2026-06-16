## MODIFIED Requirements

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
