## Why

In stdio mode the server is a single-client subprocess — it is reasonable to read the PAT from an environment variable set by whoever launched it. In HTTP transport mode the server is a long-running process shared by multiple clients. Requiring each client to share the same server-side env-var PAT removes any per-client isolation and makes multi-tenant deployments impossible. The PAT should travel with the request, not with the server process.

## What Changes

- Add a new `--authentication request` auth type valid only with `--transport http`. When active, no PAT env var is required at startup; instead the raw PAT is read from the `X-Azure-DevOps-PAT` request header on each new MCP session (`InitializeRequest`).
- `src/http-server.ts`: `HttpServerOptions.createServerForSession` gains a required `pat` string argument. The POST handler extracts the `X-Azure-DevOps-PAT` header from the InitializeRequest, validates it is non-empty, and passes it to the factory. Missing or empty header → HTTP 401.
- `src/index.ts`: when `--transport http --authentication request`, build a session factory that constructs per-session `authHeaderProvider` and `connectionProvider` from the supplied PAT instead of from a startup-time authenticator.
- Existing auth types (`pat`, `envvar`, `interactive`, `azcli`) continue to work in HTTP mode with their current server-startup behavior — the factory captures the startup-resolved credential for all sessions.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `auth`: add Requirement for `request` auth type — PAT is read from `X-Azure-DevOps-PAT` HTTP header per session, not from an environment variable.
- `http-streamable-transport`: per-session auth — the session factory receives the client-supplied PAT; missing header returns HTTP 401 before session is created.

## Impact

- **`src/http-server.ts`**: `HttpServerOptions.createServerForSession` signature changes from `() => McpServer` to `(pat: string) => McpServer`. Existing callers using non-`request` auth types pass a wrapper that ignores the `pat` argument.
- **`src/index.ts`**: new `request` auth branch builds per-session providers; non-`request` paths continue to share startup-resolved providers.
- **`src/auth.ts`**: add `createPatAuthHeaderProvider(pat: string)` helper that returns a ready `authHeaderProvider` from a raw PAT string.
- **No Azure DevOps Server (on-premise) impact**: the change is transport-level only; the same ADO API calls are made with the same Basic auth encoding.
