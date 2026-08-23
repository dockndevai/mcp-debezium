/**
 * Secret redaction for connector configs. Debezium configs routinely contain
 * `database.password`, `database.user`, credentials store secrets, etc. These
 * must never reach the model, so config values under secret-shaped keys are
 * replaced before any result is returned.
 */
const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|credential|apikey|api_key|access[._-]?key|private[._-]?key|sasl\.jaas\.config|ssl\.key|keystore|truststore)/i;

const REDACTED = "***REDACTED***";

/** Redact secret-shaped keys in a flat connector config map. */
export function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? REDACTED : v;
  }
  return out;
}

/** Deep variant for nested payloads (connector info includes a `config` map). */
export function redactDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactDeep) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k) && (v === null || typeof v !== "object")) {
        out[k] = REDACTED;
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

export const _internal = { SECRET_KEY_PATTERN, REDACTED };
