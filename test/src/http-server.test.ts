// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, beforeAll, afterAll, jest } from "@jest/globals";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startHttpServer } from "../../src/http-server.js";

// Prevent the real winston/azure-logger chain from loading in jest's CommonJS environment.
jest.mock("../../src/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const INITIALIZE_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

const PING_REQUEST = {
  jsonrpc: "2.0",
  id: 2,
  method: "ping",
  params: {},
};

function createTestServer() {
  return new McpServer({ name: "test-server", version: "1.0.0" });
}

function serverUrl(server: HttpServer, path = "/mcp") {
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}${path}`;
}

// Parse the first JSON-RPC message from an SSE or plain-JSON response body.
async function parseJsonRpcResponse(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (contentType.includes("application/json")) {
    return JSON.parse(text);
  }
  // SSE format: find the first non-empty `data:` line that contains a JSON object
  for (const line of text.split("\n")) {
    const trimmed = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  }
  return null;
}

async function closeServer(server: HttpServer) {
  return new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe("HTTP MCP server", () => {
  let server: HttpServer;

  beforeAll(async () => {
    server = await startHttpServer({
      port: 0,
      host: "127.0.0.1",
      createServerForSession: createTestServer,
      registerSignalHandlers: false,
    });
  });

  afterAll(async () => {
    await closeServer(server);
  });

  describe("POST /mcp", () => {
    it("initializes a new session and returns MCP-Session-Id header", async () => {
      const res = await fetch(serverUrl(server), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: JSON.stringify(INITIALIZE_REQUEST),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("mcp-session-id")).toBeTruthy();
      const body = (await parseJsonRpcResponse(res)) as { result: { protocolVersion: string; serverInfo: unknown } };
      expect(body?.result).toHaveProperty("protocolVersion");
      expect(body?.result).toHaveProperty("serverInfo");
    });

    it("routes subsequent requests to an existing session", async () => {
      // First initialize
      const initRes = await fetch(serverUrl(server), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: JSON.stringify(INITIALIZE_REQUEST),
      });
      const sessionId = initRes.headers.get("mcp-session-id")!;
      expect(sessionId).toBeTruthy();

      // Then send initialized notification (should return 202)
      const notifRes = await fetch(serverUrl(server), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "mcp-session-id": sessionId,
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      });
      expect(notifRes.status).toBe(202);

      // Then send a ping (notifications/initialized must arrive before ping)
      const pingRes = await fetch(serverUrl(server), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "mcp-session-id": sessionId,
        },
        body: JSON.stringify(PING_REQUEST),
      });
      expect([200, 202]).toContain(pingRes.status);
    });

    it("returns 404 for an unknown session ID", async () => {
      const res = await fetch(serverUrl(server), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "mcp-session-id": "00000000-0000-0000-0000-000000000000",
        },
        body: JSON.stringify(PING_REQUEST),
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 when no session ID is provided and body is not an initialize request", async () => {
      const res = await fetch(serverUrl(server), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: JSON.stringify(PING_REQUEST),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /mcp", () => {
    it("returns 400 when no session ID is provided", async () => {
      const res = await fetch(serverUrl(server), { method: "GET" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for an unknown session ID", async () => {
      const res = await fetch(serverUrl(server), {
        method: "GET",
        headers: { "mcp-session-id": "00000000-0000-0000-0000-000000000000" },
      });
      expect(res.status).toBe(400);
    });

    it("opens an SSE stream for a valid session ID", async () => {
      const initRes = await fetch(serverUrl(server), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: JSON.stringify(INITIALIZE_REQUEST),
      });
      const sessionId = initRes.headers.get("mcp-session-id")!;

      const ac = new AbortController();
      const getRes = await fetch(serverUrl(server), {
        method: "GET",
        headers: { "Accept": "text/event-stream", "mcp-session-id": sessionId },
        signal: ac.signal,
      });

      expect(getRes.status).toBe(200);
      expect(getRes.headers.get("content-type")).toMatch(/text\/event-stream/);
      ac.abort(); // clean up the SSE connection
    });
  });

  describe("DELETE /mcp", () => {
    it("returns 400 for an unknown session ID", async () => {
      const res = await fetch(serverUrl(server), {
        method: "DELETE",
        headers: { "mcp-session-id": "00000000-0000-0000-0000-000000000000" },
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when no session ID is provided", async () => {
      const res = await fetch(serverUrl(server), { method: "DELETE" });
      expect(res.status).toBe(400);
    });

    it("terminates a valid session", async () => {
      const initRes = await fetch(serverUrl(server), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: JSON.stringify(INITIALIZE_REQUEST),
      });
      const sessionId = initRes.headers.get("mcp-session-id")!;

      const deleteRes = await fetch(serverUrl(server), {
        method: "DELETE",
        headers: { "mcp-session-id": sessionId },
      });

      // The transport handles DELETE and closes the session
      expect([200, 204, 405]).toContain(deleteRes.status);

      // After termination, subsequent requests to this session should return 404
      const postRes = await fetch(serverUrl(server), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "mcp-session-id": sessionId,
        },
        body: JSON.stringify(PING_REQUEST),
      });
      expect(postRes.status).toBe(404);
    });
  });
});

describe("HTTP MCP server — requirePatHeader mode", () => {
  let server: HttpServer;
  const capturedPats: (string | undefined)[] = [];

  beforeAll(async () => {
    server = await startHttpServer({
      port: 0,
      host: "127.0.0.1",
      requirePatHeader: true,
      createServerForSession: (pat) => {
        capturedPats.push(pat);
        return new McpServer({ name: "test-server", version: "1.0.0" });
      },
      registerSignalHandlers: false,
    });
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("returns 401 when InitializeRequest has no X-Azure-DevOps-PAT header", async () => {
    const res = await fetch(serverUrl(server), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body: JSON.stringify(INITIALIZE_REQUEST),
    });

    expect(res.status).toBe(401);
  });

  it("returns 401 when InitializeRequest has an empty X-Azure-DevOps-PAT header", async () => {
    const res = await fetch(serverUrl(server), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "x-azure-devops-pat": "",
      },
      body: JSON.stringify(INITIALIZE_REQUEST),
    });

    expect(res.status).toBe(401);
  });

  it("creates a session and passes PAT to the factory when X-Azure-DevOps-PAT header is present", async () => {
    const testPat = "my-secret-pat-token";
    capturedPats.length = 0;

    const res = await fetch(serverUrl(server), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "x-azure-devops-pat": testPat,
      },
      body: JSON.stringify(INITIALIZE_REQUEST),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    expect(capturedPats).toContain(testPat);
  });
});

describe("HTTP MCP server — requirePatHeader absent (default behaviour unchanged)", () => {
  let server: HttpServer;

  beforeAll(async () => {
    server = await startHttpServer({
      port: 0,
      host: "127.0.0.1",
      createServerForSession: createTestServer,
      registerSignalHandlers: false,
    });
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("initializes a session without any PAT header when requirePatHeader is not set", async () => {
    const res = await fetch(serverUrl(server), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body: JSON.stringify(INITIALIZE_REQUEST),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
  });
});

describe("HTTP MCP server — non-localhost host warning", () => {
  it("starts on 0.0.0.0 and logs a warning via logger.warn", async () => {
    const { logger } = await import("../../src/logger.js");
    const warnMock = logger.warn as ReturnType<typeof jest.fn>;
    warnMock.mockClear();

    const srv = await startHttpServer({
      port: 0,
      host: "0.0.0.0",
      createServerForSession: createTestServer,
      registerSignalHandlers: false,
    });

    await closeServer(srv);

    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining("DNS rebinding protection is reduced"));
  });
});
