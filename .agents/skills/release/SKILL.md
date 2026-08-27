---
name: release
description: Cut a kimi-dashboard release — bump versions, rebuild dist, regenerate previews, verify, tag, push, GitHub release and optional npm publish. Use when asked to release, publish, or bump the version.
---

# Release

kimi-code installs the plugin from the **latest GitHub release** when one exists (otherwise the default branch), so once releases exist every user-facing change needs a release.

1. Pick the version (SemVer). Update `package.json` **and** `kimi.plugin.json` (`test/plugin.test.ts` enforces they match); `npm install --package-lock-only` to sync the lockfile.
2. `npm run build` (dist is committed), `npm run preview:html` (docs/preview.html + docs/preview.svg).
3. Verify: `npm test`, `npm run lint`, `npm run bench` (p99 < 150 ms). `git diff --stat -- dist` should show only the version string changes unless code changed.
4. Smoke-test the plugin flow in kimi-code: `/plugins install <repo path>`, `/reload`, `/kimi-dashboard:setup`, check the footer, `/kimi-dashboard:doctor`.
5. Commit `chore(release): vX.Y.Z` on a branch and open a PR; a human reviews and merges it (never self-merge). Then tag `vX.Y.Z` on the merged `main` commit and push the tag.
6. The `release` workflow (.github/workflows/release.yml) re-verifies, checks tag = package.json = kimi.plugin.json, creates the GitHub Release with generated notes (that archive is what `/plugins install https://github.com/Win-Hao/kimi-dashboard` downloads), and runs `npm publish` if the `NPM_TOKEN` repo secret is set.
7. Ask users to reinstall the plugin (managed copies do not auto-update): `/plugins install …` → `/reload`.
