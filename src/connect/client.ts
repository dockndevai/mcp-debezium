/**
 * Thin fetch-based client for the Kafka Connect REST API (which Debezium runs on).
 * See https://kafka.apache.org/documentation/#connect_rest
 */
import { createHash } from "node:crypto";
import type { ConnectConnection } from "../config.js";
import { redactConfig } from "../redact.js";

export class ConnectError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "ConnectError";
  }
}

export class ConnectClient {
  constructor(private readonly conn: ConnectConnection) {}

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.conn.auth) {
      const token = Buffer.from(`${this.conn.auth.username}:${this.conn.auth.password}`).toString("base64");
      headers.Authorization = `Basic ${token}`;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.conn.requestTimeout);
    try {
      const res = await fetch(`${this.conn.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new ConnectError(`Kafka Connect ${method} ${path} failed with ${res.status}.`, res.status, text);
      }
      return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
    } finally {
      clearTimeout(timer);
    }
  }

  clusterInfo() {
    return this.request<{ version: string; commit: string; kafka_cluster_id: string }>("GET", "/");
  }

  listConnectors() {
    return this.request<string[]>("GET", "/connectors");
  }

  listConnectorPlugins() {
    return this.request<Array<Record<string, unknown>>>("GET", "/connector-plugins");
  }

  getConnector(name: string) {
    return this.request<Record<string, unknown>>("GET", `/connectors/${encodeURIComponent(name)}`);
  }

  getConnectorConfig(name: string) {
    return this.request<Record<string, unknown>>("GET", `/connectors/${encodeURIComponent(name)}/config`);
  }

  getConnectorStatus(name: string) {
    return this.request<Record<string, unknown>>("GET", `/connectors/${encodeURIComponent(name)}/status`);
  }

  getConnectorTopics(name: string) {
    return this.request<Record<string, unknown>>("GET", `/connectors/${encodeURIComponent(name)}/topics`);
  }

  createConnector(name: string, config: Record<string, unknown>) {
    return this.request<Record<string, unknown>>("POST", "/connectors", { name, config });
  }

  updateConnectorConfig(name: string, config: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/connectors/${encodeURIComponent(name)}/config`,
      config,
    );
  }

  pauseConnector(name: string) {
    return this.request<void>("PUT", `/connectors/${encodeURIComponent(name)}/pause`);
  }

  resumeConnector(name: string) {
    return this.request<void>("PUT", `/connectors/${encodeURIComponent(name)}/resume`);
  }

  restartConnector(name: string, includeTasks: boolean) {
    return this.request<void>(
      "POST",
      `/connectors/${encodeURIComponent(name)}/restart?includeTasks=${includeTasks}&onlyFailed=false`,
    );
  }

  restartTask(name: string, taskId: number) {
    return this.request<void>(
      "POST",
      `/connectors/${encodeURIComponent(name)}/tasks/${taskId}/restart`,
    );
  }

  /**
   * Version token for a connector, pinned across an approval prompt. Kafka Connect has no etag, so this is
   * a hash of what defines the connector: its name, type (source/sink), the SECRET-REDACTED config (secret
   * values never enter the hash, so they can never leak through it) and its task layout (task ids). The
   * running state/status is deliberately excluded — it changes on its own (RUNNING <-> RESTARTING, task
   * failures) and would make every approval fail. Limits: a changed secret (e.g. `database.password`
   * rotated) is NOT detected because secrets are redacted before hashing, and a connector deleted and
   * recreated with an identical config under the same name is not distinguishable. A connector
   * created moments earlier may not have its task configs generated yet, so its task list can still grow.
   * Returns undefined if
   * the connector does not exist; throws on any other transport error.
   */
  async connectorVersion(name: string): Promise<string | undefined> {
    let info: Record<string, unknown> | undefined;
    try {
      info = (await this.getConnector(name)).data;
    } catch (err) {
      if (err instanceof ConnectError && err.status === 404) return undefined;
      throw err;
    }
    if (!info) return undefined;
    const config = redactConfig((info.config as Record<string, unknown> | undefined) ?? {});
    const tasks = ((info.tasks as Array<{ task?: number }> | undefined) ?? [])
      .map((t) => t.task)
      .filter((t): t is number => typeof t === "number")
      .sort((a, b) => a - b);
    const canonical = JSON.stringify({
      name: info.name ?? name,
      type: info.type ?? null,
      config: Object.fromEntries(Object.entries(config).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      tasks,
    });
    return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
  }

  deleteConnector(name: string) {
    return this.request<void>("DELETE", `/connectors/${encodeURIComponent(name)}`);
  }
}
