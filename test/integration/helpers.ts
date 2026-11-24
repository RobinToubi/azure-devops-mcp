// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";

/**
 * Safety net for integration tests that run against a PRODUCTION Azure DevOps Server.
 *
 *  - every call must target the single project configured in ADO_SELFHOSTED_PROJECT;
 *  - only read-only (tool, action) pairs from the allowlist below can be called;
 *  - anything else throws BEFORE the request leaves the test process.
 */
export const READ_ONLY_ACTIONS: Record<string, string[] | "*"> = {
  core_list_projects: "*",
  core_list_project_teams: "*",
  repo_repository: ["get", "list"],
  repo_branch: ["list", "get"],
  wit_query: ["get", "wiql"],
  wit_work_item: ["get", "get_batch", "list_comments", "list_revisions", "get_type"],
  pipelines_build: ["list", "get_status", "get_changes"],
  pipelines_definition: ["list", "get"],
  wiki: ["list_wikis", "get_wiki", "list_pages", "get_page", "get_page_content"],
  search_code: "*",
  search_workitem: "*",
  search_wiki: "*",
};

export function createScopedClient(client: Client, project: string) {
  const isSameProject = (value: unknown) => typeof value === "string" && value.toLowerCase() === project.toLowerCase();

  return {
    async call(name: string, args: Record<string, unknown> = {}) {
      const allowed = READ_ONLY_ACTIONS[name];
      if (!allowed) throw new Error(`[safety] tool '${name}' is not in the read-only allowlist`);
      if (allowed !== "*" && !allowed.includes(String(args.action))) {
        throw new Error(`[safety] action '${String(args.action)}' of '${name}' is not allowed (read-only: ${allowed.join(", ")})`);
      }

      // `project` (string) or `project` (string[] for search) must be exactly the configured project.
      const requested = args.project;
      if (name === "core_list_projects") {
        if (!isSameProject(args.projectNameFilter)) throw new Error("[safety] core_list_projects requires projectNameFilter = ADO_SELFHOSTED_PROJECT");
      } else if (name.startsWith("search_")) {
        if (!Array.isArray(requested) || requested.length !== 1 || !isSameProject(requested[0])) throw new Error("[safety] search calls must be filtered on [ADO_SELFHOSTED_PROJECT]");
      } else if (!isSameProject(requested)) {
        throw new Error(`[safety] '${name}' must target project '${project}' (got '${String(requested)}')`);
      }

      return client.callTool({ name, arguments: args });
    },
  };
}

export function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
}

/** Tool results are wrapped in untrusted-content markers: strip them and parse the JSON payload when possible. */
export function payloadOf(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const lines = textOf(result).split("\n");
  const body = lines[0]?.startsWith("<<") ? lines.slice(1, lines[lines.length - 1]?.startsWith("<</") ? -1 : undefined).join("\n") : lines.join("\n");
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
