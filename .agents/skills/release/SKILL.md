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
5. Commit `chore(release): vX.Y.Z`, tag `vX.Y.Z`, push branch and tag.
6. `gh release create vX.Y.Z --generate-notes` (the GitHub archive of the tag is what `/plugins install https://github.com/Win-Hao/kimi-dashboard` downloads).
7. Optional: `npm publish` (needs `npm login`; `files` in package.json already limits the tarball to dist, commands, kimi.plugin.json, README, LICENSE).
8. Ask users to reinstall the plugin (managed copies do not auto-update): `/plugins install …` → `/reload`.
