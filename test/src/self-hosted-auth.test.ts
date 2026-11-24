// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@azure/identity", () => ({
  AzureCliCredential: jest.fn(),
  ChainedTokenCredential: jest.fn(),
  DefaultAzureCredential: jest.fn(),
}));
jest.mock("../../src/oauth", () => ({ azureDevOpsScopes: [], OAuthAuthenticator: jest.fn() }));

// auth.ts keeps module-level state (trusted hosts, registered credentials): load a fresh copy per test.
function loadAuth() {
  let auth!: typeof import("../../src/auth");
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    auth = require("../../src/auth");
  });
  return auth;
}

describe("self-hosted PAT handling in the fetch interceptor", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const sentAuthorization = () => new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get("Authorization");

  it("refuses to send a PAT to a self-hosted host that was not trusted", async () => {
    const { registerPatCredential } = loadAuth();
    registerPatCredential("raw-pat", "b64");

    await expect(fetch("https://tfs.contoso.com/tfs/DefaultCollection/_apis/projects", { headers: { Authorization: "Bearer raw-pat" } })).rejects.toThrow("untrusted destination");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rewrites Bearer to Basic for the trusted self-hosted host (https)", async () => {
    const { registerPatCredential, allowPatHostFromUrl } = loadAuth();
    allowPatHostFromUrl("https://tfs.contoso.com/tfs/DefaultCollection");
    registerPatCredential("raw-pat", "b64");

    await fetch("https://tfs.contoso.com/tfs/DefaultCollection/_apis/projects", { headers: { Authorization: "Bearer raw-pat" } });

    expect(sentAuthorization()).toBe("Basic b64");
  });

  it("accepts plain http only when the operator configured an http:// URL", async () => {
    const strict = loadAuth();
    strict.allowPatHostFromUrl("https://tfs.contoso.com/tfs");
    strict.registerPatCredential("raw-pat", "b64");
    await expect(fetch("http://tfs.contoso.com/tfs/_apis/projects", { headers: { Authorization: "Bearer raw-pat" } })).rejects.toThrow("untrusted destination");

    globalThis.fetch = fetchMock as unknown as typeof fetch; // fresh module instance, fresh interceptor
    const lax = loadAuth();
    lax.allowPatHostFromUrl("http://tfs.contoso.com/tfs");
    lax.registerPatCredential("raw-pat", "b64");
    await fetch("http://tfs.contoso.com/tfs/_apis/projects", { headers: { Authorization: "Bearer raw-pat" } });
    expect(sentAuthorization()).toBe("Basic b64");
  });

  it("never sends the PAT to another host, even when a self-hosted host is trusted", async () => {
    const { registerPatCredential, allowPatHostFromUrl } = loadAuth();
    allowPatHostFromUrl("http://tfs.contoso.com/tfs");
    registerPatCredential("raw-pat", "b64");

    await expect(fetch("http://attacker.example/tfs", { headers: { Authorization: "Bearer raw-pat" } })).rejects.toThrow("untrusted destination");
  });

  it("supports several PATs (one per HTTP session) at the same time", async () => {
    const { registerPatCredential, allowPatHostFromUrl } = loadAuth();
    allowPatHostFromUrl("https://tfs.contoso.com/tfs");
    registerPatCredential("pat-a", "basic-a");
    registerPatCredential("pat-b", "basic-b");

    await fetch("https://tfs.contoso.com/tfs/_apis/projects", { headers: { Authorization: "Bearer pat-b" } });
    expect(sentAuthorization()).toBe("Basic basic-b");
  });

  it("leaves unrelated Authorization headers untouched", async () => {
    const { registerPatCredential } = loadAuth();
    registerPatCredential("raw-pat", "b64");

    await fetch("https://example.com/", { headers: { Authorization: "Bearer something-else" } });

    expect(sentAuthorization()).toBe("Bearer something-else");
  });
});
