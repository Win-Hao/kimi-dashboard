import { findSection, parseToml } from "./toml.js";

export type ProviderKind = "kimi" | "other" | "unknown";

const MANAGED_KIMI_PREFIX = "managed:kimi-code";

/**
 * Which provider serves the model kimi-code named in the payload. The payload
 * carries the model's `display_name` (falling back to its id), so match both
 * against kimi-code's `[models.*]` tables, then look at the provider's `type`.
 * Anything we cannot resolve is "unknown": the quota stays visible.
 */
export function modelProviderKind(configText: string, modelLabel: string): ProviderKind {
  if (modelLabel.length === 0) return "unknown";
  const doc = parseToml(configText);
  const model = doc.sections.find(
    (s) => s.path.length === 2 && s.path[0] === "models" && (s.table["display_name"] === modelLabel || s.path[1] === modelLabel),
  );
  if (!model) return "unknown";
  const providerName = model.table["provider"];
  if (typeof providerName !== "string") return "unknown";
  const provider = findSection(doc, ["providers", providerName]);
  if (provider?.["type"] === "kimi") return "kimi";
  if (provider === undefined && providerName.startsWith(MANAGED_KIMI_PREFIX)) return "kimi";
  return "other";
}
