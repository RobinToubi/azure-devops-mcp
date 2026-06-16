## ADDED Requirements

### Requirement: Support for client-provided PAT in HTTP transport (`request` auth type)

The system SHALL support a `request` authentication type, selectable via `--authentication request`, valid only when `--transport http` is also specified. In this mode the server SHALL NOT require any PAT environment variable at startup. Instead, the raw PAT SHALL be read from the `X-Azure-DevOps-PAT` HTTP request header supplied by the client on each new MCP session initialisation (`InitializeRequest`).

The system SHALL encode the supplied raw PAT as `Basic <base64(:pat)>` for all Azure DevOps API calls made within that session.

#### Scenario: Request-mode server starts without PAT env var

- **WHEN** the server is launched with `--transport http --authentication request`
- **THEN** it SHALL start successfully without checking for `PERSONAL_ACCESS_TOKEN` or `ADO_MCP_AUTH_TOKEN` environment variables

#### Scenario: Client provides valid PAT header on initialize

- **WHEN** a client sends an `InitializeRequest` to `POST /mcp` with header `X-Azure-DevOps-PAT: <raw-pat>`
- **THEN** the server SHALL create a new session whose Azure DevOps API calls use `Authorization: Basic <base64(:raw-pat)>`

#### Scenario: Client omits PAT header on initialize

- **WHEN** a client sends an `InitializeRequest` to `POST /mcp` without an `X-Azure-DevOps-PAT` header (or with an empty value)
- **THEN** the server SHALL respond with HTTP 401 Unauthorized and SHALL NOT create a session

#### Scenario: `request` auth type with stdio transport is rejected

- **WHEN** the server is launched with `--authentication request` and `--transport stdio` (or no `--transport` flag)
- **THEN** the server SHALL exit with a non-zero code and print an error indicating that `request` auth requires `--transport http`
