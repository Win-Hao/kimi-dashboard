---
name: setup
description: Wire kimi-dashboard into the kimi-code footer and choose what it shows (full / compact / quota / custom)
---

**Execute directly, do not explore.** Everything you need is in this file: do not read files, source code or other command files, do not run `--help`, do not `ls`. Apart from the commands listed here, make no other tool calls. **Judge results by exit code only; do not interpret output text.**

```sh
CLI="${KIMI_CODE_HOME:-$HOME/.kimi-code}/plugins/managed/kimi-dashboard/dist/cli.js"
```

## Language

Talk to the user in their language: the language of their messages in this session if there are any; otherwise run `node "$CLI" lang` (prints `zh` or `en` from the user's config / OS locale). Localise the question texts, option labels and descriptions, and your final reply. Never translate segment ids (`5h`, `ctx`, …), option values or commands.

## Steps

1. Decide the layout:
   - `$ARGUMENTS` is non-empty → `node "$CLI" config $ARGUMENTS` (accepts `--preset full|compact|quota` or `key=value`, e.g. `segments=model,5h,7d,git quotaStyle=bar`).
   - `$ARGUMENTS` is empty → ask with AskUserQuestion: "Which footer layout?" with options **Full (Recommended)**: model · context · tokens · 5h · 7d · booster · spend · mode · git · cwd · session · version / **Compact**: model · context · tokens · 5h · 7d / **Quota**: 5h · 7d · booster · spend · mode · git / **Custom**: pick segments one by one. Then `node "$CLI" config --preset <choice>`. If AskUserQuestion is unavailable (auto permission mode), use `--preset full`.
   - **Custom** → one more AskUserQuestion call with 4 questions, each with `multi_select: true` (snake_case `multi_select`, not `multiSelect`). Each question has 3 segments plus one **"None of these"** option (kimi-code allows at most 4 options per question; never merge segments into bundles — the user ticks them individually):
     1. "Which quota segments?" `5h` 5-hour window · `7d` weekly window · `booster` booster balance · **None of these**
     2. "Which model / context segments?" `model` model name · `ctx` context bar · `tokens` context window tokens used/max (62.5k/195k) · **None of these**
     3. "Which status segments?" `spend` booster spend this month · `mode` auto/yolo/plan · `session` session duration · **None of these**
     4. "Which environment segments?" `git` branch · `cwd` directory name · `version` kimi-code version · **None of these**
     "None of these" wins over other ticks in the same group. Order the result as model ctx tokens 5h 7d booster spend mode git cwd session version and run `node "$CLI" config segments=a,b,c`. If every group is "None of these", say at least one is needed and ask again. If the user wants a different order, write `segments=` in the order they give.
   - Exit code 1 → relay the one-line stderr message and ask again; do not guess.
   - Remember the text after `preview: ` on the last output line.
2. Wire it up: `node "$CLI" setup --self`. Exit 0 → done. Exit 2 → tui.toml already has someone else's custom command: tell the user the quoted command from the output; only after they agree run `node "$CLI" setup --self --force`.

## Reply format (strict)

On success the whole reply is **exactly three lines**, in the user's language, with no explanation, no echoed command output, no list of segments or further usage:

```
✔ Wired · layout <Full/Compact/Quota/Custom>
<the preview line>
Run /reload to apply
```

On failure: one line with the reason, one line with the next step. Give the reference below only when the user asks what else can be shown or how to change it.

## Reference (only when asked)

Segments: `model` · `ctx` context bar · `tokens` context window tokens used/max · `5h` · `7d` · `booster` booster balance · `spend` booster spend this month · `mode` auto/yolo/plan · `git` branch · `cwd` directory · `session` session duration · `version` kimi-code version
Keys: `quotaStyle=text|bar` `separator=pipe|dot|arrow|space` `showReset` `icons` `barWidth` `ascii` `quotaWhenNotKimi=hide|show` `refreshIntervalMs` `staleAfterMs` `lang=auto|zh|en`
