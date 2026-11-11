# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-11-11

### Security
- **Approval no longer fails open on timeout.** The human-approval prompt used the MCP SDK's default
  60 s request timeout, and a timeout fell through to "approved" (the `*_ALLOW_DELETE` gate had already
  passed). A prompt nobody answered therefore auto-approved a destructive operation. A timeout is now a
  refusal, and the wait defaults to 5 minutes.

- **Secrets no longer reach laya-guard.** The guard `command` was built as `tool + JSON.stringify(rawArgs)`,
  so `create_connector` / `update_connector_config` sent `database.password` (and other secret-shaped config
  values) to the guard daemon, showed them unredacted in the guard confirmation prompt, and wrote the first
  200 characters to the guard log. Arguments are now redacted (`redact.ts`, then the canonical form from
  `elicit.ts`) once, before they are shown in any prompt, hashed into the fingerprint, sent to the guard or
  logged.

### Added
- **`create_connector` and `update_connector_config` now ask the human before changing a CDC pipeline.**
  `update_connector_config` shows a secret-redacted `current → new` config diff (a changed secret is reported
  as "changed", never printed) and pins the connector's version token across the prompt: it is refused if the
  connector changed while the human was deciding, including between the diff being read and the prompt being
  sent. `update_connector_config` on a name that does not exist (Kafka Connect's PUT would create it) says so.
  `create_connector` shows the exact redacted config and is refused if a connector of that name appears
  during the prompt; it also stops early if one already exists. `DEBEZIUM_REQUIRE_HUMAN_APPROVAL=true`
  applies to both. Dry-run is unchanged (no network call, no prompt).
- **Approvals are bound to the exact action.** The prompt shows the tool, the full (secret-redacted)
  arguments and a fingerprint; every approval and refusal is written to the audit log as
  `"audit":"approval"` with the fingerprint, resource version and `approvedBy` (`human` / `flag-only`).
- **Approvals are bound to the target's version.** `delete_connector` reads a version token before the
  prompt and again after the human answers, and refuses if it changed. Kafka Connect has no etag, so the
  token is a hash of the connector's name, type, secret-redacted config and task layout; the running
  state is excluded and secret values are never hashed (a rotated password is not detected).
- `DEBEZIUM_REQUIRE_HUMAN_APPROVAL=true` — refuse destructive ops when the client cannot elicit.
- `delete_connector` asks the human to type the connector name.

Tracking issue: https://github.com/dockndevai/mcp-core/issues/1

## [0.3.5] - 2026-11-09

### Changed
- Routine dependency/security maintenance. `npm audit --audit-level=high` reported 0
  vulnerabilities before and after this pass.
- Took the safe in-range minor bump: `vitest` 5.0.5 → 5.1.0 (dev dependency). No direct
  dependency crossed a major version boundary; `npm run typecheck`, `npm run build`, and
  `npm test` all pass; final `npm audit` is clean.

### Note
- v0.3.1–v0.3.4 are committed to `main` from prior maintenance passes but were never
  tagged/released — the npm registry's `latest` dist-tag is still 0.3.0. Tagging/publishing
  is blocked for this automated session (pushing a `v*` tag is denied by the session's
  permission policy as "create public surface"); a human needs to push the release tag(s)
  to actually publish.

## [0.3.4] - 2026-11-02

### Changed
- Routine weekly dependency maintenance: `npm audit --audit-level=high` reported 0 advisories (no high/critical findings). Took the safe in-range patch bump for `@types/node` (26.6.5 → 26.6.6); no direct dependency crossed a major version boundary. `npm audit` reports 0 vulnerabilities after the bump.

## [0.3.3] - 2026-10-26

### Changed
- Routine weekly dependency maintenance: `npm audit --audit-level=high` flagged a high-severity `body-parser` DoS advisory (GHSA-27r3-jxmh-p828) and a moderate `fast-uri` advisory chain; resolved both via `npm audit fix` (transitive bumps `body-parser` 2.3.0 → 2.4.0, `fast-uri` 3.1.8 → 3.1.9, `qs` 6.16.0 → 6.16.1), no direct dependency crossed a major version. Took the in-range patch bump for `@modelcontextprotocol/sdk` (1.32.1 → 1.32.2). `npm audit` reports 0 vulnerabilities after the bumps.

## [0.3.2] - 2026-10-19

### Changed
- Routine weekly dependency maintenance: `npm audit --audit-level=high` reported 0 advisories (no high/critical findings). Took safe in-range patch bumps for `vitest` (5.0.3 → 5.0.5) and `zod` (4.6.6 → 4.6.7); no direct dependency crossed a major version boundary. `npm audit` reports 0 vulnerabilities after the bumps.

## [0.3.1] - 2026-10-12

### Security
- Dependency/security maintenance: `npm audit fix` cleared 2 high + 1 critical transitive advisories (`@modelcontextprotocol/sdk`'s `express`→`proxy-addr` IP-spoofing issue, and vitest's `vite`→`postcss`→`source-map-js` DoS issue). In-range patch/minor bumps for `@types/node`, `tsx`, `vitest`, and `zod`. `npm audit` now reports 0 vulnerabilities.

## [0.3.0] - 2026-09-29

### Added
- **Optional AI risk guard (laya-guard).** Mutating tools can consult a local [laya-guard](https://github.com/dockndevai/laya-guard) daemon that classifies each operation allow / confirm / block before it runs. Runs after the deterministic policy gates and can only *tighten*, never grant; fails closed. Off by default (`DEBEZIUM_GUARD_MODE=monitor|enforce`).

## [0.2.2] - 2026-09-12

### Changed
- Bring dependencies and CI to current majors: `zod` ^4, TypeScript ^7, `@types/node` ^26, `tsx` ^4.23, and GitHub Actions (checkout v7, setup-node v7, action-gh-release v3, gitleaks v3, codeql-action v4). Clears the open Dependabot updates; `npm audit` reports 0 vulnerabilities.

## [0.2.1] - 2026-09-10

### Documentation
- Document the interactive-confirmation (MCP elicitation) behaviour in the safe-by-default section.

## [0.2.0] - 2026-09-10

### Added
- **Human-in-the-loop confirmation for destructive actions**, via MCP [elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation). When the connected client supports elicitation, `delete_connector` now pause and ask the **human** to approve the exact action before it runs — a model can echo a confirmation string, but it cannot approve a prompt shown to the user. Clients that don't advertise elicitation fall back to the existing `*_ALLOW_*` flag gate, so enabling this is never *more* permissive than before.

## [0.1.3] - 2026-09-09

### Changed
- Require **Node 22** (previously Node 20); the updated dependency tree needs Node ≥ 22.19. CI and release workflows, the Dockerfile base image, and `engines` were updated.
- Bump the test runner `vitest` to ^5.0.0.

### Security
- Refresh the dependency tree to clear the moderate `hono` and `qs` advisories (transitive via the MCP SDK's HTTP transport, unused by this stdio server) and the `vitest` advisory; `npm audit` now reports **0 vulnerabilities**.

## [0.1.2] - 2026-08-30

### Changed
- Bump `@modelcontextprotocol/sdk` to ^1.30.0 to clear known dependency advisories flagged by supply-chain scanners.

## [0.1.1] - 2026-08-28

### Added
- MCP **tool annotations** on every tool (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`), derived from each tool's access
  capability. Hosts can now reason about a tool's safety from structured
  metadata instead of parsing the description — read tools are advertised as
  read-only and non-destructive, admin/destructive tools as mutating.
- A test that keeps the annotations consistent with each tool's capability.

## [0.1.0]

### Added
- Initial release.
