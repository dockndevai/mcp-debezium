/**
 * Human-readable rendering of a connector config (create) or a config change (update), for the approval
 * prompt. Secret-shaped keys (per redact.ts) are NEVER rendered: they show as `***REDACTED***`, and a
 * changed secret is reported only as "changed" (computed in-process; neither value is ever output).
 * Keys and values are JSON-quoted so a value containing a newline cannot forge extra prompt lines.
 */
import { REDACTED, isSecretKey, redactDeep } from "./redact.js";

type Config = Record<string, unknown>;

const MAX_VALUE = 240;
const CONTEXT = 40;

const raw = (v: unknown): string => JSON.stringify(v === undefined ? null : v) ?? "null";

/** The display form of a value: secret keys redacted, nested secret-shaped keys redacted, JSON-quoted. */
function shown(key: string, value: unknown): string {
  return isSecretKey(key) ? REDACTED : (JSON.stringify(redactDeep(value)) ?? "null");
}

const clip = (s: string): string => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…(+${s.length - MAX_VALUE} chars)` : s);

/** Show an old/new pair so that, when long, the window starts at the first difference (never hides it). */
function pair(a: string, b: string): [string, string] {
  if (a.length <= MAX_VALUE && b.length <= MAX_VALUE) return [a, b];
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const start = Math.max(0, i - CONTEXT);
  const win = (s: string): string =>
    `${start > 0 ? "…" : ""}${s.slice(start, start + MAX_VALUE)}${s.length > start + MAX_VALUE ? `…(+${s.length - start - MAX_VALUE} chars)` : ""}`;
  return [win(a), win(b)];
}

/** Every key of a config, redacted (for `create_connector`). */
export function describeConfig(config: Config): string {
  const keys = Object.keys(config).sort();
  const lines = keys.map((k) => `${raw(k)}: ${clip(shown(k, config[k]))}`);
  return `\n${[`${keys.length} config keys:`, ...lines].map((l) => `    ${l}`).join("\n")}`;
}

/** current → next, redacted (for `update_connector_config`, which replaces the whole config). */
export function describeConfigChange(current: Config | undefined, next: Config): string {
  if (!current) {
    return `\n    (no connector with this name exists yet — this will CREATE it)${describeConfig(next)}`;
  }
  const keys = [...new Set([...Object.keys(current), ...Object.keys(next)])].sort();
  const lines: string[] = [];
  let unchanged = 0;
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const k of keys) {
    const inOld = Object.prototype.hasOwnProperty.call(current, k);
    const inNew = Object.prototype.hasOwnProperty.call(next, k);
    const secret = isSecretKey(k);
    if (inOld && inNew) {
      if (raw(current[k]) === raw(next[k])) {
        unchanged++;
        continue;
      }
      changed++;
      if (secret) lines.push(`~ ${raw(k)}: ${REDACTED} (secret value changed)`);
      else {
        const [a, b] = pair(shown(k, current[k]), shown(k, next[k]));
        lines.push(`~ ${raw(k)}: ${a} → ${b}`);
      }
    } else if (inNew) {
      added++;
      lines.push(`+ ${raw(k)}: ${clip(shown(k, next[k]))}`);
    } else {
      removed++;
      lines.push(`- ${raw(k)}: ${clip(shown(k, current[k]))}`);
    }
  }
  const head = `${changed} changed, ${added} added, ${removed} removed, ${unchanged} unchanged (PUT replaces the whole config; "-" keys are dropped)`;
  return `\n${[head, ...lines].map((l) => `    ${l}`).join("\n")}`;
}
