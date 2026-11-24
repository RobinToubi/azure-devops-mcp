# Azure DevOps MCP Server

> [!IMPORTANT]
> We recommend using the [Remote MCP Server](https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server) instead of this local server. It requires no installation and gets new features first.
>
> [Learn more](#remote-mcp-server-recommended)

This project gives AI agents access to Azure DevOps through the Model Context Protocol (MCP). Use the hosted remote server for the simplest setup, or run the local server when you need a `stdio` connection.

## Table of Contents

1. [Overview](#overview)
2. [Design](#design)
3. [Remote MCP Server (Recommended)](#remote-mcp-server-recommended)
4. [Supported Tools](#supported-tools)
5. [Local MCP Server Installation (Optional)](#local-mcp-server-installation-optional)
6. [Using Domains (Local Server)](#using-domains-local-server)
7. [Project and Team Defaults (Local Server)](#project-and-team-defaults-local-server)
8. [Troubleshooting](#troubleshooting)
9. [Examples and Best Practices](#examples-and-best-practices)
10. [Frequently Asked Questions](#frequently-asked-questions)
11. [Contributing](#contributing)

## Overview

The Azure DevOps MCP Server brings Azure DevOps context to your agents. Try prompts like:

- "List my ADO projects"
- "List ADO Builds for 'Contoso'"
- "List ADO Repos for 'Contoso'"
- "List test plans for 'Contoso'"
- "List teams for project 'Contoso'"
- "List iterations for project 'Contoso'"
- "List my work items for project 'Contoso'"
- "List work items in current iteration for 'Contoso' project and 'Contoso Team'"
- "List all wikis in the 'Contoso' project"
- "Create a wiki page '/Architecture/Overview' with content about system design"
- "Update the wiki page '/Getting Started' with new onboarding instructions"
- "Get the content of the wiki page '/API/Authentication' from the Documentation wiki"

## Design

Each tool handles a focused Azure DevOps task. The server provides a thin layer over the REST APIs, while the AI agent handles higher-level reasoning.

## Remote MCP Server (Recommended)

For complete instructions, see the [Remote MCP Server onboarding documentation](https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server?view=azure-devops).

The remote server will eventually replace the local server. The local server remains supported, but new development will focus on the remote server. Existing local server users should begin planning their migration.

If you encounter issues with tools, need support, or have a feature request, you can report an issue using the [Remote MCP Server issue template](https://github.com/microsoft/azure-devops-mcp/issues/new?template=remote-mcp-server-issue.md). During the preview period, we will track Remote MCP Server issues through this repository.

### Quick Start

Create `.vscode/mcp.json` in your project and add this configuration. Replace `{organization}` with your Azure DevOps organization name.

```json
{
  "servers": {
    "ado-remote-mcp": {
      "url": "https://mcp.dev.azure.com/{organization}",
      "type": "http"
    }
  },
  "inputs": []
}
```

See the [remote server configuration documentation](https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server?view=azure-devops#mcpjson-configuration) for more options.

After saving `.vscode/mcp.json`, start the server from the MCP view in VS Code, then run a prompt like `List ADO projects`.

## Supported Tools

See the [Available Tools](https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server?view=azure-devops#available-tools) documentation for the complete list of available remote tools.

For the complete list of local tools, see [TOOLSET.md](./docs/TOOLSET.md).

## Local MCP Server Installation (Optional)

> [!IMPORTANT]
> Start with the Remote MCP Server first. Use the local MCP Server only if your scenario specifically requires a local `stdio` setup.

These steps use Visual Studio Code and GitHub Copilot. For other supported clients, including Visual Studio 2022, Codex, Claude Code, Cursor, OpenCode, and Kilo Code, see the [getting started guide](./docs/GETTINGSTARTED.md).

### Prerequisites

1. Install [VS Code](https://code.visualstudio.com/download) or [VS Code Insiders](https://code.visualstudio.com/insiders).
2. Install [Node.js 20 or later](https://nodejs.org/en/download).
3. Open your project in VS Code.

### Installation

#### Install from npm

1. Create `.vscode/mcp.json` in your project.
2. Add this configuration:

```json
{
  "servers": {
    "ado": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@azure-devops/mcp", "{organization}"]
    }
  }
}
```

3. Save the file, then start the `ado` server from the MCP view in VS Code.
4. Open GitHub Copilot Chat and switch to [Agent mode](https://code.visualstudio.com/blogs/2025/02/24/introducing-copilot-agent-mode).
5. Select the Azure DevOps tools, then try a prompt such as `List ADO projects`.
6. When prompted, sign in with a Microsoft account that has access to the selected Azure DevOps organization.

To use nightly builds, replace `@azure-devops/mcp` with `@azure-devops/mcp@next` in the configuration.

For better tool selection, add `.github/copilot-instructions.md` to your project with this instruction:

```text
This project uses Azure DevOps. Always check whether the Azure DevOps MCP server has a tool relevant to the user's request.
```

## Using Domains (Local Server)

The local server includes many tools. Domains let you load only the tool groups you need, which keeps the tool list manageable and helps clients with tool limits. Available domains are `core`, `work`, `work-items`, `search`, `test-plans`, `repositories`, `wiki`, `pipelines`, and `advanced-security`.

Add `-d` followed by the domains to the server arguments. For example, this configuration loads only work item-related tools:

```json
{
  "servers": {
    "ado_with_filtered_domains": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@azure-devops/mcp", "{organization}", "-d", "core", "work", "work-items"]
    }
  }
}
```

Always include `core` so the agent can retrieve project information.

> If you omit `-d`, the server loads all domains.

## Project and Team Defaults (Local Server)

Set default Azure DevOps project and team values in `.vscode/mcp.json` so tools can skip selection prompts.

```json
{
  "servers": {
    "ado": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@azure-devops/mcp", "{organization}", "--authentication", "azcli"],
      "env": {
        "ado_mcp_project": "Contoso",
        "ado_mcp_team": "Fabrikam Team"
      }
    }
  }
}
```

## 🐳 Install with Docker

You can also run the Azure DevOps MCP Server using Docker. This is a great option if you want to avoid installing Node.js locally or need a consistent environment.

### Steps

1. **Build the image**:

   ```bash
   docker build -t azure-devops-mcp .
   ```

2. **Run the container**:
   Pass your Azure DevOps organization and any required arguments. For example:

   ```bash
   docker run -i --rm azure-devops-mcp <your-org-name>
   ```

   To use a Personal Access Token (PAT) with Azure DevOps Server:

   ```bash
   docker run -i --rm -e ADO_MCP_AUTH_TOKEN=<your-pat> azure-devops-mcp DefaultCollection --url <your-collection-url> --authentication pat
   ```

> [!NOTE]
> The `-i` flag is required for `stdio` communication with the MCP host.

## 🌐 HTTP Transport (Streamable HTTP)

By default the server uses `stdio` transport (subprocess mode). You can also run it as a standalone HTTP server using the [MCP 2025-11-25 Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http), which allows multiple clients to connect without spawning a new process each time.

### Starting the HTTP server

```bash
npx -y @azure-devops/mcp@latest <organization> --transport http --authentication envvar
```

Or if installed locally:

```bash
mcp-server-azuredevops <organization> --transport http --port 3000 --host 127.0.0.1
```

| Flag          | Default     | Description                        |
| ------------- | ----------- | ---------------------------------- |
| `--transport` | `stdio`     | `stdio` or `http`                  |
| `--port`      | `3000`      | Port to listen on (HTTP mode only) |
| `--host`      | `127.0.0.1` | Bind address (HTTP mode only)      |

The MCP endpoint is available at `http://<host>:<port>/mcp`.

### Authentication recommendations

> [!IMPORTANT]
> For HTTP deployments, use `--authentication envvar` (set `AZURE_DEVOPS_TOKEN` to a Personal Access Token) or `--authentication pat`. The `interactive` and `azcli` authentication modes open a browser popup on the first tool call, which may be unexpected in server deployments.

### Client-provided PAT (`--authentication request`)

Use `--authentication request` when you want each connecting client to supply its own Personal Access Token rather than sharing a single server-level credential. In this mode **no PAT environment variable is needed at startup** — the server reads the token from the `X-Azure-DevOps-PAT` HTTP header sent with each `InitializeRequest`.

```bash
mcp-server-azuredevops <organization> --transport http --authentication request
```

Each MCP client must include the header on every session initialisation:

```
X-Azure-DevOps-PAT: <your-personal-access-token>
```

> [!WARNING]
> PATs travel in plain HTTP headers. **Always run behind TLS** (HTTPS) when using `--authentication request` in production, especially when binding to a non-localhost address.

### Security notes

- When binding to `127.0.0.1` (the default), DNS rebinding protection is automatically enabled.
- Binding to `0.0.0.0` disables DNS rebinding protection — add a reverse proxy with authentication for public-facing deployments.

## 🏢 Azure DevOps Server (On-Premise) Support

The server can talk to a self-hosted **Azure DevOps Server / TFS** instance, over stdio or Streamable HTTP.

| Flag                  | Description                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--url`, `-u`         | Full collection URL, e.g. `https://tfs.contoso.com/tfs/DefaultCollection`. Without it the server targets `dev.azure.com`.       |
| `--authentication`    | Use `pat` (base64 `email:pat` in `PERSONAL_ACCESS_TOKEN`), `envvar` (raw PAT in `ADO_MCP_AUTH_TOKEN`) or `request` (HTTP only). |
| `--api-version`, `-v` | REST API version to request (default `7.2-preview.1`; use e.g. `7.0` / `6.0` for older Server releases).                        |
| `--insecure`          | Accept self-signed TLS certificates.                                                                                            |

The PAT is only ever sent to the host of `--url` (and to Azure DevOps Services hosts); plain `http://` is accepted only if `--url` itself is `http://`.

```bash
ADO_MCP_AUTH_TOKEN=<raw-pat> mcp-server-azuredevops DefaultCollection \
  --url https://tfs.contoso.com/tfs/DefaultCollection --authentication envvar \
  --transport http --host 127.0.0.1 --port 3000
```

### Testing against a self-hosted instance

Unit tests (`npm test`) never reach the network. Integration tests that call a real Azure DevOps Server (stdio and HTTP streamable) are opt-in, **read-only and confined to one project** because they are meant to run against production:

```bash
export ADO_SELFHOSTED_URL=https://tfs.contoso.com/tfs/DefaultCollection
export ADO_SELFHOSTED_PAT=<raw-pat>          # use a read-only PAT scoped to the test project
export ADO_SELFHOSTED_PROJECT=<test-project> # REQUIRED: the only project the tests may touch
# optional: ADO_SELFHOSTED_ORG, ADO_SELFHOSTED_INSECURE=true, ADO_SELFHOSTED_API_VERSION
npm run test:selfhosted
```

Safeguards (`test/integration/helpers.ts`): only an allowlist of read-only tools/actions can be called, every call must target `ADO_SELFHOSTED_PROJECT` (project listing and searches are filtered on it), and the suite fails if the project variable is missing. Without `ADO_SELFHOSTED_URL` / `ADO_SELFHOSTED_PAT` the suite is skipped.

## Troubleshooting

See the [Troubleshooting guide](./docs/TROUBLESHOOTING.md) for help with common issues and logging.

## Examples

See the [examples](./docs/EXAMPLES.md) for sample prompts.

## Frequently Asked Questions

For answers to common questions about the Azure DevOps MCP Server, see the [Frequently Asked Questions](./docs/FAQ.md).

## Contributing

We welcome contributions. During preview, file issues for bugs, enhancements, or documentation improvements.

See our [Contributions Guide](./CONTRIBUTING.md) for:

- Development setup
- Adding new tools
- Code style and testing
- Pull request process

Read the [Contributions Guide](./CONTRIBUTING.md) before creating a pull request.

## Code of Conduct

This project follows the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For questions, see the [FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [open@microsoft.com](mailto:open@microsoft.com).

## Hall of Fame

Thanks to all contributors who make this project awesome! ❤️

[![Contributors](https://contrib.rocks/image?repo=microsoft/azure-devops-mcp)](https://github.com/microsoft/azure-devops-mcp/graphs/contributors)

> Generated with [contrib.rocks](https://contrib.rocks)

## License

Licensed under the [MIT License](./LICENSE.md).

---

_Trademarks: This project may include trademarks or logos for Microsoft or third parties. Use of Microsoft trademarks or logos must follow [Microsoft’s Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Third-party trademarks are subject to their respective policies._

<!-- version: 2023-04-07 [Do not delete this line, it is used for analytics that drive template improvements] -->
