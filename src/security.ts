/**
 * Security policy engine.
 *
 * Flags decide which tools are registered (capability vs. access mode) and
 * whether each individual call is allowed at runtime (connector scoping,
 * protected connectors, destructive-op gating, dry-run). Pure — unit-testable.
 */

export type Capability = "read" | "write" | "admin";
export type AccessMode = "read-only" | "read-write" | "admin";

const MODE_RANK: Record<AccessMode, number> = {
  "read-only": 0,
  "read-write": 1,
  admin: 2,
};

const CAPABILITY_RANK: Record<Capability, number> = {
  read: 0,
  write: 1,
  admin: 2,
};

export interface SecurityConfig {
  mode: AccessMode;
  /** If set, only these connectors may be touched. Empty = all. */
  connectorAllowlist: string[];
  /** Connectors that can be read but never mutated or deleted. */
  protectedConnectors: string[];
  /** Destructive delete_connector requires this to be true. */
  allowDelete: boolean;
  /** Validate + log writes without sending them to Kafka Connect. */
  dryRun: boolean;
  auditLog: boolean;
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export interface GuardContext {
  tool: string;
  capability: Capability;
  connector?: string;
  destructive?: boolean;
}

export class SecurityPolicy {
  constructor(private readonly config: SecurityConfig) {}

  get mode(): AccessMode {
    return this.config.mode;
  }

  isCapabilityEnabled(capability: Capability): boolean {
    return CAPABILITY_RANK[capability] <= MODE_RANK[this.config.mode];
  }

  isConnectorAllowed(name: string): boolean {
    if (this.config.connectorAllowlist.length === 0) return true;
    return this.config.connectorAllowlist.includes(name);
  }

  isConnectorProtected(name: string): boolean {
    return this.config.protectedConnectors.includes(name);
  }

  guard(ctx: GuardContext): { dryRun: boolean } {
    if (!this.isCapabilityEnabled(ctx.capability)) {
      this.audit(ctx, "DENY", `capability '${ctx.capability}' exceeds mode '${this.config.mode}'`);
      throw new PolicyError(
        `Operation '${ctx.tool}' requires '${ctx.capability}' access but the server runs in '${this.config.mode}' mode.`,
      );
    }

    if (ctx.connector !== undefined) {
      if (!this.isConnectorAllowed(ctx.connector)) {
        this.audit(ctx, "DENY", `connector '${ctx.connector}' not in allowlist`);
        throw new PolicyError(
          `Connector '${ctx.connector}' is not in the configured allowlist (DEBEZIUM_CONNECTOR_ALLOWLIST).`,
        );
      }
      if (ctx.capability !== "read" && this.isConnectorProtected(ctx.connector)) {
        this.audit(ctx, "DENY", `connector '${ctx.connector}' is protected`);
        throw new PolicyError(
          `Connector '${ctx.connector}' is protected (DEBEZIUM_PROTECTED_CONNECTORS); mutations are refused.`,
        );
      }
    }

    if (ctx.destructive && !this.config.allowDelete) {
      this.audit(ctx, "DENY", "delete not enabled");
      throw new PolicyError(
        `Destructive operation '${ctx.tool}' is disabled. Set DEBEZIUM_ALLOW_DELETE=true to enable it.`,
      );
    }

    const dryRun = ctx.capability !== "read" && this.config.dryRun;
    this.audit(ctx, dryRun ? "DRY_RUN" : "ALLOW");
    return { dryRun };
  }

  private audit(ctx: GuardContext, decision: string, reason?: string): void {
    if (!this.config.auditLog) return;
    const line = {
      ts: new Date().toISOString(),
      audit: "debezium-mcp",
      decision,
      tool: ctx.tool,
      capability: ctx.capability,
      connector: ctx.connector ?? null,
      destructive: ctx.destructive ?? false,
      ...(reason ? { reason } : {}),
    };
    process.stderr.write(`${JSON.stringify(line)}\n`);
  }
}
