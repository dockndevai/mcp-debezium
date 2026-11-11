# Security

`mcp-debezium` exposes Kafka Connect / Debezium connector management to an AI
agent. Treat it like any other privileged automation and grant it least access.

## Principles

- **Start read-only.** Leave `DEBEZIUM_MODE=read-only` until you need to change
  connectors. Tools above the current mode are never registered.
- **Connector configs contain database credentials.** Every config returned by a
  read tool passes through a redactor (`src/redact.ts`) that replaces secret-shaped
  values (`database.password`, keystores, tokens, …) with `***REDACTED***`.
- **Scope with the Connect REST API's own auth/network.** The flags are defence in
  depth; restrict who can reach the Connect REST endpoint and use basic auth /
  network policy as the primary control.
- **Protect critical connectors.** Add production CDC pipelines to
  `DEBEZIUM_PROTECTED_CONNECTORS` so they can be inspected but never paused,
  reconfigured, or deleted through this server. Use `DEBEZIUM_CONNECTOR_ALLOWLIST`
  to limit scope entirely.
- **Gate deletion explicitly.** `delete_connector` requires both `admin` mode and
  `DEBEZIUM_ALLOW_DELETE=true`.
- **Require a human for destructive ops.** Set `DEBEZIUM_REQUIRE_HUMAN_APPROVAL=true` so `delete_connector`,
  `create_connector` and `update_connector_config` are refused when the client cannot show an approval prompt.
  `update_connector_config` shows the human a secret-redacted `current → new` config diff and `create_connector`
  the exact redacted config; values under secret-shaped keys (`password`, `secret`, `token`, `sasl.jaas.config` …) never appear in the prompt, the fingerprint input, the audit log or
  the laya-guard request/log (a changed secret is shown only as "changed"). Each approval is bound to the exact tool and
  arguments (fingerprint) and to the connector's version token; if the connector changed while the human was
  deciding, the action is refused. `delete_connector` also asks the human to type the connector name.
  Kafka Connect has no etag, so the version token is a hash of the connector's name, type, secret-redacted
  config and task layout (task ids). It deliberately excludes the running state and never includes secret
  values, so a rotated password is not detected (for `update_connector_config` the diff still tells the human
  that a secret value changes). Approval receipts are written to the audit log
  (`"audit":"approval"`, with `approvedBy` = `human` or `flag-only`).
- **Preview with dry-run.** `DEBEZIUM_DRY_RUN=true` validates and logs write intent
  without contacting Kafka Connect.
- **Keep the audit log on.** `DEBEZIUM_AUDIT_LOG=true` (default) writes a JSON line
  per guarded operation to stderr.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a
public issue.
