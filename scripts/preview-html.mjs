#!/usr/bin/env node
/**
 * Render `kimi-dashboard preview` in every state to a self-contained HTML page
 * (ANSI → coloured spans) for docs/screenshots. Usage: node scripts/preview-html.mjs [out.html]
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "cli.js");
const out = process.argv[2] ?? join(root, "docs", "preview.html");

const STATES = [
  ["正常 · Kimi 模型", ["--color"]],
  ["高用量 · 黄 / 红档", ["--color", "--hot"]],
  ["缓存过期 (stale) · 前缀 ~", ["--color", "--stale"]],
  ["未登录", ["--color", "--no-auth"]],
  ["凭证过期", ["--color", "--expired"]],
  ["首次冷启动 · 还没有缓存", ["--color", "--empty"]],
  ["非 Kimi 模型 · 额度自动隐藏", ["--color", "--not-kimi"]],
  ["quotaStyle = \"bar\"", ["--color", "--bar"]],
  ["窄终端 60 列 · 只留额度", ["--color", "--width", "60"]],
  ["NO_COLOR / TERM=dumb · 纯文本", ["--ascii", "--no-color"]],
];

const BASIC = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5", "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"];
function xterm(n) {
  if (n < 16) return BASIC[n];
  if (n >= 232) { const g = 8 + (n - 232) * 10; return `rgb(${g},${g},${g})`; }
  const i = n - 16; const v = (x) => (x === 0 ? 0 : 55 + x * 40);
  return `rgb(${v(Math.floor(i / 36))},${v(Math.floor(i / 6) % 6)},${v(i % 6)})`;
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function ansiToHtml(line) {
  let html = "", state = { color: null, bold: false, dim: false };
  const flush = (text) => {
    if (!text) return;
    const style = [state.color ? `color:${state.color}` : "", state.bold ? "font-weight:700" : "", state.dim ? "opacity:.55" : ""].filter(Boolean).join(";");
    html += style ? `<span style="${style}">${esc(text)}</span>` : esc(text);
  };
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0, m;
  while ((m = re.exec(line)) !== null) {
    flush(line.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) state = { color: null, bold: false, dim: false };
      else if (c === 1) state.bold = true;
      else if (c === 2) state.dim = true;
      else if (c === 39) state.color = null;
      else if (c >= 30 && c <= 37) state.color = BASIC[c - 30];
      else if (c >= 90 && c <= 97) state.color = BASIC[c - 90 + 8];
      else if (c === 38 && codes[i + 1] === 5) { state.color = xterm(codes[i + 2]); i += 2; }
    }
  }
  flush(line.slice(last));
  return html;
}

// ---- SVG for the README (GitHub renders no ANSI, but it does render SVG text) ----
const CELL_W = 8.4, LINE_H = 22, PAD = 16;
function ansiToSvg(line) {
  let out = "", state = { color: null, bold: false, dim: false };
  const flush = (text) => {
    if (!text) return;
    const attrs = [state.color ? `fill="${state.color}"` : "", state.bold ? 'font-weight="700"' : "", state.dim ? 'opacity="0.55"' : ""].filter(Boolean).join(" ");
    out += attrs ? `<tspan ${attrs}>${esc(text)}</tspan>` : esc(text);
  };
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0, m;
  while ((m = re.exec(line)) !== null) {
    flush(line.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) state = { color: null, bold: false, dim: false };
      else if (c === 1) state.bold = true;
      else if (c === 2) state.dim = true;
      else if (c === 39) state.color = null;
      else if (c >= 30 && c <= 37) state.color = BASIC[c - 30];
      else if (c >= 90 && c <= 97) state.color = BASIC[c - 90 + 8];
      else if (c === 38 && codes[i + 1] === 5) { state.color = xterm(codes[i + 2]); i += 2; }
    }
  }
  flush(line.slice(last));
  return out;
}

function writeSvg(path, states) {
  const lines = states.map(([label, args]) => {
    const r = spawnSync(process.execPath, [cli, "preview", ...args], { encoding: "utf8", env: { ...process.env, TERM: "xterm-256color", NO_COLOR: "" } });
    return [label, r.stdout.trimEnd()];
  });
  const width = 1180, height = PAD * 2 + lines.length * (LINE_H * 2 + 8);
  let y = PAD + 14;
  const body = lines.map(([label, line]) => {
    const block = `<text x="${PAD}" y="${y}" fill="#8b949e" font-size="11">${esc(label)}</text>` +
      `<text x="${PAD}" y="${y + LINE_H}" xml:space="preserve">${ansiToSvg(line)}</text>`;
    y += LINE_H * 2 + 8;
    return block;
  }).join("\n");
  writeFileSync(path, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="SF Mono, Menlo, Consolas, 'DejaVu Sans Mono', monospace" font-size="14">
<rect width="100%" height="100%" rx="10" fill="#1f2430"/>
<g fill="#d4d4d4">${body}</g>
</svg>
`);
}

const rows = STATES.map(([label, args]) => {
  const r = spawnSync(process.execPath, [cli, "preview", ...args], { encoding: "utf8", env: { ...process.env, TERM: "xterm-256color", NO_COLOR: "" } });
  const line = r.stdout.trimEnd();
  return `<div class="state"><div class="label">${esc(label)} <code>preview ${esc(args.join(" "))}</code></div><pre class="term"><span class="l1">${ansiToHtml(line)}</span>\n<span class="l2">${" ".repeat(Math.max(0, 96 - 24))}context: 32% (62.5k/195k)</span></pre></div>`;
});

writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>kimi-dashboard preview</title>
<style>
body{background:#14161c;color:#c9d1d9;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;padding:28px 32px;max-width:1100px}
h1{font-size:18px;font-weight:600;margin:0 0 4px}
p.sub{margin:0 0 22px;color:#8b949e;font-size:13px}
.state{margin:0 0 18px}
.label{font-size:13px;color:#8b949e;margin:0 0 6px}
.label code{color:#6e7681;font-size:12px;margin-left:8px}
pre.term{margin:0;background:#1f2430;border:1px solid #2b3040;border-radius:8px;padding:10px 14px;font:14px/1.6 "SF Mono",Menlo,Monaco,"Fira Code","Sarasa Mono SC",monospace;color:#d4d4d4;white-space:pre;overflow-x:auto}
.l2{color:#8b949e}
</style>
<h1>kimi-dashboard · 底栏预览</h1>
<p class="sub">第 1 行是 kimi-dashboard 的输出；第 2 行 <code>context: …</code> 是 kimi-code 自己画的，任何情况下都在。</p>
${rows.join("\n")}
`);
console.log(`wrote ${out}`);
const svgOut = out.replace(/\.html$/, ".svg");
writeSvg(svgOut, STATES.filter(([, args]) => !args.includes("--ascii")).slice(0, 7));
console.log(`wrote ${svgOut}`);
