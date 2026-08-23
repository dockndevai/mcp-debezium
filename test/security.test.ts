import { describe, expect, it } from "vitest";
import { PolicyError, SecurityPolicy, type SecurityConfig } from "../src/security.js";
import { redactConfig, redactDeep } from "../src/redact.js";

function makePolicy(overrides: Partial<SecurityConfig> = {}): SecurityPolicy {
  return new SecurityPolicy({
    mode: "read-only",
    connectorAllowlist: [],
    protectedConnectors: [],
    allowDelete: false,
    dryRun: false,
    auditLog: false,
    ...overrides,
  });
}

describe("capability gating", () => {
  it("read-only enables read only", () => {
    const p = makePolicy();
    expect(p.isCapabilityEnabled("read")).toBe(true);
    expect(p.isCapabilityEnabled("write")).toBe(false);
    expect(p.isCapabilityEnabled("admin")).toBe(false);
  });
});

describe("guard: capability vs mode", () => {
  it("rejects pause in read-only", () => {
    const p = makePolicy();
    expect(() => p.guard({ tool: "pause_connector", capability: "write", connector: "pg" })).toThrow(
      PolicyError,
    );
  });
});

describe("connector allowlist + protection", () => {
  it("blocks connectors outside a non-empty allowlist", () => {
    const p = makePolicy({ mode: "read-write", connectorAllowlist: ["pg-orders"] });
    expect(() => p.guard({ tool: "get_connector", capability: "read", connector: "mysql-x" })).toThrow(
      /allowlist/,
    );
  });
  it("allows reading a protected connector but not mutating it", () => {
    const p = makePolicy({ mode: "admin", allowDelete: true, protectedConnectors: ["pg-critical"] });
    expect(() => p.guard({ tool: "get_connector", capability: "read", connector: "pg-critical" })).not.toThrow();
    expect(() =>
      p.guard({ tool: "delete_connector", capability: "admin", connector: "pg-critical", destructive: true }),
    ).toThrow(/protected/);
  });
});

describe("destructive gating", () => {
  it("blocks delete without allowDelete", () => {
    const p = makePolicy({ mode: "admin" });
    expect(() =>
      p.guard({ tool: "delete_connector", capability: "admin", connector: "pg", destructive: true }),
    ).toThrow(/ALLOW_DELETE/);
  });
  it("permits delete with allowDelete", () => {
    const p = makePolicy({ mode: "admin", allowDelete: true });
    expect(() =>
      p.guard({ tool: "delete_connector", capability: "admin", connector: "pg", destructive: true }),
    ).not.toThrow();
  });
});

describe("config redaction", () => {
  it("redacts database.password and secrets, keeps other keys", () => {
    const cfg = {
      "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
      "database.hostname": "db",
      "database.user": "cdc",
      "database.password": "hunter2",
    };
    const out = redactConfig(cfg);
    expect(out["database.hostname"]).toBe("db");
    expect(out["database.user"]).toBe("cdc");
    expect(out["database.password"]).toBe("***REDACTED***");
  });

  it("redacts nested config in connector info", () => {
    const info = { name: "pg", config: { "database.password": "x", "table.include.list": "public.t" } };
    const out = redactDeep(info) as any;
    expect(out.config["database.password"]).toBe("***REDACTED***");
    expect(out.config["table.include.list"]).toBe("public.t");
  });
});

describe("dry run", () => {
  it("flags writes but not reads", () => {
    const p = makePolicy({ mode: "read-write", dryRun: true });
    expect(p.guard({ tool: "get_connector", capability: "read", connector: "pg" }).dryRun).toBe(false);
    expect(p.guard({ tool: "pause_connector", capability: "write", connector: "pg" }).dryRun).toBe(true);
  });
});
