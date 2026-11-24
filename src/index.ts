#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getBearerHandler, getPersonalAccessTokenHandler, WebApi } from "azure-devops-node-api";
import yargs from "yargs";

import { allowPatHostFromUrl, createAuthenticator, installPatFetchInterceptor, registerPatCredential } from "./auth.js";
import { startHttpServer } from "./http-server.js";
import { setConfig } from "./config.js";
import { logger } from "./logger.js";
import { getOrgTenant } from "./org-tenants.js";
//import { configurePrompts } from "./prompts.js";
import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { getCliArgs, setApiVersions } from "./utils.js";
import { packageVersion } from "./version.js";
import { DomainsManager } from "./shared/domains.js";

function isGitHubCodespaceEnv(): boolean {
  return process.env.CODESPACES === "true" && !!process.env.CODESPACE_NAME;
}

const defaultAuthenticationType = isGitHubCodespaceEnv() ? "azcli" : "interactive";

// Parse command line arguments using yargs
const argv = yargs(getCliArgs())
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
    describe: "Custom Azure DevOps base URL for a self-hosted server (e.g. https://tfs.contoso.com/tfs/DefaultCollection). Defaults to https://dev.azure.com/<organization>.",
    type: "string",
  })
  .option("insecure", {
    describe: "Disable SSL certificate verification (on-premises servers with self-signed certificates)",
    type: "boolean",
    default: false,
  })
  .option("api-version", {
    alias: "v",
    describe: "Azure DevOps REST API version (defaults to 7.2-preview.1). Use e.g. 7.0 / 6.0 for older Azure DevOps Server releases.",
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
    describe: "Port to listen on when using HTTP transport",
    type: "number",
    default: 3000,
  })
  .option("host", {
    describe: "Host to bind to when using HTTP transport",
    type: "string",
    default: "localhost",
  })
  .help()
  .parseSync();

export const orgName = argv.organization as string;
const customUrl = argv.url ? (argv.url as string).replace(/\/+$/, "") : undefined;
const orgUrl = customUrl ?? "https://dev.azure.com/" + orgName;
const isCustomUrl = !!customUrl;
const insecure = !!argv.insecure;

setConfig(orgName, orgUrl, isCustomUrl, insecure);
if (insecure) {
  // Raw fetch() calls (search, wiki, ...) are not covered by the WebApi ignoreSslError option.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}
if (isCustomUrl) {
  // Self-hosted server: trust this host for PAT credentials.
  allowPatHostFromUrl(orgUrl);
}
export { orgUrl, isCustomUrl };

const domainsManager = new DomainsManager(argv.domains);
export const enabledDomains = domainsManager.getEnabledDomains();

function getAzureDevOpsClient(getAzureDevOpsToken: () => Promise<string>, userAgentComposer: UserAgentComposer, authType: string): () => Promise<WebApi> {
  return async () => {
    const accessToken = await getAzureDevOpsToken();
    // For pat, accessToken is base64("{email}:{token}"). Decode to extract the token part,
    // since getPersonalAccessTokenHandler prepends ":" internally and just needs the raw token.
    // For envvar / request, accessToken is a raw PAT — pass it directly to getPersonalAccessTokenHandler.
    const authHandler =
      authType === "pat"
        ? getPersonalAccessTokenHandler(Buffer.from(accessToken, "base64").toString("utf8").split(":").slice(1).join(":"))
        : authType === "envvar" || authType === "request"
          ? getPersonalAccessTokenHandler(accessToken)
          : getBearerHandler(accessToken);
    const connection = new WebApi(
      orgUrl,
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

function buildMcpServer(userAgentComposer: UserAgentComposer, tokenProvider: () => Promise<string>, connectionProvider: () => Promise<WebApi>): McpServer {
  const server = new McpServer({
    name: "Azure DevOps MCP Server",
    version: packageVersion,
    icons: [
      {
        src: "https://cdn.vsassets.io/content/icons/favicon.ico",
      },
    ],
  });
  server.server.oninitialized = () => {
    userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
  };
  // removing prompts until further notice
  // configurePrompts(server);
  configureAllTools(server, tokenProvider, connectionProvider, () => userAgentComposer.userAgent, enabledDomains);
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
    organization: orgName,
    organizationUrl: orgUrl,
    selfHosted: isCustomUrl,
    insecure,
    authentication: argv.authentication,
    transport: argv.transport,
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
      // Raw fetch() calls send "Bearer <rawPat>"; the interceptor rewrites it to "Basic base64(:rawPat)".
      if (rawPat) {
        registerPatCredential(rawPat, Buffer.from(`:${rawPat}`).toString("base64"));
      }
      return buildMcpServer(
        userAgentComposer,
        async () => rawPat,
        getAzureDevOpsClient(async () => rawPat, userAgentComposer, "request")
      );
    };
    await startHttpServer({
      port: argv.port as number,
      host: argv.host as string,
      createServerForSession,
      requirePatHeader: true,
    });
    return;
  }

  // Azure DevOps Server has no tenant: only resolve it for Azure DevOps Services.
  const tenantId = isCustomUrl ? (argv.tenant as string | undefined) : (argv.tenant ?? (await getOrgTenant(orgName)));
  const authenticator = createAuthenticator(argv.authentication, tenantId);

  if (argv.authentication === "pat") {
    const basicValue = await authenticator();
    installPatFetchInterceptor(basicValue);
    logger.debug("PAT mode: global fetch interceptor installed to rewrite Bearer -> Basic auth headers");
  } else if (argv.authentication === "envvar") {
    // Raw PAT in ADO_MCP_AUTH_TOKEN: raw fetch() calls send "Bearer <rawPat>"; rewrite to Basic auth.
    const rawPat = await authenticator();
    registerPatCredential(rawPat, Buffer.from(`:${rawPat}`).toString("base64"));
    logger.debug("envvar mode: global fetch interceptor installed to rewrite Bearer -> Basic auth headers");
  }

  const connectionProvider = getAzureDevOpsClient(authenticator, userAgentComposer, argv.authentication);
  // Factory used by both stdio (once) and HTTP (per session).
  const createServerForSession = (_pat?: string) => buildMcpServer(userAgentComposer, authenticator, connectionProvider);

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
