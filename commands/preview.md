---
name: preview
description: Preview the footer in every state from sample data, offline
---

**Execute directly, do not explore.** Make no tool calls other than the commands below.

Run these (`--color` forces ANSI colours) and paste the three lines back verbatim, each prefixed with a short label (normal / high usage / non-Kimi model) in the user's language. **Do not explain the segments** unless asked.

```sh
CLI="${KIMI_CODE_HOME:-$HOME/.kimi-code}/plugins/managed/kimi-dashboard/dist/cli.js"
node "$CLI" preview --color $ARGUMENTS
node "$CLI" preview --color --hot
node "$CLI" preview --color --not-kimi
```

Other flags (only when the user asks): `--stale` `--no-auth` `--expired` `--empty` `--bar` `--ascii` `--width N`. To change what is shown, point the user to `/kimi-dashboard:setup`.
