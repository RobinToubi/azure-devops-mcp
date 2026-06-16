// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { EventStore } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { logger } from "./logger.js";

type StreamId = string;
type EventId = string;

// Simple in-memory event store enabling SSE resumability (reconnect via Last-Event-ID).
class InMemoryEventStore implements EventStore {
  private events = new Map<EventId, { streamId: StreamId; message: JSONRPCMessage }>();

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const eventId = `${streamId}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    this.events.set(eventId, { streamId, message });
    return eventId;
  }

  async replayEventsAfter(lastEventId: EventId, { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> }): Promise<StreamId> {
    if (!lastEventId || !this.events.has(lastEventId)) return "";

    const streamId = lastEventId.split("_")[0];
    let replaying = false;
    for (const [eventId, { streamId: sid, message }] of this.events) {
      if (eventId === lastEventId) {
        replaying = true;
        continue;
      }
      if (replaying && sid === streamId) {
        await send(eventId, message);
      }
    }
    return streamId;
  }
}

export interface HttpServerOptions {
  port: number;
  host: string;
  // Factory called per new client session; receives the client-supplied PAT (undefined when not in request-auth mode).
  createServerForSession: (pat?: string) => McpServer;
  // When true, POST /mcp returns HTTP 401 if the X-Azure-DevOps-PAT header is absent or empty on InitializeRequests.
  requirePatHeader?: boolean;
  // Whether to register SIGINT/SIGTERM shutdown handlers. Disable in tests.
  registerSignalHandlers?: boolean;
}

export async function startHttpServer(options: HttpServerOptions): Promise<HttpServer> {
  const { port, host, createServerForSession, requirePatHeader = false, registerSignalHandlers = true } = options;

  const isLocalhost = host === "127.0.0.1" || host === "::1" || host === "localhost";
  if (!isLocalhost) {
    logger.warn(`HTTP server binding to ${host} — DNS rebinding protection is reduced. Use 127.0.0.1 for local deployments.`);
  }

  const app = createMcpExpressApp({ host });

  const transports = new Map<string, StreamableHTTPServerTransport>();

  // POST /mcp — receive JSON-RPC messages from the client
  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      if (sessionId) {
        const transport = transports.get(sessionId);
        if (!transport) {
          res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Session not found" },
            id: null,
          });
          return;
        }
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // No session ID — must be an initialize request
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: session ID required for non-initialization requests" },
          id: null,
        });
        return;
      }

      const pat = req.headers["x-azure-devops-pat"] as string | undefined;
      if (requirePatHeader && !pat) {
        res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Unauthorized: X-Azure-DevOps-PAT header is required" },
          id: null,
        });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore: new InMemoryEventStore(),
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport);
          logger.info(`MCP session initialized: ${newSessionId}`);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports.has(sid)) {
          transports.delete(sid);
          logger.info(`MCP session closed: ${sid}`);
        }
      };

      const server = createServerForSession(pat);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("Error handling MCP POST request", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // GET /mcp — open a server-initiated SSE stream for an existing session
  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.error("Error handling MCP GET request", error);
      if (!res.headersSent) res.status(500).send("Internal server error");
    }
  });

  // DELETE /mcp — explicit session termination by the client
  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.error("Error handling MCP DELETE request", error);
      if (!res.headersSent) res.status(500).send("Internal server error");
    }
  });

  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const srv = app
      .listen(port, host, () => {
        const addr = srv.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : port;
        logger.info(`Azure DevOps MCP HTTP server listening on http://${host}:${actualPort}/mcp`);
        resolve(srv);
      })
      .on("error", reject);
  });

  if (registerSignalHandlers) {
    const shutdown = async () => {
      logger.info("Shutting down HTTP MCP server...");
      for (const [sid, transport] of transports) {
        try {
          await transport.close();
          logger.info(`Closed session ${sid}`);
        } catch (error) {
          logger.error(`Error closing session ${sid}`, error);
        }
      }
      transports.clear();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  return httpServer;
}
