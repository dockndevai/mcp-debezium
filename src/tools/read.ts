import { z } from "zod";
import { redactConfig, redactDeep } from "../redact.js";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";

export const readTools: ToolDef[] = [
  {
    name: "cluster_info",
    capability: "read",
    config: {
      title: "Connect cluster info",
      description: "Kafka Connect worker version, commit, and Kafka cluster id.",
      inputSchema: {},
    },
    handler: async (_args, { client, policy }) => {
      policy.guard({ tool: "cluster_info", capability: "read" });
      return jsonResult((await client.clusterInfo()).data);
    },
  },
  {
    name: "list_connectors",
    capability: "read",
    config: {
      title: "List connectors",
      description: "List connector names. Connectors outside the allowlist are filtered out.",
      inputSchema: {},
    },
    handler: async (_args, { client, policy }) => {
      policy.guard({ tool: "list_connectors", capability: "read" });
      const names = (await client.listConnectors()).data.filter((n) => policy.isConnectorAllowed(n));
      return jsonResult(names.sort());
    },
  },
  {
    name: "list_connector_plugins",
    capability: "read",
    config: {
      title: "List connector plugins",
      description: "List the connector plugin classes installed on the worker (incl. Debezium connectors).",
      inputSchema: {},
    },
    handler: async (_args, { client, policy }) => {
      policy.guard({ tool: "list_connector_plugins", capability: "read" });
      return jsonResult((await client.listConnectorPlugins()).data);
    },
  },
  {
    name: "get_connector",
    capability: "read",
    config: {
      title: "Get connector",
      description: "Full connector info (config + tasks). Secret config values are redacted.",
      inputSchema: { name: z.string().describe("Connector name") },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      policy.guard({ tool: "get_connector", capability: "read", connector: name });
      return jsonResult(redactDeep((await client.getConnector(name)).data));
    },
  },
  {
    name: "get_connector_config",
    capability: "read",
    config: {
      title: "Get connector config",
      description: "The connector's configuration map. Secret values are redacted.",
      inputSchema: { name: z.string().describe("Connector name") },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      policy.guard({ tool: "get_connector_config", capability: "read", connector: name });
      return jsonResult(redactConfig((await client.getConnectorConfig(name)).data));
    },
  },
  {
    name: "get_connector_status",
    capability: "read",
    config: {
      title: "Get connector status",
      description:
        "Connector and task states (RUNNING / PAUSED / FAILED), worker assignment, and failure traces.",
      inputSchema: { name: z.string().describe("Connector name") },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      policy.guard({ tool: "get_connector_status", capability: "read", connector: name });
      return jsonResult((await client.getConnectorStatus(name)).data);
    },
  },
  {
    name: "get_connector_topics",
    capability: "read",
    config: {
      title: "Get connector topics",
      description: "The set of topics a connector has read from or written to.",
      inputSchema: { name: z.string().describe("Connector name") },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      policy.guard({ tool: "get_connector_topics", capability: "read", connector: name });
      return jsonResult((await client.getConnectorTopics(name)).data);
    },
  },
];
