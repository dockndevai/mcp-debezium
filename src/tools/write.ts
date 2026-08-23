import { z } from "zod";
import { redactDeep } from "../redact.js";
import type { ToolDef } from "./types.js";
import { jsonResult, textResult } from "./types.js";

export const writeTools: ToolDef[] = [
  {
    name: "create_connector",
    capability: "write",
    config: {
      title: "Create connector",
      description:
        "Create a new connector from a config map (e.g. a Debezium source connector). " +
        "Provide the full connector.class and its properties.",
      inputSchema: {
        name: z.string().describe("Connector name"),
        config: z.record(z.any()).describe("Connector config map (must include connector.class)"),
      },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      const config = args.config as Record<string, unknown>;
      const { dryRun } = policy.guard({ tool: "create_connector", capability: "write", connector: name });
      if (dryRun)
        return textResult(`[dry-run] Would create connector '${name}' with ${Object.keys(config).length} config keys.`);
      const res = await client.createConnector(name, config);
      return jsonResult(redactDeep(res.data));
    },
  },
  {
    name: "update_connector_config",
    capability: "write",
    config: {
      title: "Update connector config",
      description: "Replace a connector's configuration (PUT semantics — send the complete config).",
      inputSchema: {
        name: z.string().describe("Connector name"),
        config: z.record(z.any()).describe("Complete replacement config map"),
      },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      const config = args.config as Record<string, unknown>;
      const { dryRun } = policy.guard({
        tool: "update_connector_config",
        capability: "write",
        connector: name,
      });
      if (dryRun) return textResult(`[dry-run] Would update config of connector '${name}'.`);
      const res = await client.updateConnectorConfig(name, config);
      return jsonResult(redactDeep(res.data));
    },
  },
  {
    name: "pause_connector",
    capability: "write",
    config: {
      title: "Pause connector",
      description: "Pause a connector and its tasks (stops CDC without deleting the connector).",
      inputSchema: { name: z.string().describe("Connector name") },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      const { dryRun } = policy.guard({ tool: "pause_connector", capability: "write", connector: name });
      if (dryRun) return textResult(`[dry-run] Would pause connector '${name}'.`);
      await client.pauseConnector(name);
      return jsonResult({ paused: true, connector: name });
    },
  },
  {
    name: "resume_connector",
    capability: "write",
    config: {
      title: "Resume connector",
      description: "Resume a paused connector and its tasks.",
      inputSchema: { name: z.string().describe("Connector name") },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      const { dryRun } = policy.guard({ tool: "resume_connector", capability: "write", connector: name });
      if (dryRun) return textResult(`[dry-run] Would resume connector '${name}'.`);
      await client.resumeConnector(name);
      return jsonResult({ resumed: true, connector: name });
    },
  },
  {
    name: "restart_connector",
    capability: "write",
    config: {
      title: "Restart connector",
      description: "Restart a connector, optionally including its tasks.",
      inputSchema: {
        name: z.string().describe("Connector name"),
        includeTasks: z.boolean().optional().describe("Also restart tasks (default true)"),
      },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      const includeTasks = (args.includeTasks as boolean | undefined) ?? true;
      const { dryRun } = policy.guard({ tool: "restart_connector", capability: "write", connector: name });
      if (dryRun) return textResult(`[dry-run] Would restart connector '${name}' (includeTasks=${includeTasks}).`);
      await client.restartConnector(name, includeTasks);
      return jsonResult({ restarted: true, connector: name, includeTasks });
    },
  },
  {
    name: "restart_task",
    capability: "write",
    config: {
      title: "Restart connector task",
      description: "Restart a single task of a connector by its numeric id (e.g. to clear a FAILED task).",
      inputSchema: {
        name: z.string().describe("Connector name"),
        taskId: z.number().int().min(0).describe("Task id"),
      },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      const taskId = args.taskId as number;
      const { dryRun } = policy.guard({ tool: "restart_task", capability: "write", connector: name });
      if (dryRun) return textResult(`[dry-run] Would restart task ${taskId} of connector '${name}'.`);
      await client.restartTask(name, taskId);
      return jsonResult({ restarted: true, connector: name, taskId });
    },
  },
];
