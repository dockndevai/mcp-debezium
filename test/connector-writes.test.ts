import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "../src/config.js";
import { ConnectClient } from "../src/connect/client.js";
import { describeConfig, describeConfigChange } from "../src/configDiff.js";
import { buildServer } from "../src/server.js";

const PW_OLD = "old-pw-SECRET-1";
const PW_NEW = "new-pw-SECRET-2";
const JAAS = 'org.apache.kafka.common.security.plain.PlainLoginModule required username="u" password="jaas-SECRET-3";';

const config = (over: Partial<AppConfig["security"]> = {}): AppConfig => ({
  connection: { baseUrl: "http://connect.invalid:8083", requestTimeout: 1000 },
  security: {
    mode: "admin",
    connectorAllowlist: [],
    protectedConnectors: [],
    allowDelete: true,
    dryRun: false,
    auditLog: false,
    requireHumanApproval: false,
    ...over,
  },
});

type Answer = { action: "accept" | "decline"; content?: Record<string, unknown> };

async function connect(opts: { security?: Partial<AppConfig["security"]>; answer?: (message: string) => Answer | Promise<Answer>; elicits?: boolean } = {}) {
  const { server } = buildServer(config(opts.security));
  const prompts: string[] = [];
  const client = new Client({ name: "t", version: "0" }, { capabilities: opts.elicits === false ? {} : { elicitation: {} } });
  if (opts.elicits !== false) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      prompts.push(req.params.message);
      return (await opts.answer?.(req.params.message)) ?? { action: "accept", content: { confirm: true } };
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, prompts };
}

const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? "");

const info = (cfg: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  name: "inventory-cdc",
  type: "source",
  config: {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "database.hostname": "db1",
    "database.password": PW_OLD,
    "sasl.jaas.config": JAAS,
    "tasks.max": "1",
    ...cfg,
  },
  tasks: [{ connector: "inventory-cdc", task: 0 }],
  ...over,
});

const NEW_CFG = {
  "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
  "database.hostname": "db2",
  "database.password": PW_NEW,
  "sasl.jaas.config": JAAS,
  "table.include.list": "public.orders",
};

const SECRETS = [PW_OLD, PW_NEW, "jaas-SECRET-3"];
const expectNoSecrets = (s: string) => {
  for (const secret of SECRETS) expect(s).not.toContain(secret);
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const stubUpdate = () => vi.spyOn(ConnectClient.prototype, "updateConnectorConfig").mockResolvedValue({ status: 200, data: { name: "inventory-cdc", config: NEW_CFG } });
const stubCreate = () => vi.spyOn(ConnectClient.prototype, "createConnector").mockResolvedValue({ status: 201, data: { name: "inventory-cdc", config: NEW_CFG } });

describe("update_connector_config approval", () => {
  it("shows tool, redacted current→new diff, version and fingerprint, then updates", async () => {
    vi.spyOn(ConnectClient.prototype, "readConnector").mockResolvedValue(info());
    const put = stubUpdate();
    const { client, prompts } = await connect();
    const res = await client.callTool({ name: "update_connector_config", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(put).toHaveBeenCalledWith("inventory-cdc", NEW_CFG);
    expect(text(res)).not.toContain("cancelled");
    const p = prompts[0];
    expect(p).toContain("tool: update_connector_config");
    expect(p).toContain('"database.hostname": "db1" → "db2"');
    expect(p).toContain('+ "table.include.list": "public.orders"');
    expect(p).toContain('- "tasks.max": "1"');
    expect(p).toContain('~ "database.password": ***REDACTED*** (secret value changed)');
    expect(p).toContain("resource version:");
    expect(p).toMatch(/fingerprint: [0-9a-f]{16}/);
    expectNoSecrets(p);
    expectNoSecrets(text(res));
  });

  it("never leaks a secret into the prompt, the audit line or the result (incl. keys elicit.ts alone would miss)", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(ConnectClient.prototype, "readConnector").mockResolvedValue(info());
    stubUpdate();
    const { client, prompts } = await connect({ security: { auditLog: true } });
    const res = await client.callTool({ name: "update_connector_config", arguments: { name: "inventory-cdc", config: { ...NEW_CFG, "sasl.jaas.config": JAAS.replace("jaas-SECRET-3", "jaas-SECRET-4") } } });
    const everything = [...prompts, text(res), ...err.mock.calls.map((c) => String(c[0]))].join("\n");
    expectNoSecrets(everything);
    expect(everything).not.toContain("jaas-SECRET-4");
    expect(err.mock.calls.some((c) => String(c[0]).includes('"audit":"approval"'))).toBe(true);
  });

  it("does NOT update when the human declines", async () => {
    vi.spyOn(ConnectClient.prototype, "readConnector").mockResolvedValue(info());
    const put = stubUpdate();
    const { client } = await connect({ answer: () => ({ action: "decline" }) });
    const res = await client.callTool({ name: "update_connector_config", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(put).not.toHaveBeenCalled();
    expect(text(res)).toContain("cancelled");
  });

  it("does NOT update when the connector changed while the human was deciding", async () => {
    const reads = [info(), info({ "tasks.max": "4" })];
    vi.spyOn(ConnectClient.prototype, "readConnector").mockImplementation(async () => reads.shift());
    const put = stubUpdate();
    const { client } = await connect();
    const res = await client.callTool({ name: "update_connector_config", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(put).not.toHaveBeenCalled();
    expect(text(res)).toContain("resource changed since the prompt");
  });

  it("does NOT update when the connector changed between the diff being read and the prompt being sent", async () => {
    // read #1 builds the diff; the pin is that same read, so any later difference refuses.
    const reads = [info(), info({ "tasks.max": "9" }), info({ "tasks.max": "9" })];
    vi.spyOn(ConnectClient.prototype, "readConnector").mockImplementation(async () => reads.shift());
    const put = stubUpdate();
    const { client } = await connect();
    await client.callTool({ name: "update_connector_config", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(put).not.toHaveBeenCalled();
  });

  it("flags that PUT on a missing connector would create it, and refuses if it appears meanwhile", async () => {
    const reads: Array<ReturnType<typeof info> | undefined> = [undefined, info()];
    vi.spyOn(ConnectClient.prototype, "readConnector").mockImplementation(async () => reads.shift());
    const put = stubUpdate();
    const { client, prompts } = await connect();
    const res = await client.callTool({ name: "update_connector_config", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(prompts[0]).toContain("will CREATE it");
    expect(put).not.toHaveBeenCalled();
    expect(text(res)).toContain("resource changed since the prompt");
  });

  it("refuses when the client cannot elicit and human approval is required", async () => {
    vi.spyOn(ConnectClient.prototype, "readConnector").mockResolvedValue(info());
    const put = stubUpdate();
    const { client } = await connect({ elicits: false, security: { requireHumanApproval: true } });
    const res = await client.callTool({ name: "update_connector_config", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(text(res)).toContain("no human approval channel");
    expect(put).not.toHaveBeenCalled();
  });

  it("falls back to the policy gates when the client cannot elicit (default)", async () => {
    vi.spyOn(ConnectClient.prototype, "readConnector").mockResolvedValue(info());
    const put = stubUpdate();
    const { client } = await connect({ elicits: false });
    await client.callTool({ name: "update_connector_config", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(put).toHaveBeenCalledWith("inventory-cdc", NEW_CFG);
  });

  it("dry-run: no network, no prompt, same message", async () => {
    const read = vi.spyOn(ConnectClient.prototype, "readConnector");
    const put = stubUpdate();
    const { client, prompts } = await connect({ security: { dryRun: true } });
    const res = await client.callTool({ name: "update_connector_config", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(text(res)).toBe("[dry-run] Would update config of connector 'inventory-cdc'.");
    expect(read).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(0);
  });
});

describe("create_connector approval", () => {
  it("shows the exact (redacted) config and creates when approved", async () => {
    vi.spyOn(ConnectClient.prototype, "readConnector").mockResolvedValue(undefined);
    const post = stubCreate();
    const { client, prompts } = await connect();
    const res = await client.callTool({ name: "create_connector", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(post).toHaveBeenCalledWith("inventory-cdc", NEW_CFG);
    expect(prompts[0]).toContain("tool: create_connector");
    expect(prompts[0]).toContain('"database.hostname": "db2"');
    expect(prompts[0]).toContain('"table.include.list": "public.orders"');
    expect(prompts[0]).toContain('"database.password": ***REDACTED***');
    expect(prompts[0]).toMatch(/fingerprint: [0-9a-f]{16}/);
    expectNoSecrets(prompts[0]);
    expectNoSecrets(text(res));
  });

  it("does NOT create when the human declines", async () => {
    vi.spyOn(ConnectClient.prototype, "readConnector").mockResolvedValue(undefined);
    const post = stubCreate();
    const { client } = await connect({ answer: () => ({ action: "decline" }) });
    const res = await client.callTool({ name: "create_connector", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(post).not.toHaveBeenCalled();
    expect(text(res)).toContain("cancelled");
  });

  it("does NOT create when a connector of the same name appeared while the human was deciding", async () => {
    const reads: Array<ReturnType<typeof info> | undefined> = [undefined, info()];
    vi.spyOn(ConnectClient.prototype, "readConnector").mockImplementation(async () => reads.shift());
    const post = stubCreate();
    const { client } = await connect();
    const res = await client.callTool({ name: "create_connector", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(post).not.toHaveBeenCalled();
    expect(text(res)).toContain("resource changed since the prompt");
  });

  it("does not prompt or create when the connector already exists", async () => {
    vi.spyOn(ConnectClient.prototype, "readConnector").mockResolvedValue(info());
    const post = stubCreate();
    const { client, prompts } = await connect();
    const res = await client.callTool({ name: "create_connector", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(post).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(0);
    expect(text(res)).toContain("already exists");
  });

  it("refuses when the client cannot elicit and human approval is required", async () => {
    vi.spyOn(ConnectClient.prototype, "readConnector").mockResolvedValue(undefined);
    const post = stubCreate();
    const { client } = await connect({ elicits: false, security: { requireHumanApproval: true } });
    const res = await client.callTool({ name: "create_connector", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(text(res)).toContain("no human approval channel");
    expect(post).not.toHaveBeenCalled();
  });

  it("falls back to the policy gates when the client cannot elicit (default)", async () => {
    vi.spyOn(ConnectClient.prototype, "readConnector").mockResolvedValue(undefined);
    const post = stubCreate();
    const { client } = await connect({ elicits: false });
    await client.callTool({ name: "create_connector", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(post).toHaveBeenCalledWith("inventory-cdc", NEW_CFG);
  });

  it("dry-run: no network, no prompt, same message", async () => {
    const read = vi.spyOn(ConnectClient.prototype, "readConnector");
    const post = stubCreate();
    const { client, prompts } = await connect({ security: { dryRun: true } });
    const res = await client.callTool({ name: "create_connector", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(text(res)).toBe(`[dry-run] Would create connector 'inventory-cdc' with ${Object.keys(NEW_CFG).length} config keys.`);
    expect(read).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(0);
  });
});

describe("laya-guard never receives secrets", () => {
  function stubGuard(decision: "allow" | "confirm") {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      expect(String(url)).toContain("/evaluate");
      bodies.push(String(init?.body));
      return { ok: true, json: async () => ({ decision, risk: "high", confidence: 1, reasons: ["r"], deterministic: true, model_available: false }) };
    });
    return bodies;
  }

  it.each(["create_connector", "update_connector_config"])("%s: guard request body, guard confirm prompt and guard log carry no secret", async (tool) => {
    vi.stubEnv("DEBEZIUM_GUARD_MODE", "enforce");
    const bodies = stubGuard("confirm");
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(ConnectClient.prototype, "readConnector").mockResolvedValue(tool === "create_connector" ? undefined : info());
    stubCreate();
    stubUpdate();
    const { client, prompts } = await connect({ security: { auditLog: true } });
    await client.callTool({ name: tool, arguments: { name: "inventory-cdc", config: NEW_CFG } });
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]).command).toContain("[redacted]");
    expect(prompts.length).toBeGreaterThan(0); // the guard confirm prompt (+ the connector approval prompt)
    expectNoSecrets([bodies[0], ...prompts, ...err.mock.calls.map((c) => String(c[0]))].join("\n"));
  });

  it("monitor mode: the (truncated) guard log line carries no secret either", async () => {
    vi.stubEnv("DEBEZIUM_GUARD_MODE", "monitor");
    const bodies = stubGuard("confirm");
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(ConnectClient.prototype, "readConnector").mockResolvedValue(info());
    stubUpdate();
    const { client } = await connect({ elicits: false });
    await client.callTool({ name: "update_connector_config", arguments: { name: "inventory-cdc", config: NEW_CFG } });
    const logs = err.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logs).toContain('"guard":"laya-guard"');
    expectNoSecrets(`${bodies[0]}\n${logs}`);
  });
});

describe("config rendering", () => {
  it("quotes keys and values so a newline cannot forge prompt lines", () => {
    const out = describeConfig({ "a\n  • fingerprint: deadbeef": "x\n  • fingerprint: deadbeef" });
    expect(out).not.toMatch(/\n\s*• fingerprint/);
  });

  it("reports a changed secret as changed without printing either value, and omits unchanged secrets", () => {
    const out = describeConfigChange({ "database.password": "aaa", "x.token": "same" }, { "database.password": "bbb", "x.token": "same" });
    expect(out).toContain("(secret value changed)");
    expect(out).not.toContain("aaa");
    expect(out).not.toContain("bbb");
    expect(out).not.toContain("x.token");
  });

  it("shows secrets nested in non-secret values redacted", () => {
    const out = describeConfig({ "custom.opts": { user: "u", password: "nested-SECRET" } });
    expect(out).not.toContain("nested-SECRET");
  });

  it("long values: the window starts at the first difference so it is never hidden", () => {
    const base = "a".repeat(1000);
    const out = describeConfigChange({ "table.include.list": `${base}X` }, { "table.include.list": `${base}Y` });
    expect(out).toContain("X");
    expect(out).toContain("Y");
  });
});
