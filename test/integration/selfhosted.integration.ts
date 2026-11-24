// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * End-to-end tests against a real Azure DevOps Server (self-hosted) instance.
 *
 * Required environment variables (the whole suite is skipped when one is missing):
 *   ADO_SELFHOSTED_URL    Collection URL, e.g. https://tfs.contoso.com/tfs/DefaultCollection
 *   ADO_SELFHOSTED_PAT    Personal Access Token (raw, NOT base64) with Project & Team read scope
 * Optional:
 *   ADO_SELFHOSTED_ORG          Value of the positional <organization> argument (default: DefaultCollection)
 *   ADO_SELFHOSTED_INSECURE     "true" to accept self-signed certificates
 *   ADO_SELFHOSTED_API_VERSION  e.g. "7.0" for older Azure DevOps Server releases
 *
 * The tests spawn the compiled server (dist/index.js): run `npm run build` first, or use `npm run test:selfhosted`.
 */
import { spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.ADO_SELFHOSTED_URL;
const pat = process.env.ADO_SELFHOSTED_PAT;
const org = process.env.ADO_SELFHOSTED_ORG ?? "DefaultCollection";
const insecure = process.env.ADO_SELFHOSTED_INSECURE === "true";
const apiVersion = process.env.ADO_SELFHOSTED_API_VERSION;

const entrypoint = join(__dirname, "..", "..", "dist", "index.js");
const describeSelfHosted = url && pat ? describe : describe.skip;

function serverArgs(extra: string[]): string[] {
  return [entrypoint, org, "--url", url as string, "--authentication", "envvar", "-d", "core", ...(insecure ? ["--insecure"] : []), ...(apiVersion ? ["--api-version", apiVersion] : []), ...extra];
}

const serverEnv = () => ({ ...(process.env as Record<string, string>), ADO_MCP_AUTH_TOKEN: pat as string });

async function expectProjectsListed(client: Client) {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toContain("core_list_projects");

  const result = await client.callTool({ name: "core_list_projects", arguments: {} });
  expect(result.isError).toBeFalsy();
  const text = (result.content as { type: string; text: string }[])[0].text;
  expect(() => JSON.parse(text)).not.toThrow();
}

describeSelfHosted("Azure DevOps Server (self-hosted)", () => {
  beforeAll(() => {
    if (!existsSync(entrypoint)) throw new Error("dist/index.js not found. Run `npm run build` first.");
  });

  it("lists projects over stdio", async () => {
    const client = new Client({ name: "selfhosted-it", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: "node", args: serverArgs([]), env: serverEnv() }));
    try {
      await expectProjectsListed(client);
    } finally {
      await client.close();
    }
  });

  describe("HTTP streamable transport", () => {
    let child: ChildProcess;
    const port = 3300 + Math.floor(Math.random() * 500);

    beforeAll(async () => {
      child = spawn("node", serverArgs(["--transport", "http", "--host", "127.0.0.1", "--port", String(port)]), { env: serverEnv(), stdio: ["ignore", "pipe", "pipe"] });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("HTTP server did not start in time")), 20000);
        const onData = (chunk: Buffer) => {
          if (chunk.toString().includes("listening on")) {
            clearTimeout(timer);
            resolve();
          }
        };
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.once("exit", (code) => reject(new Error(`HTTP server exited early (code ${code})`)));
      });
    });

    afterAll(() => {
      child?.removeAllListeners("exit");
      child?.kill();
    });

    it("lists projects through POST /mcp", async () => {
      const client = new Client({ name: "selfhosted-it-http", version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      try {
        await expectProjectsListed(client);
      } finally {
        await client.close();
      }
    });
  });
});
