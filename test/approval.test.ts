import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "../src/config.js";
import { ConnectClient } from "../src/connect/client.js";
import { buildServer } from "../src/server.js";

const config = (requireHumanApproval = false): AppConfig => ({
  connection: { baseUrl: "http://connect.invalid:8083", requestTimeout: 1000 },
  security: {
    mode: "admin",
    connectorAllowlist: [],
    protectedConnectors: [],
    allowDelete: true,
    dryRun: false,
    auditLog: false,
    requireHumanApproval,
  },
});

type Answer = { action: "accept" | "decline"; content?: Record<string, unknown> };

/** Connect an in-memory MCP client (optionally able to answer elicitation) to a freshly built server. */
async function connect(opts: { requireHuman?: boolean; answer?: (message: string) => Answer | Promise<Answer>; elicits?: boolean }) {
  const { server } = buildServer(config(opts.requireHuman));
  const prompts: string[] = [];
  const client = new Client({ name: "t", version: "0" }, { capabilities: opts.elicits === false ? {} : { elicitation: {} } });
  if (opts.elicits !== false) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      prompts.push(req.params.message);
      return (await opts.answer?.(req.params.message)) ?? { action: "accept", content: { confirm: true, typed: "inventory-cdc" } };
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, prompts };
}

const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? "");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("delete_connector approval (end to end)", () => {
  it("shows the tool, full arguments, version and fingerprint, then deletes", async () => {
    vi.spyOn(ConnectClient.prototype, "connectorVersion").mockResolvedValue("v1");
    const del = vi.spyOn(ConnectClient.prototype, "deleteConnector").mockResolvedValue({ status: 204, data: undefined });
    const { client, prompts } = await connect({});
    const res = await client.callTool({ name: "delete_connector", arguments: { name: "inventory-cdc" } });
    expect(text(res)).toContain('"deleted": true');
    expect(del).toHaveBeenCalledWith("inventory-cdc");
    expect(prompts[0]).toContain("tool: delete_connector");
    expect(prompts[0]).toContain('{"name":"inventory-cdc"}');
    expect(prompts[0]).toContain("resource version: v1");
    expect(prompts[0]).toMatch(/fingerprint: [0-9a-f]{16}/);
  });

  it("does NOT delete when the connector changed while the human was deciding", async () => {
    const versions = ["v1", "v2"];
    vi.spyOn(ConnectClient.prototype, "connectorVersion").mockImplementation(async () => versions.shift());
    const del = vi.spyOn(ConnectClient.prototype, "deleteConnector").mockResolvedValue({ status: 204, data: undefined });
    const { client } = await connect({});
    const res = await client.callTool({ name: "delete_connector", arguments: { name: "inventory-cdc" } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(del).not.toHaveBeenCalled();
  });

  it("does NOT delete when the typed confirmation does not match", async () => {
    vi.spyOn(ConnectClient.prototype, "connectorVersion").mockResolvedValue("v1");
    const del = vi.spyOn(ConnectClient.prototype, "deleteConnector").mockResolvedValue({ status: 204, data: undefined });
    const { client } = await connect({ answer: () => ({ action: "accept", content: { confirm: true, typed: "wrong" } }) });
    const res = await client.callTool({ name: "delete_connector", arguments: { name: "inventory-cdc" } });
    expect(text(res)).toContain("typed confirmation did not match");
    expect(del).not.toHaveBeenCalled();
  });

  it("does NOT delete when the human declines", async () => {
    vi.spyOn(ConnectClient.prototype, "connectorVersion").mockResolvedValue("v1");
    const del = vi.spyOn(ConnectClient.prototype, "deleteConnector").mockResolvedValue({ status: 204, data: undefined });
    const { client } = await connect({ answer: () => ({ action: "decline" }) });
    await client.callTool({ name: "delete_connector", arguments: { name: "inventory-cdc" } });
    expect(del).not.toHaveBeenCalled();
  });
});

describe("DEBEZIUM_REQUIRE_HUMAN_APPROVAL", () => {
  it("falls back to the flags when the client cannot elicit (default)", async () => {
    vi.spyOn(ConnectClient.prototype, "connectorVersion").mockResolvedValue("v1");
    const del = vi.spyOn(ConnectClient.prototype, "deleteConnector").mockResolvedValue({ status: 204, data: undefined });
    const { client } = await connect({ elicits: false });
    await client.callTool({ name: "delete_connector", arguments: { name: "inventory-cdc" } });
    expect(del).toHaveBeenCalledWith("inventory-cdc");
  });

  it("refuses to delete when the client cannot elicit and human approval is required", async () => {
    vi.spyOn(ConnectClient.prototype, "connectorVersion").mockResolvedValue("v1");
    const del = vi.spyOn(ConnectClient.prototype, "deleteConnector").mockResolvedValue({ status: 204, data: undefined });
    const { client, prompts } = await connect({ elicits: false, requireHuman: true });
    const res = await client.callTool({ name: "delete_connector", arguments: { name: "inventory-cdc" } });
    expect(text(res)).toContain("no human approval channel");
    expect(prompts).toHaveLength(0);
    expect(del).not.toHaveBeenCalled();
  });
});

describe("connector version token (Kafka Connect has no etag)", () => {
  const info = (over: Record<string, unknown> = {}, cfg: Record<string, unknown> = {}) => ({
    name: "inventory-cdc",
    type: "source",
    config: {
      "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
      "database.hostname": "db",
      "database.password": "hunter2",
      "tasks.max": "1",
      ...cfg,
    },
    tasks: [{ connector: "inventory-cdc", task: 0 }],
    ...over,
  });

  function stubConnect(body: () => unknown, status = 200) {
    vi.stubGlobal("fetch", async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body()) }));
    return new ConnectClient({ baseUrl: "http://connect.invalid:8083", requestTimeout: 1000 });
  }

  it("is stable for the same connector and ignores volatile running state", async () => {
    const a = await stubConnect(() => info()).connectorVersion("inventory-cdc");
    // status is a separate endpoint, but even if it leaked into the payload it must not matter
    const b = await stubConnect(() => ({ ...info(), status: { state: "FAILED" } })).connectorVersion("inventory-cdc");
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(b).toBe(a);
  });

  it("changes when the config or the task layout changes", async () => {
    const base = await stubConnect(() => info()).connectorVersion("inventory-cdc");
    expect(await stubConnect(() => info({}, { "tasks.max": "2" })).connectorVersion("inventory-cdc")).not.toBe(base);
    expect(
      await stubConnect(() => info({ tasks: [{ connector: "inventory-cdc", task: 0 }, { connector: "inventory-cdc", task: 1 }] })).connectorVersion("inventory-cdc"),
    ).not.toBe(base);
    expect(await stubConnect(() => info({ type: "sink" })).connectorVersion("inventory-cdc")).not.toBe(base);
  });

  it("never hashes secret values (a rotated password does not change the token)", async () => {
    const a = await stubConnect(() => info({}, { "database.password": "hunter2" })).connectorVersion("inventory-cdc");
    const b = await stubConnect(() => info({}, { "database.password": "correct-horse" })).connectorVersion("inventory-cdc");
    expect(b).toBe(a);
  });

  it("returns undefined when the connector does not exist, and throws on other errors", async () => {
    expect(await stubConnect(() => ({ error_code: 404 }), 404).connectorVersion("gone")).toBeUndefined();
    await expect(stubConnect(() => ({}), 500).connectorVersion("x")).rejects.toThrow();
  });
});
