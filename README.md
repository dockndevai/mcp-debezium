# mcp-debezium

[![CI](https://github.com/dockndevai/mcp-debezium/actions/workflows/ci.yml/badge.svg)](https://github.com/dockndevai/mcp-debezium/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/@dockndevai/mcp-debezium)](https://www.npmjs.com/package/@dockndevai/mcp-debezium)

A [Model Context Protocol](https://modelcontextprotocol.io) server for **Debezium** (via the **Kafka Connect** REST API). It lets an MCP-capable client (Claude Desktop, Claude Code, etc.) **monitor and manage change-data-capture connectors** — status, config, restarts, lifecycle — with behaviour controlled entirely by flags.

Safe by default: it starts read-only, can be scoped to an allowlist of connectors, protects critical connectors from mutation, redacts credentials in connector configs, and gates deletion behind an explicit opt-in.

## Features

- **Monitoring** — worker/cluster info, connector list, plugins, per-connector config, status (with failed-task traces), and topics.
- **Management** — create/update, pause/resume, restart connector or a single task.
- **Lifecycle** — delete connectors (admin).
- **Access modes** — `read-only` → `read-write` → `admin`, layered so a mode never exposes tools above its level.
- **Credential redaction** — `database.password` and other secret-shaped config values are replaced with `***REDACTED***` before results are returned.
- **Security flags** — connector allowlist, protected connectors, delete gating, dry-run, and JSON audit logging (see below).

## Security model

| Concern | Flag | Default | Effect |
| --- | --- | --- | --- |
| What can the server do? | `DEBEZIUM_MODE` | `read-only` | `read-only` exposes monitoring only; `read-write` adds lifecycle management; `admin` adds delete. Tools above the mode are **never registered**. |
| Which connectors are in scope? | `DEBEZIUM_CONNECTOR_ALLOWLIST` | *(all)* | When set, operations on other connectors are refused. |
| Which connectors are read-only forever? | `DEBEZIUM_PROTECTED_CONNECTORS` | *(none)* | Inspectable but never paused/reconfigured/deleted. |
| Can it delete? | `DEBEZIUM_ALLOW_DELETE` | `false` | `delete_connector` needs this **and** admin mode. |
| Preview without touching Connect | `DEBEZIUM_DRY_RUN` | `false` | Write/admin tools validate + log intent, then return. |
| Audit trail | `DEBEZIUM_AUDIT_LOG` | `true` | Emits a JSON line to stderr per guarded operation. |
| Credential redaction | *(always on)* | — | Secret-shaped config values are redacted before return. |

## Tools

**Read** (`read-only`+): `cluster_info`, `list_connectors`, `list_connector_plugins`, `get_connector`, `get_connector_config`, `get_connector_status`, `get_connector_topics`

**Write** (`read-write`+): `create_connector`, `update_connector_config`, `pause_connector`, `resume_connector`, `restart_connector`, `restart_task`

**Admin** (`admin`): `delete_connector` (needs `DEBEZIUM_ALLOW_DELETE`)

## Quickstart — add to your agent

Published on npm as [`@dockndevai/mcp-debezium`](https://www.npmjs.com/package/@dockndevai/mcp-debezium). No clone or build needed — your MCP client runs it on demand with `npx`. **Start in `read-only` mode**; see [`.env.example`](.env.example) for every variable and [docs/CLIENTS.md](docs/CLIENTS.md) for the full per-client guide.

**Claude Code** (CLI)

```bash
claude mcp add debezium -e CONNECT_URL="http://localhost:8083" -e DEBEZIUM_MODE="read-only" -- npx -y @dockndevai/mcp-debezium
```

**Claude Desktop · Cursor · Windsurf** — same block in `claude_desktop_config.json`, `.cursor/mcp.json`, or `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "debezium": {
      "command": "npx",
      "args": [
        "-y",
        "@dockndevai/mcp-debezium"
      ],
      "env": {
        "CONNECT_URL": "http://localhost:8083",
        "DEBEZIUM_MODE": "read-only"
      }
    }
  }
}
```

**OpenAI Codex CLI** — in `~/.codex/config.toml`:

```toml
[mcp_servers.debezium]
command = "npx"
args = ["-y", "@dockndevai/mcp-debezium"]
env = { CONNECT_URL = "http://localhost:8083", DEBEZIUM_MODE = "read-only" }
```

**VS Code (GitHub Copilot, Agent mode)** — in `.vscode/mcp.json`:

```json
{
  "servers": {
    "debezium": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@dockndevai/mcp-debezium"
      ],
      "env": {
        "CONNECT_URL": "http://localhost:8083",
        "DEBEZIUM_MODE": "read-only"
      }
    }
  }
}
```

## Example prompts

- *"Which connectors are FAILED, and why?"*
- *"Restart the failed task on `pg-orders`."* (needs `read-write`)
- *"Show the config for `mysql-inventory`."* (credentials come back redacted)

## Run from source (development)

Prefer the published package above. To run from a clone:

```bash
npm install
npm run build
node dist/index.js   # with the environment variables set
```

## Develop

```bash
npm run dev
npm test          # security policy + config redaction
npm run typecheck
```

## Publishing

This server ships a [`server.json`](server.json) for the official MCP registry and an [`mcpName`](package.json) for npm ownership validation. See **[PUBLISHING.md](PUBLISHING.md)** for publishing to npm and listing on the MCP registry, Smithery, Glama, Cursor, and PulseMCP.

## License

MIT
