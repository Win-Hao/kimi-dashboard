---
name: doctor
description: Check kimi-dashboard — credential, cache, config, connectivity, footer wiring
---

**Execute directly, do not explore.** Everything you need is in this file: do not read files or source code, make no tool calls other than the command below.

```sh
node "${KIMI_CODE_HOME:-$HOME/.kimi-code}/plugins/managed/kimi-dashboard/dist/cli.js" doctor
```

Reply in the user's language (the language of their messages; otherwise run `node "$CLI" lang` → `zh` / `en`). Explain each ✔ / ✖ line briefly and give a next step for every ✖:

- `credential ✖ … expired / missing` → run `/login` in kimi-code (this plugin only reads the credential and never refreshes the token itself).
- `tui.toml ✖` → run `/kimi-dashboard:setup`.
- `connectivity ✖` → check the network or `KIMI_CODE_BASE_URL`.
- `cache … not written yet` → normal; it appears after the footer renders once.

The output never contains a token; do not read anything under the credentials directory.
