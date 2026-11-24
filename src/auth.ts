// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AzureCliCredential, ChainedTokenCredential, DefaultAzureCredential, TokenCredential } from "@azure/identity";
import { logger } from "./logger.js";
import { azureDevOpsScopes, OAuthAuthenticator } from "./oauth.js";

const patAllowedHosts = new Set(["dev.azure.com", "vssps.dev.azure.com", "almsearch.dev.azure.com"]);
// Hosts explicitly trusted by the operator (e.g. an on-premises Azure DevOps Server passed with --url).
const extraPatAllowedHosts = new Set<string>();
// Whether plain http:// is accepted for the trusted extra hosts (on-premises servers without TLS).
let allowInsecureHttpForExtraHosts = false;
// Maps a Bearer header value to the Basic credential it is rewritten to; every registered PAT is rewritten this way.
const patCredentials = new Map<string, string>();
const interceptorMarker = Symbol.for("azure-devops-mcp.patFetchInterceptor");

function isPatAllowedHost(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  return patAllowedHosts.has(normalizedHostname) || normalizedHostname.endsWith(".visualstudio.com") || extraPatAllowedHosts.has(normalizedHostname);
}

/**
 * Trusts an additional host (Azure DevOps Server) to receive PAT credentials.
 * Only the host of the URL explicitly provided by the operator should be registered here.
 */
function allowPatHostFromUrl(url: string): void {
  const parsed = new URL(url);
  extraPatAllowedHosts.add(parsed.hostname.toLowerCase());
  if (parsed.protocol === "http:") {
    allowInsecureHttpForExtraHosts = true;
  }
}

function isTrustedPatDestination(requestUrl: URL): boolean {
  if (!isPatAllowedHost(requestUrl.hostname)) {
    return false;
  }
  if (requestUrl.protocol === "https:") {
    return true;
  }
  return requestUrl.protocol === "http:" && allowInsecureHttpForExtraHosts && extraPatAllowedHosts.has(requestUrl.hostname.toLowerCase());
}

/**
 * Registers a credential rewritten by the fetch interceptor: requests carrying `Authorization: Bearer <bearerToken>`
 * are sent with `Authorization: Basic <basicValue>` instead.
 */
function registerPatCredential(bearerToken: string, basicValue: string): void {
  patCredentials.set(`Bearer ${bearerToken}`, basicValue);
  installFetchInterceptor();
}

function installPatFetchInterceptor(basicValue: string): void {
  registerPatCredential(basicValue, basicValue);
}

function installFetchInterceptor(): void {
  // Avoid stacking wrappers when several credentials are registered (one wrapper looks them all up).
  if ((globalThis.fetch as unknown as Record<symbol, unknown>)[interceptorMarker]) {
    return;
  }
  const originalFetch = globalThis.fetch;

  const interceptingFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const basicValue = patCredentials.get(headers.get("Authorization") ?? "");
    if (basicValue === undefined) {
      return originalFetch(input, init);
    }

    const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
    if (!isTrustedPatDestination(requestUrl)) {
      throw new Error(`Refusing to send a Personal Access Token to untrusted destination '${requestUrl.origin}'`);
    }

    headers.set("Authorization", `Basic ${basicValue}`);
    if (input instanceof Request) {
      return originalFetch(new Request(input, { ...init, headers }));
    }
    return originalFetch(input, { ...init, headers });
  };
  (interceptingFetch as unknown as Record<symbol, unknown>)[interceptorMarker] = true;
  globalThis.fetch = interceptingFetch as typeof fetch;
}

function createAuthenticator(type: string, tenantId?: string): () => Promise<string> {
  logger.debug(`Creating authenticator of type '${type}' with tenantId='${tenantId ?? "undefined"}'`);
  switch (type) {
    case "pat":
      logger.debug(`Authenticator: Using PAT authentication (PERSONAL_ACCESS_TOKEN)`);
      return async () => {
        logger.debug(`${type}: Reading token from PERSONAL_ACCESS_TOKEN environment variable`);
        const b64Pat = process.env["PERSONAL_ACCESS_TOKEN"];
        if (!b64Pat) {
          logger.error(`${type}: PERSONAL_ACCESS_TOKEN environment variable is not set or empty`);
          throw new Error("Environment variable 'PERSONAL_ACCESS_TOKEN' is not set or empty. Please set it with a valid base64-encoded Azure DevOps Personal Access Token.");
        }
        // Return base64 value as-is — caller uses it directly as the Basic auth credential
        logger.debug(`${type}: Successfully retrieved PAT from environment variable`);
        return b64Pat;
      };

    case "envvar":
      logger.debug(`Authenticator: Using environment variable authentication (ADO_MCP_AUTH_TOKEN)`);
      // Read token from fixed environment variable
      return async () => {
        logger.debug(`${type}: Reading token from ADO_MCP_AUTH_TOKEN environment variable`);
        const token = process.env["ADO_MCP_AUTH_TOKEN"];
        if (!token) {
          logger.error(`${type}: ADO_MCP_AUTH_TOKEN environment variable is not set or empty`);
          throw new Error("Environment variable 'ADO_MCP_AUTH_TOKEN' is not set or empty. Please set it with a valid Azure DevOps Personal Access Token.");
        }
        logger.debug(`${type}: Successfully retrieved token from environment variable`);
        return token;
      };

    case "azcli":
    case "env":
      if (type !== "env") {
        logger.debug(`${type}: Setting AZURE_TOKEN_CREDENTIALS to 'dev' for development credential chain`);
        process.env.AZURE_TOKEN_CREDENTIALS = "dev";
      }
      let credential: TokenCredential = new DefaultAzureCredential(); // CodeQL [SM05138] resolved by explicitly setting AZURE_TOKEN_CREDENTIALS
      if (tenantId) {
        // Use Azure CLI credential if tenantId is provided for multi-tenant scenarios
        const azureCliCredential = new AzureCliCredential({ tenantId });
        credential = new ChainedTokenCredential(azureCliCredential, credential);
      }
      return async () => {
        const result = await credential.getToken(azureDevOpsScopes);
        if (!result) {
          logger.error(`${type}: Failed to obtain token - credential.getToken returned null/undefined`);
          throw new Error("Failed to obtain Azure DevOps token. Ensure you have Azure CLI logged or use interactive type of authentication.");
        }
        logger.debug(`${type}: Successfully obtained Azure DevOps token`);
        return result.token;
      };

    default:
      logger.debug(`Authenticator: Using OAuth interactive authentication (default)`);
      const authenticator = new OAuthAuthenticator(tenantId);
      return () => {
        return authenticator.getToken();
      };
  }
}
export { createAuthenticator, installPatFetchInterceptor, registerPatCredential, allowPatHostFromUrl };
