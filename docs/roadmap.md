# Markr Roadmap

## Shipped ✅

### v6.1.0 — AI Config Lab
- AI Config Lab: test your `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, and Copilot
  instructions with lightweight prompt test cases directly inside Markr.
- Run a test prompt against the config (config = instruction, prompt = user message),
  stream the response, and get deterministic pass/fail from must-include /
  must-not-include checks.
- Tests stored locally in `.markr/config-tests.json`; config files never modified;
  secrets redacted before sending; nothing sent without an explicit Run.

### v3.9.0 — Agent Editor Release
- Markr IS the editor for AI config files (auto-open + close text editor)
- Agent Watch — `fs.watch` real-time preview without save
- Live badge + token delta + block diff highlighting
- Folder tree in Activity Bar panel
- Instant search with cache fallback

### v3.8.x — Copy & Icon
- Copy any table / code block / Mermaid diagram as PNG
- Rich copy (Cmd+C) writes text/html for Slack/Docs
- New M icon — readable at 16×16

### v3.7.x — AI Config Platform
- Activity Bar panel (browse without opening a file)
- New AI Config wizard with starter templates
- Paste & Preview clipboard panel
- File search in sidebar
- Mermaid theme re-render on switch

---

## Strategy 🎯

Markr is now two products under one name: a **Markdown/AI-config previewer** and an
**AI-config workbench** (Context Bridge handoffs, Memory, self-writing configs,
Scoreboard, Config Lab). Markdown preview is commoditized; the workbench is the moat.

Direction: **make Markdown a boringly-excellent substrate, then invest the roadmap in
the AI-config workbench.** Reframe the identity around *"the workbench for AI agent
instructions — edit, test, hand off,"* with Markdown as the base.

## Planned 🗓

### v6.2 — Config Lab depth + Markdown credibility
- **Config Lab: regression-on-edit** — remember each test's last result + the config
  it ran against; flag tests as *stale* when the config changes, and surface
  pass→fail *regressions* after a re-run. _(in progress)_
- **Richer assertions** — beyond substring: regex, "must refuse / must ask first,"
  and an opt-in LLM-as-judge for the expected-behavior note.
- ✅ **KaTeX math** (`$…$` / `$$…$$`) — shipped in 6.3, offline (fonts inlined).
- Markdown completeness: footnotes, `<details>` collapsibles, emoji shortcodes.

### v6.5 — Agent project tooling (multi-agent repos) ✅ shipped
- ✅ **AI Agent Map** — interactive pan/zoom wiring map for `.claude/` projects
  (capabilities → agents → schemas, hover-highlight, click-to-open), description-led
  roster + consistency check; dynamic columns so agents-only repos work too.
- ✅ **Workbench launcher** — sidebar buttons for Agent Map · Config Lab · Config Health.
- ✅ **Config Lab: API-key entry in the UI** + smart launch (picker / create) instead of
  a dead-end warning.
- ✅ **Context Bridge keyboard & a11y** — focusable session cards (↑/↓, Enter), ARIA
  tablist views (←/→), focus rings; 50/50 sidebar split.
- **Next:** schema-aware Config Lab assertion ("output must validate against
  `<schema>.json`") so agents that emit structured JSON can be tested for contract
  conformance; agent frontmatter lint folded into AI Config Health.

### v7 — Workbench as infrastructure
- **`markr test` CLI / CI mode** — run `.markr/config-tests.json` in CI so a bad
  config edit fails the PR. Turns Config Lab from a toy into team infra.
- **Multi-model compare** — run one test across Claude/GPT/Gemini side-by-side.
- **Shared webview design system** — one theme token set + components across
  Preview / Context Bridge / Scoreboard / Config Lab (currently inconsistent).
- **First-run onboarding** + clearer Marketplace positioning.

### Non-goals (explicitly out of scope)
- Markdown publishing / static-site generation.
- Full WYSIWYG editing.
- More standalone dashboards.
- Chasing feature parity with general Markdown-preview extensions.

---

## Download Milestones

| Target | Status |
|--------|--------|
| 1,000 downloads | ✅ |
| 2,500 downloads | ✅ |
| 5,000 downloads | 🎯 |
| 10,000 downloads | 🎯 |
