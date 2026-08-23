/**
 * Thin fetch-based client for the Kafka Connect REST API (which Debezium runs on).
 * See https://kafka.apache.org/documentation/#connect_rest
 */
import type { ConnectConnection } from "../config.js";

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

  deleteConnector(name: string) {
    return this.request<void>("DELETE", `/connectors/${encodeURIComponent(name)}`);
  }
}
