## Context

The server currently creates a single `authenticator` at startup time and closes over it in `createServerForSession`. In stdio mode this is correct — there is exactly one client and one credential. In HTTP mode the closure captures the server-level credential for every session, meaning all clients share the same PAT.

`src/auth.ts` supports `pat` (env `PERSONAL_ACCESS_TOKEN`, base64-encoded) and `envvar` (env `ADO_MCP_AUTH_TOKEN`, raw PAT). Both are read at call time from process env — but process env is set at server startup, so the result is effectively static.

The `configureAllTools` call chain passes `authHeaderProvider` and `connectionProvider` — both closures over the startup credential — to every session uniformly.

## Goals / Non-Goals

**Goals:**

- Allow each HTTP client session to carry its own PAT, independent of the server's environment.
- Reject sessions that omit the PAT header with HTTP 401 when the server is in `request` auth mode.
- Keep existing auth types (`pat`, `envvar`, `interactive`, `azcli`) fully working in HTTP mode unchanged.

**Non-Goals:**

- Token refreshing or session-level token rotation.
- OAuth / interactive auth via header (only PAT is supported in `request` mode).
- Encrypting the PAT in transit — that is TLS's responsibility.

## Decisions

### 1. Header name: `X-Azure-DevOps-PAT` (raw PAT string)

**Alternatives considered:**

- `Authorization: Basic <base64(:pat)>` — standard HTTP auth, but the MCP SDK and the Express app may inspect or rewrite `Authorization` (e.g., DNS rebinding middleware uses `Origin`/`Host` but future changes could touch `Authorization`). More importantly it conflates MCP-server auth with ADO auth.
- `Authorization: Bearer <pat>` — wrong semantic; PAT is not a bearer token.

**Rationale:** A custom `X-Azure-DevOps-PAT` header is unambiguous, avoids any framework interception, and matches the concept that this header addresses ADO authentication specifically — not the MCP layer.

### 2. Factory signature: `createServerForSession(pat?: string) => McpServer`

The `createServerForSession` factory gains an optional `pat` argument. In non-`request` auth modes the factory ignores it and continues to use startup-resolved providers. In `request` mode the factory builds per-session `authHeaderProvider` and `connectionProvider` from the supplied raw PAT.

**Alternatives considered:**

- Separate option `resolveSessionAuth: (pat: string) => SessionAuth` on `HttpServerOptions` — more expressive but adds surface area. The factory already is the composition point.
- Changing nothing in the factory and using a mutable ref per request — not thread-safe.

### 3. 401 guard in `http-server.ts` via `requirePatHeader` option

`HttpServerOptions` gains a `requirePatHeader?: boolean` flag. When `true`, the POST handler checks for the `X-Azure-DevOps-PAT` header before creating a session and returns HTTP 401 if absent or empty. This keeps the decision of _whether_ to require the header in `index.ts`, not in `http-server.ts`.

**Alternatives considered:**

- Factory throws a typed error, `http-server.ts` catches and maps to 401 — error-as-flow-control, harder to test.
- `http-server.ts` always reads the header and always passes it; 401 logic only in the factory — the HTTP layer then returns 500 for what is logically a 401 client error.

### 4. New CLI auth type: `request`

Adds `"request"` to the `--authentication` choices. It is only meaningful with `--transport http`; using it with `--transport stdio` logs a warning and exits. Starting with `--transport http --authentication request` requires no PAT env var.

**Alternatives considered:**

- Auto-detect based on `--transport http` — implicit, hard to document and opt out of.
- Re-use `envvar` with a flag — muddies the existing type.

### 5. `createPatAuthHeaderProvider` helper in `src/auth.ts`

A new exported function `createPatAuthHeaderProvider(rawPat: string)` encapsulates encoding a raw PAT into `Basic <base64(:pat)>`. This avoids duplicating the encoding logic in `index.ts` and keeps all auth formatting in one file.

## Risks / Trade-offs

- **PAT exposed in HTTP headers** → Mitigation: document that `--transport http --authentication request` MUST be run behind TLS in production; the README warning is updated accordingly.
- **`createServerForSession` signature change** → callers outside this repo that construct `HttpServerOptions` will need to update; mitigated by making `pat` optional (`pat?: string`) so existing non-`request` factories compile unchanged.
- **No PAT refresh** → long-lived sessions use the PAT supplied at initialization. If the PAT is revoked mid-session, subsequent tool calls fail with 401 from ADO. Mitigation: out of scope; clients should re-initialize.

## Migration Plan

1. Add `createPatAuthHeaderProvider` to `src/auth.ts`.
2. Change `HttpServerOptions.createServerForSession` to `(pat?: string) => McpServer` and add `requirePatHeader?: boolean`.
3. Update the POST handler in `src/http-server.ts` for the 401 guard.
4. Add `"request"` to yargs choices and the `request` branch in `main()` in `src/index.ts`.
5. Update README.

No rollback needed — the change is purely additive to the CLI interface; all existing flags/behaviors are unchanged.

## Open Questions

- Should `request` mode also accept a fallback env var if the header is absent (graceful degradation)? Current answer: no — the whole point is to remove the env-var requirement.
