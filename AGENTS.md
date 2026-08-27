# kimi-dashboard — rules for agents working on this repo

Read SPEC.md first; it is the design contract. These rules are the parts that are easy to break silently.

## Invariants (never trade these away)

1. **Hot path stays cold.** `statusline` (src/statusline.ts, src/render.ts) never touches the network or the credentials directory, never exits non-zero, never writes stderr, always prints exactly one line (empty line = let the host fall back). Cold-start p99 must stay under 150 ms (`npm run bench`).
2. **Credentials are read-only.** `~/.kimi-code/credentials/` is only ever read; only `access_token` and `expires_at` leave `src/quota/creds.ts`; the refresh token never enters a variable, log, error or test fixture. Expired token → report, never refresh (kimi-code refreshes in-process; racing it can log the user out).
3. **One line only.** kimi-code uses just the first stdout line and hard-codes footer line 2. Do not design multi-line output or escape-sequence tricks; multi-line waits for upstream (MoonshotAI/kimi-code#2448, #2435).
4. **Degrade, never crash.** Bad stdin, missing cache, corrupt files, unknown config keys → sensible fallback. Every parser is lenient.
5. **Zero runtime dependencies.** `package.json` has devDependencies only; `dist/cli.js` is a single ESM file.

## Workflow

- **TDD, red → green per slice.** Write the failing test first, run it, then the minimal implementation. Expected values are literals, never recomputed. Seams: `parseUsages`, `render`, cache/creds/refresh with temp dirs and a loopback `node:http` server, `statusline()` with injected `spawnRefresh`, e2e through `dist/cli.js` using async `spawn` (never `spawnSync` — it starves the in-process test server).
- `npm test && npm run lint && npm run build && npm run bench` must pass before any commit.
- **Commit `dist/cli.js`.** kimi-code installs the plugin straight from the GitHub archive; CI fails if dist is stale. Run `npm run build` before committing.
- Keep `kimi.plugin.json` `version` equal to `package.json` `version` (test/plugin.test.ts enforces it).
- Keep README bilingual (中文 then English); regenerate `docs/preview.svg` with `npm run preview:html` when rendering changes.
- Tests must be platform-agnostic: build paths with `path.join`, tolerate CRLF, skip `sh -c` on Windows. CI runs ubuntu/macos/windows × node 20/22.

## Rendering rules

- Numbers must match kimi-code's own footer line 2: context percent is `Math.ceil`, token counts use the 1024-based `23.7k` / `977k` formatter (src/render.ts `formatTokenCount`).
- Colour bands: <60 % green, 60–85 % yellow, >85 % red; 256-colour palette 151/222/210/117/249/218 with 16-colour fallback; `NO_COLOR` / `TERM=dumb` → plain ASCII, `|` separators, no icons.
- Trim order lives in `PRIORITY` (src/render.ts); `5h` is never trimmed.
- Quota segments (5h/7d/booster/spend) hide when the active model's provider is not Kimi (`src/provider.ts`, config `quotaWhenNotKimi`).

## Slash commands (`commands/*.md`) are prompts, not code

- English canonical text; instruct the agent to answer in the user's language (`node "$CLI" lang` gives `zh`/`en`).
- Start with the "execute directly, do not explore" guard; judge results by exit code only.
- `AskUserQuestion` in kimi-code: 2–4 options per question, up to 4 questions per call, multi-select flag is snake_case `multi_select`, an "Other" option is added automatically, and the tool is disabled in auto permission mode (fall back to defaults).
- `setup` success reply is exactly three lines; no explanations, no segment lists unless asked.
- The plugin's managed copy is `$KIMI_CODE_HOME/plugins/managed/kimi-dashboard/`; commands reference the CLI by that path. Local installs are copies: reinstall after changes.

## Adding a segment / releasing

See `.agents/skills/add-segment/SKILL.md` and `.agents/skills/release/SKILL.md`.
