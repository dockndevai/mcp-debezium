/**
 * Configuration from environment variables.
 */
import type { AccessMode, SecurityConfig } from "./security.js";

export interface ConnectConnection {
  /** Base URL of the Kafka Connect REST API, e.g. http://connect:8083 */
  baseUrl: string;
  /** Optional HTTP basic auth. */
  auth?: { username: string; password: string };
  requestTimeout: number;
}

export interface AppConfig {
  connection: ConnectConnection;
  security: SecurityConfig;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function list(name: string): string[] {
  const v = process.env[name];
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseMode(): AccessMode {
  const raw = (process.env.DEBEZIUM_MODE ?? "read-only").toLowerCase();
  if (raw === "read-only" || raw === "read-write" || raw === "admin") return raw;
  throw new Error(`Invalid DEBEZIUM_MODE '${raw}'. Expected one of: read-only, read-write, admin.`);
}

export function loadConfig(): AppConfig {
  const baseUrl = (process.env.CONNECT_URL || "http://localhost:8083").replace(/\/+$/, "");
  const username = process.env.CONNECT_USERNAME;
  const password = process.env.CONNECT_PASSWORD;
  return {
    connection: {
      baseUrl,
      auth: username && password ? { username, password } : undefined,
      requestTimeout: Number(process.env.CONNECT_TIMEOUT_MS ?? 15000),
    },
    security: {
      mode: parseMode(),
      connectorAllowlist: list("DEBEZIUM_CONNECTOR_ALLOWLIST"),
      protectedConnectors: list("DEBEZIUM_PROTECTED_CONNECTORS"),
      allowDelete: bool("DEBEZIUM_ALLOW_DELETE", false),
      dryRun: bool("DEBEZIUM_DRY_RUN", false),
      auditLog: bool("DEBEZIUM_AUDIT_LOG", true),
    },
  };
}
