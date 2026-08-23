import { z } from "zod";
import type { ToolDef } from "./types.js";
import { jsonResult, textResult } from "./types.js";

/**
 * Admin tools: only registered in admin mode; the destructive delete
 * additionally requires DEBEZIUM_ALLOW_DELETE=true.
 */
export const adminTools: ToolDef[] = [
  {
    name: "delete_connector",
    capability: "admin",
    config: {
      title: "Delete connector",
      description:
        "Permanently delete a connector and stop its tasks. Requires admin mode AND " +
        "DEBEZIUM_ALLOW_DELETE=true. Does not delete already-produced Kafka messages, but stops CDC. Irreversible.",
      inputSchema: { name: z.string().describe("Connector name") },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      const { dryRun } = policy.guard({
        tool: "delete_connector",
        capability: "admin",
        connector: name,
        destructive: true,
      });
      if (dryRun) return textResult(`[dry-run] Would delete connector '${name}'.`);
      await client.deleteConnector(name);
      return jsonResult({ deleted: true, connector: name });
    },
  },
];
