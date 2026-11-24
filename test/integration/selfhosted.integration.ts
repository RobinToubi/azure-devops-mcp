// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * End-to-end tests against a real Azure DevOps Server (self-hosted) instance - READ ONLY and
 * confined to ONE project, because they are meant to run against production.
 *
 * Required environment variables (the suite is skipped unless URL and PAT are both set):
 *   ADO_SELFHOSTED_URL      Collection URL, e.g. https://tfs.contoso.com/tfs/DefaultCollection
 *   ADO_SELFHOSTED_PAT      Raw Personal Access Token. Use a READ-ONLY, project-scoped PAT.
 *   ADO_SELFHOSTED_PROJECT  The single project the tests are allowed to touch. REQUIRED: if URL and PAT
 *                           are set but this is missing, the suite fails instead of running unscoped.
 * Optional:
 *   ADO_SELFHOSTED_ORG          Positional <organization> argument (default: DefaultCollection)
 *   ADO_SELFHOSTED_INSECURE     "true" to accept self-signed certificates
 *   ADO_SELFHOSTED_API_VERSION  Override the REST API version (default 7.2-preview.1, fine for Server 2025/25H2)
 *
 * Run `npm run test:selfhosted` (builds first). See test/integration/helpers.ts for the safety guard.
 */
import { spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createScopedClient, payloadOf, textOf, READ_ONLY_ACTIONS } from "./helpers";

const url = process.env.ADO_SELFHOSTED_URL;
const pat = process.env.ADO_SELFHOSTED_PAT;
const project = process.env.ADO_SELFHOSTED_PROJECT ?? "";
const org = process.env.ADO_SELFHOSTED_ORG ?? "DefaultCollection";
const insecure = process.env.ADO_SELFHOSTED_INSECURE === "true";
const apiVersion = process.env.ADO_SELFHOSTED_API_VERSION;

const entrypoint = join(__dirname, "..", "..", "dist", "index.js");
const enabled = Boolean(url && pat);
const describeSelfHosted = enabled ? describe : describe.skip;

// Only the domains the read-only checks need are loaded (no write-heavy surface is even registered for search/core).
const DOMAINS = ["core", "work-items", "repositories", "pipelines", "wiki", "search"];

function serverArgs(extra: string[]): string[] {
  return [entrypoint, org, "--url", url as string, "--authentication", "envvar", "-d", ...DOMAINS, ...(insecure ? ["--insecure"] : []), ...(apiVersion ? ["--api-version", apiVersion] : []), ...extra];
}
const serverEnv = () => ({ ...(process.env as Record<string, string>), ADO_MCP_AUTH_TOKEN: pat as string });

describeSelfHosted("Azure DevOps Server (self-hosted) - read-only, single project", () => {
  it("is configured with a project", () => {
    expect(project).not.toBe("");
  });

  describe("safety guard", () => {
    const guarded = createScopedClient({ callTool: jest.fn() } as unknown as Client, "Allowed");

    it("rejects write tools", async () => {
      await expect(guarded.call("wit_work_item_write", { action: "create", project: "Allowed" })).rejects.toThrow("allowlist");
    });
    it("rejects non read-only actions of an allowed tool", async () => {
      await expect(guarded.call("wit_work_item", { action: "my", project: "Allowed" })).rejects.toThrow("not allowed");
    });
    it("rejects other projects, missing project and unscoped searches", async () => {
      await expect(guarded.call("repo_repository", { action: "list", project: "Other" })).rejects.toThrow("must target project");
      await expect(guarded.call("repo_repository", { action: "list" })).rejects.toThrow("must target project");
      await expect(guarded.call("search_code", { searchText: "x" })).rejects.toThrow("filtered on");
      await expect(guarded.call("core_list_projects", {})).rejects.toThrow("projectNameFilter");
    });
    it("only allowlists read-only tools", () => {
      for (const name of Object.keys(READ_ONLY_ACTIONS)) expect(name).not.toMatch(/write|create|upsert|upload|delete|update/);
    });
  });

  describe("stdio transport", () => {
    runReadOnlyChecks(async () => {
      const client = new Client({ name: "selfhosted-it-stdio", version: "1.0.0" });
      await client.connect(new StdioClientTransport({ command: "node", args: serverArgs([]), env: serverEnv() }));
      return client;
    });
  });

  describe("HTTP streamable transport", () => {
    let child: ChildProcess;
    const port = 3300 + Math.floor(Math.random() * 500);

    beforeAll(async () => {
      expect(existsSync(entrypoint)).toBe(true);
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

    runReadOnlyChecks(async () => {
      const client = new Client({ name: "selfhosted-it-http", version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      return client;
    });
  });
});

function runReadOnlyChecks(connect: () => Promise<Client>) {
  let client: Client;
  let ado: ReturnType<typeof createScopedClient>;

  beforeAll(async () => {
    if (!project) throw new Error("ADO_SELFHOSTED_PROJECT is required: refusing to run unscoped against a server");
    client = await connect();
    ado = createScopedClient(client, project);
  });
  afterAll(async () => {
    await client?.close();
  });

  it("exposes the expected tools", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["core_list_projects", "wit_work_item", "repo_repository", "wit_query"]));
  });

  it("finds only the configured project", async () => {
    const result = await ado.call("core_list_projects", { projectNameFilter: project });
    expect(result.isError).toBeFalsy();
    const projects = payloadOf(result) as { name: string }[];
    expect(projects.length).toBeGreaterThan(0);
    for (const p of projects) expect(p.name.toLowerCase()).toContain(project.toLowerCase());
  });

  it("lists the project's teams", async () => {
    const result = await ado.call("core_list_project_teams", { project });
    expect(result.isError).toBeFalsy();
  });

  it("lists the project's repositories", async () => {
    const result = await ado.call("repo_repository", { action: "list", project, top: 5 });
    expect(result.isError).toBeFalsy();
  });

  it("runs a project-scoped WIQL query and reads a work item (api 7.2)", async () => {
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project.replace(/'/g, "''")}' ORDER BY [System.ChangedDate] DESC`;
    const query = await ado.call("wit_query", { action: "wiql", project, wiql, top: 3 });
    expect(query.isError).toBeFalsy();

    const id = /"id"\s*:\s*(\d+)/.exec(textOf(query))?.[1];
    if (!id) return console.warn(`No work item found in project '${project}': skipping read of a single work item`);

    const item = await ado.call("wit_work_item", { action: "get", project, id: Number(id) });
    expect(item.isError).toBeFalsy();
    const teamProject = /"System\.TeamProject"\s*:\s*"([^"]+)"/.exec(textOf(item))?.[1];
    if (teamProject) expect(teamProject.toLowerCase()).toBe(project.toLowerCase());
  });

  it("lists the project's builds", async () => {
    const result = await ado.call("pipelines_build", { action: "list", project, top: 3 });
    expect(result.isError).toBeFalsy();
  });

  it("lists the project's wikis", async () => {
    const result = await ado.call("wiki", { action: "list_wikis", project });
    expect(result.isError).toBeFalsy();
  });

  it("code search stays inside the project (needs the Search extension on the server)", async () => {
    const result = await ado.call("search_code", { searchText: "test", project: [project], top: 3 });
    // The Search extension is optional on Azure DevOps Server: a 404/"not found" is reported, not failed.
    if (result.isError) return console.warn(`search_code unavailable on this server: ${textOf(result).slice(0, 200)}`);
    for (const m of textOf(result).matchAll(/"project"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/g)) expect(m[1].toLowerCase()).toBe(project.toLowerCase());
  });
}
