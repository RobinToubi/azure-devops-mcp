// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const distEntry = resolve(process.cwd(), "dist/index.js");

describe("CLI validation: --authentication request + --transport stdio", () => {
  it("exits with code 1 and prints an error when request auth is used with stdio transport", () => {
    const result = spawnSync(process.execPath, [distEntry, "testorg", "--authentication", "request", "--transport", "stdio"], {
      encoding: "utf8",
      timeout: 5000,
    });

    expect(result.status).toBe(1);
    const stderr = result.stderr ?? "";
    const stdout = result.stdout ?? "";
    const combined = stderr + stdout;
    expect(combined).toMatch(/request.*http|http.*request/i);
  });

  it("exits with code 1 when request auth is used without specifying transport (defaults to stdio)", () => {
    const result = spawnSync(process.execPath, [distEntry, "testorg", "--authentication", "request"], {
      encoding: "utf8",
      timeout: 5000,
    });

    expect(result.status).toBe(1);
  });
});
