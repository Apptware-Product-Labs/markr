# Where We Stand — Markr AI Config Editor

> Snapshot: 2026-06-07 | Version: 4.6.0

## Current Position

Markr is the **most feature-rich AI config editor** in the VS Code ecosystem. Strong foundation, but not yet a **central AI configuration management platform**.

### What We Have (Strengths)

| Tier | Features |
|------|----------|
| **Core editing** | Split-edit mode, Agent Watch (fs.watch live preview), auto-open, scroll sync, multi-tab |
| **Token intelligence** | Model-aware counting (Claude, GPT-4, GPT-4o, Gemini, Mistral, Llama), section breakdown, token lens, status bar |
| **Distribution** | VS Code + Open VSX, 2.5K+ downloads, Activity Bar panel |
| **Testing** | Prompt Runner with streaming (Anthropic, OpenAI, Google) |
| **Export/sharing** | Copy as PNG, rich copy, HTML/PDF export, Mermaid render + copy |
| **Discovery** | File browser, search, new config wizard with templates |
| **Themes** | Markr Light, Dark, Notion White, Linear Dark |

### The Gap

We are a **great Markdown preview** with AI config *awareness*. We are not yet a **system that manages the entire AI configuration lifecycle**.

AI engineers today manage 3–5 heterogeneous config files simultaneously (CLAUDE.md + .cursorrules + mcp.json + .env + copilot-instructions.md). We preview them individually but do not understand their *interactions*.

## What to Build (Prioritized)

### 1. MCP & JSON Config Support (High Impact)
- `.cursor/settings.json`, `.vscode/mcp.json`, `.env` — structured preview, not raw text
- MCP server health cards: name, transport, enabled status, tool count
- `.env` redaction (masked values with reveal toggle)
- JSON schema validation for `mcp.json`

### 2. Cross-Config Context Dashboard
- Aggregate token count across all AI configs in workspace
- Color-coded budget bar: green <50%, yellow <80%, orange <95%, red >95%
- Conflict detection: flag contradictions between configs (e.g., TypeScript vs Python)
- Config dependency graph: which files reference each other

### 3. Config Validation & Linting ("ESLint for AI configs")
- Best-practice rules: CLAUDE.md missing `# Role`, .cursorrules >8K tokens, duplicate rules
- Security scan: detect hardcoded API keys, prompt injection patterns
- Schema validation: `mcp.json` must have `mcpServers`, etc.
- Inline issue badges in preview (red/yellow underlines on affected sections)

### 4. Session Diff & Audit Trail
- Capture diffs on every Agent Watch event (last 50 snapshots in-memory)
- Timeline: "2 min ago — +12 lines, -3 lines, +340 tokens"
- Side-by-side diff view in webview
- One-click revert to any snapshot
- Git integration: show last 5 commits in same timeline

### 5. Prompt Testing Framework (A/B Evals)
- `.markr/test.yml` support: system prompt + test cases + expected substrings
- Batch run all cases, report pass/fail, tokens used, latency
- A/B test two system prompts against identical cases with side-by-side results
- "Tests" tab in Markr webview

### 6. Variable Substitution & Context Preview
- Resolve `{{project_name}}` and `$ENV_VAR` in preview
- Show exactly what the model receives: system prompt + injected context + user message

### 7. Collaboration & Templates
- Import battle-tested configs from popular repos (Vercel, Anthropic, etc.)
- Export config bundles (`.markrpack`: CLAUDE.md + .cursorrules + mcp.json)
- Expanded template library beyond current wizard

## Architecture Debt to Fix

- `src/preview.ts` is 4,000+ lines. Extract into:
  - `src/webview/renderer.ts` — Markdown → HTML
  - `src/webview/jsonRenderer.ts` — JSON/.env → HTML
  - `src/webview/editor.ts` — Split-edit textarea + toolbar
  - `src/webview/agentWatch.ts` — fs.watch + live updates
  - `src/configValidator.ts` — Linting engine (pure functions)
  - `src/sessionDiff.ts` — Snapshot + diff engine
  - `src/contextDashboard.ts` — Cross-config aggregator

## Bundle Constraints
- Keep dependencies minimal. `gpt-tokenizer` was removed for being 2.7MB.
- If YAML parsing is needed for `.markr/test.yml`, write a minimal parser or use JSON.
- All webview UI stays in TypeScript template literals (no separate HTML files).

## Next Immediate Action

Implement **Phase 1: MCP & JSON Config Support** + **Phase 2: Cross-Config Context Dashboard**. These two features alone make Markr indispensable for anyone running Claude Code + Cursor + MCP servers simultaneously.
