#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startHttpServer } from "./http-server.js";
import { getBearerHandler, getPersonalAccessTokenHandler, WebApi } from "azure-devops-node-api";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { createAuthenticator, getAuthorizationHeader, createPatAuthHeaderProvider } from "./auth.js";
import { logger } from "./logger.js";
import { getOrgTenant } from "./org-tenants.js";
//import { configurePrompts } from "./prompts.js";
import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { packageVersion } from "./version.js";
import { DomainsManager } from "./shared/domains.js";
import { setApiVersions } from "./utils.js";
import { setConfig } from "./config.js";

function isGitHubCodespaceEnv(): boolean {
  return process.env.CODESPACES === "true" && !!process.env.CODESPACE_NAME;
}

const defaultAuthenticationType = isGitHubCodespaceEnv() ? "azcli" : "interactive";

// Parse command line arguments using yargs
const argv = yargs(hideBin(process.argv))
  .scriptName("mcp-server-azuredevops")
  .usage("Usage: $0 <organization> [options]")
  .version(packageVersion)
  .command("$0 <organization> [options]", "Azure DevOps MCP Server", (yargs) => {
    yargs.positional("organization", {
      describe: "Azure DevOps organization name",
      type: "string",
      demandOption: true,
    });
  })
  .option("domains", {
    alias: "d",
    describe: "Domain(s) to enable: 'all' for everything, or specific domains like 'repositories builds work'. Defaults to 'all'.",
    type: "string",
    array: true,
    default: "all",
  })
  .option("authentication", {
    alias: "a",
    describe: "Type of authentication to use",
    type: "string",
    choices: ["interactive", "azcli", "env", "envvar", "pat", "request"],
    default: defaultAuthenticationType,
  })
  .option("tenant", {
    alias: "t",
    describe: "Azure tenant ID (optional, applied when using 'interactive' and 'azcli' type of authentication)",
    type: "string",
  })
  .option("url", {
    alias: "u",
    describe: "Custom Azure DevOps base URL (e.g. https://tfs.contoso.com/tfs/DefaultCollection)",
    type: "string",
    default: "https://vmproddevops.val.local/tfs/DefaultCollection",
  })
  .option("insecure", {
    describe: "Disable SSL certificate verification (for on-premises servers with self-signed certificates)",
    type: "boolean",
    default: false,
  })
  .option("api-version", {
    alias: "v",
    describe: "Azure DevOps REST API version (defaults to 7.2-preview.1)",
    type: "string",
  })
  .option("transport", {
    describe: "Transport to use: 'stdio' (default) or 'http' (Streamable HTTP server)",
    type: "string",
    choices: ["stdio", "http"],
    default: "stdio",
  })
  .option("port", {
    alias: "p",
    describe: "Port to listen on when using HTTP transport (default: 3000)",
    type: "number",
    default: 3000,
  })
  .option("host", {
    describe: "Host to bind to when using HTTP transport (default: localhost)",
    type: "string",
    default: "localhost",
  })
  .help()
  .parseSync();

const name = argv.organization as string;
const url = (argv.url as string) || "https://dev.azure.com/" + name;
const custom = !!argv.url;
const insecure = !!argv.insecure;

setConfig(name, url, custom, insecure);

export { name as orgName, url as orgUrl, custom as isCustomUrl };

const domainsManager = new DomainsManager(argv.domains);
export const enabledDomains = domainsManager.getEnabledDomains();

function getAzureDevOpsClient(getAzureDevOpsToken: () => Promise<string>, userAgentComposer: UserAgentComposer, authType: string): () => Promise<WebApi> {
  return async () => {
    const accessToken = await getAzureDevOpsToken();
    // For pat, accessToken is base64("{email}:{token}"). Decode to extract the token part,
    // since getPersonalAccessTokenHandler prepends ":" internally and just needs the raw token.
    // For envvar, accessToken is a raw PAT — pass directly to getPersonalAccessTokenHandler.
    const authHandler =
      authType === "pat"
        ? getPersonalAccessTokenHandler(Buffer.from(accessToken, "base64").toString("utf8").split(":").slice(1).join(":"))
        : authType === "envvar"
          ? getPersonalAccessTokenHandler(accessToken)
          : getBearerHandler(accessToken);
    const connection = new WebApi(
      url,
      authHandler,
      { ignoreSslError: insecure },
      {
        productName: "AzureDevOps.MCP",
        productVersion: packageVersion,
        userAgent: userAgentComposer.userAgent,
      }
    );
    return connection;
  };
}

function buildMcpServer(userAgentComposer: UserAgentComposer, authHeaderProvider: () => Promise<string>, connectionProvider: () => Promise<WebApi>): McpServer {
  const server = new McpServer({
    name: "Azure DevOps MCP Server",
    version: packageVersion,
    icons: [{ src: "https://cdn.vsassets.io/content/icons/favicon.ico" }],
  });
  server.server.oninitialized = () => {
    userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
  };
  // removing prompts until further notice
  // configurePrompts(server);
  configureAllTools(server, authHeaderProvider, connectionProvider, () => userAgentComposer.userAgent, enabledDomains);
  return server;
}

async function main() {
  if (argv["api-version"]) {
    setApiVersions(argv["api-version"] as string);
  }

  // --authentication request is only meaningful with HTTP transport.
  if (argv.authentication === "request" && argv.transport !== "http") {
    logger.error("--authentication request requires --transport http. Use --transport http or choose a different authentication type.");
    process.exit(1);
  }

  logger.info("Starting Azure DevOps MCP Server", {
    organization: name,
    organizationUrl: url,
    authentication: argv.authentication,
    tenant: argv.tenant,
    domains: argv.domains,
    enabledDomains: Array.from(enabledDomains),
    version: packageVersion,
    isCodespace: isGitHubCodespaceEnv(),
  });

  const userAgentComposer = new UserAgentComposer(packageVersion);

  if (argv.authentication === "request") {
    // Per-session PAT mode: credentials come from the X-Azure-DevOps-PAT request header.
    // No startup-time authenticator or env var is required.
    const createServerForSession = (pat?: string) => {
      const rawPat = pat ?? "";
      const sessionAuthHeaderProvider = createPatAuthHeaderProvider(rawPat);
      const sessionConnectionProvider = getAzureDevOpsClient(() => Promise.resolve(rawPat), userAgentComposer, "envvar");
      return buildMcpServer(userAgentComposer, sessionAuthHeaderProvider, sessionConnectionProvider);
    };
    await startHttpServer({
      port: argv.port as number,
      host: argv.host as string,
      createServerForSession,
      requirePatHeader: true,
    });
    return;
  }

  // All other auth types resolve credentials at startup and share them across sessions.
  const tenantId = (await getOrgTenant(name)) ?? (argv.tenant as string);
  const authenticator = createAuthenticator(argv.authentication as string, tenantId);

  // Wrap authenticator to return a fully-formatted Authorization header value
  // (e.g. "Bearer <token>" or "Basic <b64>") for use in raw fetch calls.
  const authHeaderProvider = async () => {
    const token = await authenticator();
    return getAuthorizationHeader(argv.authentication as string, token);
  };

  if (argv.authentication === "pat") {
    const basicValue = await authenticator();
    // basicValue is already base64("{email}:{token}") — use it directly in the Authorization header
    const _originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.headers) {
        const headers = new Headers(init.headers as HeadersInit);
        if (headers.get("Authorization")?.startsWith("Bearer ")) {
          headers.set("Authorization", `Basic ${basicValue}`);
          init = { ...init, headers };
        }
      }
      return _originalFetch(input, init);
    };
    logger.debug("PAT mode: global fetch interceptor installed to rewrite Bearer -> Basic auth headers");
  }

  // removing prompts until further notice
  // configurePrompts(server);
  const connectionProvider = getAzureDevOpsClient(authenticator, userAgentComposer, argv.authentication);

  // Factory used by both stdio (once) and HTTP (per session).
  // In non-request auth modes the pat argument is ignored; startup-resolved credentials are used.
  const createServerForSession = (_pat?: string) => buildMcpServer(userAgentComposer, authHeaderProvider, connectionProvider);

  if (argv.transport === "http") {
    await startHttpServer({
      port: argv.port as number,
      host: argv.host as string,
      createServerForSession,
    });
  } else {
    const server = createServerForSession();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((error) => {
  logger.error("Fatal error in main():", error);
  process.exit(1);
});
