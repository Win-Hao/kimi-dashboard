/**
 * Minimal TOML reader — enough for kimi-dashboard's config.toml and for the
 * `[models.*]` / `[providers.*]` tables in kimi-code's config.toml. No runtime
 * dependency (SPEC §6.1). Unsupported syntax is skipped, never thrown.
 */

export type TomlValue = string | number | boolean | string[];
export type TomlTable = Record<string, TomlValue>;

export interface TomlSection {
  path: string[];
  table: TomlTable;
}

export interface TomlDoc {
  root: TomlTable;
  sections: TomlSection[];
}

export function parseToml(text: string): TomlDoc {
  const doc: TomlDoc = { root: {}, sections: [] };
  let current = doc.root;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      if (line.startsWith("[[")) {
        current = {}; // array of tables: not needed, parse into a throwaway table
        continue;
      }
      const path = parseHeader(line);
      if (path === null) continue;
      const section: TomlSection = { path, table: {} };
      doc.sections.push(section);
      current = section.table;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = unquoteKey(line.slice(0, eq).trim());
    let raw = line.slice(eq + 1);
    // single-line arrays are the norm; tolerate a multi-line one by joining until the closing
    // bracket — but never swallow a following `key =` line or section header (malformed array).
    if (stripComment(raw).trim().startsWith("[") && !stripComment(raw).trim().endsWith("]")) {
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const next = stripComment(lines[j] ?? "").trim();
        if (/^(\[|[A-Za-z0-9_"'.-]+\s*=)/.test(next)) break;
        raw += ` ${next}`;
        if (next.endsWith("]")) {
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) continue;
      i = j;
    }
    const value = parseTomlValue(raw);
    if (value !== undefined) current[key] = value;
  }
  return doc;
}

export function findSection(doc: TomlDoc, path: string[]): TomlTable | undefined {
  return doc.sections.find((s) => s.path.length === path.length && s.path.every((p, i) => p === path[i]))?.table;
}

/** `[a.b."quoted.part"]` → ["a", "b", "quoted.part"]; malformed → null. */
function parseHeader(line: string): string[] | null {
  const body = stripComment(line).trim();
  if (!body.startsWith("[") || !body.endsWith("]")) return null;
  const inner = body.slice(1, -1);
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] ?? "";
    if (quote) {
      if (ch === "\\" && quote === '"') current += inner[++i] ?? "";
      else if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ".") {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  parts.push(current.trim());
  if (quote !== null || parts.some((p) => p.length === 0)) return null;
  return parts;
}

function unquoteKey(key: string): string {
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(key) ?? /^'([^']*)'$/.exec(key);
  return quoted ? (quoted[1] ?? "") : key;
}

export function parseTomlValue(raw: string): TomlValue | undefined {
  const value = stripComment(raw).trim();
  if (value === "true") return true;
  if (value === "false") return false;
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(value) ?? /^'([^']*)'$/.exec(value);
  if (quoted) return (quoted[1] ?? "").replace(/\\(["\\])/g, "$1");
  if (value.startsWith("[") && value.endsWith("]")) {
    const items: string[] = [];
    for (const part of splitTopLevel(value.slice(1, -1))) {
      const item = part.trim();
      if (item.length === 0) continue;
      const str = parseTomlValue(item);
      if (typeof str !== "string") return undefined;
      items.push(str);
    }
    return items;
  }
  if (/^[+-]?(\d[\d_]*)(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    const n = Number(value.replace(/_/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") return raw.slice(0, i);
  }
  return raw;
}

function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] ?? "";
    if (quote) {
      current += ch;
      if (ch === "\\" && quote === '"') current += inner[++i] ?? "";
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}
