---
name: add-segment
description: Add a new footer segment to kimi-dashboard end to end (types, render, config, presets, tests, docs, slash-command options). Use when asked to show something new in the status line.
---

# Add a segment

Work test-first (red → green). A segment is finished only when every step below is done; the tests and the docs are the checklist.

1. **Data.** Decide the source: payload (`src/types.ts` `StatusLinePayload`), `/usages` (`src/quota/parse.ts` → `QuotaData`), or a background computation written into the cache by `src/quota/refresh.ts` (never computed on the hot path).
2. **Id.** Add it to `SEGMENT_IDS` in `src/config.ts`; decide whether it joins `DEFAULT_CONFIG.segments` and which presets in `src/configure.ts` (`PRESETS`).
3. **Render.** In `src/render.ts`: a `xxxSegment()` returning `string | null` (null = hidden), a `case` in `segmentText`, a slot in `PRIORITY` (higher number = dropped earlier), icon via `icon("…", state)` so `icons=false`/ascii strips it, colours via `paint()`. Any glyph you add must be handled by `visibleWidth` (wide emoji → 2 cells).
4. **Tests first.** `test/render.test.ts` (literal expected strings, colours 0/16/256, hidden case, width trimming), `test/statusline.test.ts` if it needs env/files, `test/configure.test.ts` if a new key, `test/cli.test.ts` if the preview line changes.
5. **Preview.** Extend `previewLine()` in `src/preview.ts` so `preview` and `config` show it.
6. **Docs.** README segment table (中文 + English), `commands/setup.md` Custom groups (keep 3 segments + "None of these" per question, max 4 questions — regroup if needed) and the reference list, `docs/preview.svg` via `npm run preview:html`.
7. `npm test && npm run lint && npm run build && npm run bench`, then commit including `dist/cli.js`.
