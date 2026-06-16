## 1. Auth Module

- [x] 1.1 Add `createPatAuthHeaderProvider(rawPat: string): () => Promise<string>` to `src/auth.ts` — returns a function that resolves to `Basic <base64(:rawPat)>`
- [x] 1.2 Export `createPatAuthHeaderProvider` from `src/auth.ts`

## 2. HTTP Server

- [x] 2.1 Add `requirePatHeader?: boolean` to `HttpServerOptions` in `src/http-server.ts`
- [x] 2.2 Change `createServerForSession` signature in `HttpServerOptions` from `() => McpServer` to `(pat?: string) => McpServer`
- [x] 2.3 In the `POST /mcp` handler, before creating a new session: extract the `X-Azure-DevOps-PAT` header; if `requirePatHeader` is `true` and the header is absent or empty, respond with HTTP 401 and return
- [x] 2.4 Pass the extracted PAT string (or `undefined`) as the argument to `createServerForSession(pat)` when initialising a new session

## 3. Entry Point (CLI)

- [x] 3.1 Add `"request"` to the `--authentication` yargs `choices` array in `src/index.ts`
- [x] 3.2 After argument parsing, validate that `--authentication request` is only used with `--transport http`; if not, log an error and call `process.exit(1)` with a clear message
- [x] 3.3 In the `http` transport branch of `main()`, detect `argv.authentication === "request"` and build a per-session factory: `(pat?: string) => McpServer` that calls `createPatAuthHeaderProvider(pat)` to produce the session's `authHeaderProvider` and `connectionProvider`
- [x] 3.4 Pass `requirePatHeader: true` to `startHttpServer` when `argv.authentication === "request"`
- [x] 3.5 For non-`request` auth types in HTTP mode, keep `requirePatHeader` absent/`false` and wrap `createServerForSession` to ignore the `pat` argument

## 4. Tests and Validation

- [x] 4.1 In `test/src/http-server.test.ts`: add test — `POST /mcp` with `InitializeRequest` and `requirePatHeader: true` but no `X-Azure-DevOps-PAT` header returns HTTP 401
- [x] 4.2 In `test/src/http-server.test.ts`: add test — `POST /mcp` with `InitializeRequest`, `requirePatHeader: true`, and a valid `X-Azure-DevOps-PAT` header calls `createServerForSession` with the header value
- [x] 4.3 In `test/src/http-server.test.ts`: add test — existing tests still pass when `requirePatHeader` is absent (factory receives `undefined`, no 401)
- [x] 4.4 In `test/src/auth.test.ts` (or existing auth test file): add test — `createPatAuthHeaderProvider("mytoken")()` resolves to `"Basic " + Buffer.from(":mytoken").toString("base64")`
- [x] 4.5 In `test/src/index.test.ts` (or integration test): add test — launching with `--authentication request --transport stdio` exits with code 1 and prints a meaningful error
- [x] 4.6 Run `npm run build` — no TypeScript errors
- [x] 4.7 Run `npm test` — all tests pass and coverage remains above 98%

## 5. Documentation

- [x] 5.1 Add a subsection to the "HTTP Transport" section in `README.md` describing `--authentication request`, the `X-Azure-DevOps-PAT` header, and a TLS warning for production use
