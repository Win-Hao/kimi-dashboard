# Contributing

Issues and pull requests are the way to change kimi-dashboard. The rules that matter live in [AGENTS.md](AGENTS.md) — they apply to humans too.

- **Open an issue first** for anything user-visible (new segment, option, behaviour) so the shape can be agreed before code.
- **Test-first.** Every change starts with a failing test (`npm test`), then the minimal implementation. Expected values are literals.
- **Rebuild `dist/cli.js`** (`npm run build`) and commit it — kimi-code installs the plugin straight from the GitHub archive, and CI fails on a stale bundle.
- `npm run lint`, `npm run build`, `npm run bench` (p99 < 150 ms) must pass; CI runs ubuntu / macos / windows × node 20 / 22.
- Keep README bilingual (中文 then English). Regenerate `docs/preview.svg` with `npm run preview:html` when rendering changes.
- Releases: bump `package.json` + `kimi.plugin.json`, tag `vX.Y.Z`, push the tag — the release workflow does the rest (see `.agents/skills/release/SKILL.md`).

Agents (Claude Code, kimi-code) working on the repo get the same rules automatically from AGENTS.md / CLAUDE.md and the skills under `.agents/skills/`.
