# Changelog

All notable changes to **Markr – Markdown Preview** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased] — v6

### Phase 5 — New Tool Readers (audience expansion)
- **Cline & Roo Code** — reads `globalStorage/<extId>/tasks/<id>/api_conversation_history.json`
  (Anthropic message array) for `saoudrizwan.claude-dev` and `rooveterinaryinc.roo-cline`.
  `parseClineHistory` handles string + block content (text / tool_use / tool_result).
- **Windsurf** (experimental) — same VS Code-family `state.vscdb` layout as Cursor;
  the Cursor SQLite reader was extracted into a shared `readVscdbSessions` helper that
  both now use. Degrades to empty if the prompt keys differ (unverified on this machine).
- **Gemini CLI** (experimental) — reads `~/.gemini/tmp/<hash>/chats/*.json`
  (`{role, parts:[{text}]}`); `parseGeminiChat` maps `model`→assistant.
- All four added to the `AiTool` union, `CTX_LIMITS`, `TOOL_COLOR`, `TOOL_LABEL`,
  model labels, and the Scoreboard tool set.
- **Tool-health row** at the bottom of the Context Bridge Sessions view — each tool
  shows ✓ (sessions found, with count) / — (none) / ⚠ (reader failed). Backed by a new
  `readAllSessionsWithHealth()` so no reader fails silently.
- 5 fixture-based unit tests for `parseClineHistory` / `parseGeminiChat`.
- **Hardening:** Cline/Roo now infer cwd from the task's `environment_details` so they
  surface in project scope (fall back to global when absent); workspace matching uses a
  path-segment boundary (`pathWithin`) so `/app` no longer matches sibling `/app-v2`
  (Cursor/Windsurf vscdb reader + Codex reader); and the tool-health row shows
  Windsurf as **experimental** (⚙) when it's installed but unread, distinct from a
  genuine "none".

### Phase 4 — The Scoreboard (cross-tool analytics)
- **`src/scoreboard.ts` + `src/webview/scoreboardHtml.ts`** — a "AI Scoreboard"
  webview panel (`markr.openScoreboard`, also a toolbar button on the Context Bridge)
  computed entirely from data Markr already has locally (SessionInfo + memory):
  - Sessions per tool per week (last 8 weeks) — stacked bars, inline SVG, no chart lib
  - Tokens per tool per week — stacked bars
  - Dead-end rate per tool (deadEnd memory items ÷ sessions), clearly labelled
    "heuristic estimate"
  - Median session length (messages) per tool
  - Most-worked projects (by session count + tokens)
- **Scope toggle** — this workspace / all projects. **Export as Markdown** copies a
  shareable report (tables, no SVG) — run through `redactSecrets()` first. Every
  number shows its source on hover ("from N sessions read locally").
- 6 unit tests in `src/scoreboard.test.ts` (week bucketing, dead-end rate, medians,
  project ranking, redacted Markdown export).
- **Polish:** charts are labelled "last 8 weeks only" and the all-time tables
  ("all time") so the header count and charts no longer appear to disagree; the panel
  reuses the sidebar's cached + Claude-normalized session list instead of re-reading
  every JSONL on open/scope-toggle (so "all projects" shows real folder names, not
  raw encoded slugs, and the extension host stays responsive).

### Phase 3 — Ambient Continuity (auto-handoff)
- **Context-exhaustion watch** — when an active session crosses 75% of its tool's
  context limit, Markr shows a one-time warning ("… session at 78% of context —
  prepare a handoff?") with [Generate handoff] / [Mute for this session]. One
  notification per session; mute is remembered in workspaceState.
- **Native file-based handoff delivery** (`src/handoffTargets.ts`) — after copying,
  Markr can write the handoff into the target tool's own convention so the next
  session picks it up with zero clicks: `CLAUDE.local.md` (a delimited
  `<!-- markr:handoff:start/end -->` block — the rest of the file is never touched),
  `.cursor/rules/markr-handoff.mdc` (with `alwaysApply` frontmatter), or `HANDOFF.md`
  for Codex/Augment. **Confirmed once per workspace+target** (remembered after).
- **Stale-handoff hygiene** — when a new session starts in the target tool after a
  handoff was written, the written file is marked consumed: the `CLAUDE.local.md`
  block gets `(consumed <date>)`, the Cursor `.mdc` has `alwaysApply` flipped to
  `false` (so a stale continuation stops being injected) and is stamped, and
  `HANDOFF.md` is stamped. Block upsert normalizes only the marker seams, so content
  outside the block is byte-for-byte untouched. Per-session exhaustion flags are
  pruned alongside the memory high-water map.
- **Handoff history** — last 20 handoffs per project persisted in globalStorage; a
  new **History** tab in the Context Bridge lists them with [Copy again] / [View]
  (opens in Markr's preview).
- 9 unit tests in `src/handoffTargets.test.ts` (block upsert/replace, consumed-marking,
  per-tool file shaping).

### Phase 2 — The Config Feedback Loop ("configs that write themselves")
- **`src/configSuggester.ts`** — turns repeated user constraints into evidence-backed
  config rules. Clusters constraint memory by hand-rolled token-set Jaccard (≥0.6),
  promotes clusters seen across ≥2 distinct sessions to an `add` suggestion with an
  imperative rewrite (`toRuleText`), target file chosen by precedence
  (CLAUDE.md > AGENTS.md > .cursorrules > create CLAUDE.md), and a token estimate.
- **Dead-rule detection** — splits the primary config into sections and flags any
  whose distinctive keywords never appear across the last ≥10 session transcripts
  as a `remove` suggestion (with the token saving).
- **Suggestion UI** — a "Config suggestions" section at the top of the Memory tab,
  each with an imperative rule, target/token info, an expandable evidence list
  (raw quotes + tool), and Accept / Dismiss. Plus a once-per-day-per-project
  VS Code notification when new suggestions appear.
- **One-click apply** — Accept on an `add` appends the rule under a
  `## Learned rules (Markr)` heading via a `WorkspaceEdit` (so it's undoable), creating
  the file if absent, then reports the token delta. `remove` opens a `vscode.diff`
  preview and applies only on explicit confirm. Never edits a file without Accept.
- **Opt-in LLM polish (2c)** — `markr.aiEnhance` (default off). When on and a provider
  key exists, the clustered quotes are rewritten by the cheapest model of the configured
  provider (10s timeout, silent fallback to the local template). Evidence shown is always
  the raw local text. No network unless explicitly enabled.
- **Safety refinements:** dead-rule detection never flags guardrail sections
  (security/secret/safety/license/deploy/auth/privacy/incident/…); when `aiEnhance`
  rewrites a rule, the rewrite is shown in a confirm dialog before it's written
  (accept-what-you-see); suggestion ids are keyed on a stable cluster signature so a
  dismissed suggestion can't resurrect under new wording; the remove-flow diff uses a
  temp file that's cleaned up after.
- 12 unit tests in `src/configSuggester.test.ts` (clustering, imperative rewrite,
  target-file precedence, dead-rule keyword matching, guardrail protection, stable ids).

### Phase 1 — Persistent Cross-Session Memory
- **Memory store** (`src/memoryStore.ts`) — mined residuals (decisions, dead-ends,
  constraints) are now persisted per project under the extension's globalStorage
  (`memory/<project-hash>.json`), instead of being discarded after each handoff.
  Deduped on a normalized 60-char key (occurrences + lastSeen bump on re-sighting),
  capped at 500 items/project (evict oldest-dismissed, then oldest). Local-only.
  **Secrets are redacted before they are persisted** (`redactSecrets` runs inside
  `addFromSession`), so memory honours the same at-rest guarantee as handoffs. The
  per-session high-water map is pruned during eviction so it can't grow unbounded.
- **Background incremental scan** — after the Context Bridge posts session data, a
  non-blocking pass mines only sessions whose `lastActive` changed since the last
  scan (per-session high-water mark in the store) and folds the results into memory.
- **Memory-seeded handoffs** — `summariseSession()` now merges a project's persisted
  active dead-ends/constraints (seen ≥2× or in the current session) into the handoff,
  tagged "(from earlier sessions)", so continuity survives across sessions.
- **Memory tab** in the Context Bridge sidebar — grouped by kind, per-item tool badge
  + occurrence count + dismiss, cross-project search. Rendered via `textContent`
  (no `innerHTML` for user content). All updates via postMessage, no page reloads.
- 13 unit tests in `src/memoryStore.test.ts` (normalization, dedupe, eviction,
  high-water-mark incremental scan, per-project isolation).

### Phase 0 — Trust Foundation

#### Added
- **Secret redaction in handoffs** (`src/redact.ts`) — `redactSecrets()` strips API keys,
  tokens and connection-string passwords from a handoff as the final step of
  `generateHandoff()`, before it reaches the clipboard. Catches Anthropic/OpenAI (`sk-…`),
  GitHub (`ghp_…`, `github_pat_…`), Slack (`xox…`), AWS (`AKIA…`), Google (`AIza…`),
  `Bearer` tokens, `postgres/mongodb/mysql/redis` connection strings, and generic
  `key = <12+ chars>` assignments. False-positive guarded (prose "token", UUIDs in
  paths, short values are never touched). The Context Bridge toast now reports the
  redaction count ("… — 2 secrets redacted"). 18 unit tests in `src/redact.test.ts`.
- **CRH mining eval harness** (`eval/`) — labelled fixture corpus (10 Claude-Code-format
  transcripts) + `eval/run.mjs` computing per-category precision/recall/F1 for the
  production decision/dead-end/constraint mining, gated against `eval/baseline.json`.
  `npm run eval` (and `npm run test:full` to run unit tests + eval). This is a
  **regression gate** for later mining changes — the corpus is synthetic, so F1 here
  measures "do the regexes still match what they matched before," not real-world
  accuracy. (A GA accuracy number needs fixtures derived from anonymized real
  transcripts.) Redaction additionally covers prefixed env names (e.g.
  `AWS_SECRET_ACCESS_KEY`) and PEM private-key blocks.

## [5.0.0] — 2026-06-10 _(beta — published as a Marketplace pre-release)_

> **5.0.0 headline: Context Bridge.** See every AI coding session across Claude Code, Cursor, Augment, Codex & Aider in one sidebar, and hand any of them off to another tool with a Conditional Residual Handoff. Published as a pre-release (`vsce publish --pre-release`) — `package.json` stays at the clean semver `5.0.0` because the Marketplace does not accept a `-beta` suffix.

### Added — Context Bridge: Conditional Residual Handoff (CRH) — _beta_
- **CRH handoff engine** — handoffs now transmit the _residual_ (what the repo can't tell the next agent) rather than re-dumping the chat. Built on two proven foundations: Slepian–Wolf conditional source coding (don't send what the decoder can re-derive) and the I-PASS clinical handoff protocol (receiver synthesis).
- **🧠 Decision log** — decisions + their rationale mined from the full transcript (the "why" behind the current code, unrecoverable from reading the repo).
- **🛑 Dead-ends** — failed approaches the next agent must not retry.
- **📌 Constraints** — hard requirements stated by the user, with a pasted-content reject filter to cut review-bot/log noise.
- **🔀 In-flight delta** — live `git branch` + `git status` + `git diff --stat HEAD` captured at handoff time (the uncommitted work reading committed code can't show).
- **Pointers, not payload** — modified-file lists are emitted as "read these" pointers for repo-aware targets; repo-less targets (ChatGPT) get a different framing.
- **Receiver synthesis** — the paste block ends by requiring the receiver to restate the task + the one constraint before acting.

### Improved
- **Task de-contamination** — `chooseTask` detects throwaway last messages ("commit msg?", "any change on google app?") and leads with the real task.
- **Cleaner Claude session titles** — `deriveClaudeTitle` skips the continuation-summary / system preamble and shows the first real instruction line.
- **Reliable Claude Code coverage** — the session cap is now project-aware: open-workspace sessions are never dropped; the cap (raised 30 → 50) only bounds the long tail of other projects.
- **Augment activity capture** — tool records (`apply_patch` / `launch-process` / `view`) are keyed by `tool_name`, and both `.log` (WAL) and `.ldb` (SSTable) files are scanned, so modified-file lists are accurate.

### Fixed
- **Copy-as-image clipping** — tall sections were cut off because the PNG was sized from the live-preview height, not the export height. The renderer now measures the true rendered height off-screen with the export stylesheet, so nothing is clipped.

### Tests
- Added Vitest unit suite (`src/sessionReader.test.ts`, 24 tests) covering title derivation, task de-contamination, decision/dead-end/constraint mining, and handoff document structure. Run with `npm test`.

## [4.7.0] — 2026-06-07

### Added
- **MCP Config viewer** — open any `mcp.json` or `.mcp.json` in Markr and see each MCP server rendered as a card showing: name, transport (stdio/SSE), enabled status, command, environment variables (values masked), and tool count.
- **`.env` file viewer** — open `.env` / `.env.local` / `.env.production` in Markr. Keys shown in plain text, values masked with `••••••`. Click 👁 to reveal individual values.
- **Generic JSON viewer** — any JSON file opens as a collapsible key-value tree with syntax highlighting (strings, numbers, booleans, null each in distinct colors).
- **Activity Bar detection** — `mcp.json`, `.mcp.json`, `.env.*`, and `.windsurfrules` files now appear in the Markr file tree with appropriate AI kind badges (MCP, Env).
- **Editor title icon** — Markr's ◈ icon now appears on `mcp.json`, `.mcp.json`, and `.env` files in the editor tab bar.
- **`src/webview/jsonRenderer.ts`** — new pure-function module for JSON/MCP/env rendering (no VS Code APIs — fully testable).

## [4.6.0] — 2026-06-07

### Added
- **Token Lens** — live token cost inline in the VS Code text editor. Every heading in your `CLAUDE.md`, `agent.md`, or any AI config file now shows a colored decoration on the same line: `▏ 42 tok · 5%` (green), `▌ 1.8K tok · 22%` (amber), `█ 3.2K tok · 38%` (red). The block character encodes weight visually — thin = light, full = heavy. Percentage is relative to the file total so you instantly see which section dominates. Updates live as you type.
- **File-level CodeLens** — a summary above line 1 shows total tokens, detected model, and context window usage: `⬡ 8.4K tok · Claude · ▰▰▱▱▱▱▱▱▱▱ 4.2% of context`. Clicking it opens the file in Markr.
- **Status bar token count** — `⬡ 8.4K tok` appears in the bottom-right status bar whenever a Markdown file is active. Clicking opens the file in Markr.
- **Smart AI config detection** — 4 detection layers (exact name → filename pattern → folder path → content heuristic). Now auto-detects `review-agent.md`, `backend-skill.md`, anything in `skills/` or `agents/` or `.claude/` folders, and any file with `## Trigger` + `## Instructions` headings.

### Improved
- **Activity Bar never freezes** — file watcher now uses incremental `addFile`/`removeFile` instead of full re-scan on every create/delete. No more "Scanning workspace…" spinner on file changes.
- **Activity Bar keeps showing files during refresh** — background rescan no longer clears the tree first. Files stay visible while the update runs.
- **TOC section click** — now scrolls AND flashes a highlight in the correct visible pane (preview or split-preview). Large files now scroll correctly (was silently doing nothing in edit mode).
- **File switch scroll reset** — switching to a different file now correctly resets scroll to the top of both the preview and textarea.

### Removed
- **Context Composer** — removed from the sidebar. Was confusing and added no clear value. The token-per-section data is now surfaced more clearly via Token Lens directly in the editor.

### Fixed
- Token Lens only shown on AI config files (not on every README/doc)

## [4.2.0] — 2026-06-06

### Added
- **Model-aware token counter**: the toolbar token count now detects which AI model the file is for and shows its name — `~1.8K tok Claude`, `~2.1K tok GPT-4`, `~1.9K tok GPT-4o`, etc. Supports Claude, GPT-4 / Cursor, GPT-4o / Copilot, DeepSeek, Kimi (Moonshot), Llama 3, Llama 2, Mistral / Mixtral, Gemini, Qwen. Uses content-aware heuristics (code ~3 chars/tok, prose model-specific ratio) — ±5% accuracy, no external tokenizer library.
- **Token section breakdown panel**: click the token count in the toolbar to see a popup showing how many tokens each heading section uses, with a proportional bar. Sections over 25% of the total are highlighted. Click any row to jump to that section in the preview.

## [4.1.0] — 2026-06-06

### Added
- **Resizable sidebar**: drag the handle between the sidebar and content area to set your preferred width (160–480px). Persists in localStorage. Double-click to reset to default.

### Fixed
- **TOC collapse now fills full height**: collapsing "On this page" now lets Notebooks expand to fill ALL remaining sidebar height (was stopping partway due to `min-height: 150px` on the TOC section)
- **Mermaid Gantt `classDef` bomb removed**: `classDef` is not supported in Gantt diagrams — caused a Mermaid parse error visible as a bomb icon. Removed from the showcase demo file.

## [4.0.0] — 2026-06-06

### Changed
- **File list readability**: filenames now use full contrast `var(--text)`, folder paths use `var(--text-muted)` instead of near-invisible `var(--text-faint)` (#48443e in dark theme), folder headers are 12px readable weight instead of 10px tiny uppercase
- **Stable base release**: reverted to proven v3.9.6 codebase as the 4.x foundation

---

## [3.11.1] — 2026-06-05

### Changed
- **Notebooks fills height when "On this page" is collapsed**: collapsing the TOC section now lets the Notebooks file list expand to fill all remaining sidebar height — no wasted empty space
- **Resizable sidebar**: drag the thin handle between the sidebar and the main content to set your preferred sidebar width (180px – 420px). Width is remembered across sessions. Double-click the handle to reset to the default 240px.

---

## [3.11.0] — 2026-06-05

### Added
- **Prompt history**: every Prompt Runner conversation is automatically saved. Click the **History** button in the chat panel header to browse all past runs grouped by date. Click any entry to restore the conversation. Limit: last 200 runs per workspace. Use "Clear history" to reset.
- **Inline token decorations**: a subtle `~N tok` annotation appears at the end of every heading line in Markdown files in the VS Code editor — like GitLens blame but for token cost. Sections using more than 25% of the file's total tokens are highlighted in warning colour. Toggle off via `markr.showTokenDecorations: false` in Settings.
- **`markr.showTokenDecorations` setting** (default: `true`)
- **`markr.clearPromptHistory` command** in the Command Palette

---

## [3.10.3] — 2026-06-05

### Security
- **XSS fix in chat**: user messages now render as plain text (`textContent`) — previously `renderChatMarkdown` called `marked.parse()` + `innerHTML` on user input, allowing HTML injection in the VS Code webview context
- **Google API key moved from URL to header**: was visible in HTTP logs and proxies; now sent as `X-Goog-Api-Key` header (same pattern as Anthropic and OpenAI)

### Fixed
- **Double `onDone` call**: Anthropic and OpenAI streaming called `onDone()` twice — once on the final SSE event and again on TCP close — resulting in a blank duplicate assistant message being appended to conversation history; fixed with a `finished` guard flag
- **Panel disposal crash**: closing Markr while a stream was in flight caused `panel.postMessage()` to throw "webview is disposed"; all post-stream `postMessage` calls are now wrapped in `try/catch`
- **HTTP error codes silently ignored**: 401, 429, 500 responses from all three providers now surface a readable error message instead of a silent empty bubble
- **Model picker disabled during streaming**: changing the model while a response was arriving corrupted conversation history sent to subsequent turns
- **Stale streaming state on panel reopen**: re-opening Markr after closing mid-stream left the send button permanently in "stop" mode; now reset on `openChat()`
- **Empty response shows helpful message** instead of a blank bubble
- **Request timeout added (60s)**: streams no longer hang indefinitely on network issues
- **`agent.md` and `.windsurfrules` added to AI_CONFIG_NAMES** in markrExplorer.ts — these files were not getting the star icon or being sorted to the top of the file list

---

## [3.10.2] — 2026-06-05

### Fixed
- **Prompt Runner DOM bug**: `appendMessage` was mixing `innerHTML +=` with `appendChild` which destroyed the copy button node — rebuilt using pure DOM methods
- **Auto-scroll during streaming**: always scrolls to bottom during streaming; respects user scroll position once streaming is done
- **After adding API key, chat panel refreshes immediately** — setup screen disappears and model picker activates without needing to reopen
- **Streaming text display**: shows escaped plain text while streaming (fast), renders full markdown only when done (avoids layout thrash on every chunk)
- **Error messages** styled with icon instead of raw red text
- **`markr.setApiKey` added to command palette** so users can update keys anytime via `Ctrl+Shift+P`

### Added
- **Suggestion chips in empty state** — 3 context-aware starter prompts based on the file type (CLAUDE.md shows different suggestions than .cursorrules). Click to fill the input.
- **Escape to close** chat panel
- **System prompt info badge** shows filename + token count at top of chat panel
- **Send button properly disables/enables** during streaming

---

## [3.10.1] — 2026-06-05

### Added
- **Context Composer sidebar panel**: a new collapsible "Context" section in the sidebar shows every AI config file in scope — current workspace files AND parent directory files (exactly how Claude Code reads them hierarchically). Each file shows a token count, proportional bar, and AI tool badge. A gradient progress bar shows how much of the model's context window is used. Click any row to toggle it. **Copy merged** copies all selected files as one formatted context block ready to paste. **View merged** opens it as a live Markr preview.

---

## [3.10.0] — 2026-06-05

### Added
- **Prompt Runner — full chat UI inside VS Code**: click `▶ Run` in the toolbar to open a chat panel. The current file becomes the system prompt. Left pane = editable file, right pane = streaming chat. Edit your prompt and test immediately without leaving the editor.
  - Beautiful message bubbles (user right, assistant left) with markdown rendering, code blocks, inline code
  - Model selector grouped by provider — Anthropic (Claude 4 Sonnet/Opus, Claude 3.5), OpenAI (GPT-4o, o3-mini), Google (Gemini 2.0 Flash, 1.5 Pro)
  - Streaming responses with animated cursor
  - Copy button on every message
  - New chat button
  - Smooth setup screen when no API key configured — explains SecretStorage, one click per provider
  - API keys stored in VS Code's encrypted SecretStorage — never plain text, never in git
- **Architecture refactor**: extracted `tokenEngine.ts`, `contextComposer.ts`, `promptRunner.ts` as clean separate modules. Adding a new model = one entry. Adding a new feature = one file.

---

## [3.9.7] — 2026-06-05

### Added
- **Accurate model-aware token counting**: replaced `chars / 4` with real tokenization per AI tool — GPT-4 / Cursor use the exact `gpt-tokenizer` cl100k encoder; GPT-4o / Copilot use the o200k encoder; Claude / Windsurf use a content-aware heuristic (code blocks at ~3 chars/tok, prose at ~3.5 chars/tok). Each model gives a meaningfully different count for the same file.
- **Model label on token counter**: the toolbar now shows which model is being counted — `2.3K tok Claude`, `2.1K tok GPT-4`, `2.0K tok GPT-4o`. Detected automatically from the filename (CLAUDE.md → Claude, .cursorrules → GPT-4, copilot-instructions.md → GPT-4o, etc.)
- **Token section breakdown panel**: click the token count in the toolbar to see a popup showing how many tokens each heading section uses, with a proportional bar. Click any row to jump to that section. Helps identify which parts of your config to trim.

---

## [3.9.6] — 2026-06-05

### Changed
- **Smoother live-edit reveal animation**: replaced the jarring green background flash with a clean two-phase animation — new blocks slide up from slightly below while fading in (0.35s), then a soft green left accent dissolves over 2.5s. No background colour blocks, no padding jumps. Matches how Notion and Linear show AI-written content.
- **Manual typing also shows reveal**: when you type in the split-edit textarea, newly completed paragraphs and headings in the right pane now use the same smooth reveal animation — not just agent edits. Uses a shared `swapWithReveal` helper.
- **Animation resets cleanly**: `agent-new` class is removed after the animation completes so it doesn't interfere with copy buttons, selections, or subsequent edits.

---

## [3.9.5] — 2026-06-05

### Fixed
- **Agent Watch now works in split-edit mode**: the biggest bug — opening CLAUDE.md auto-enters split-edit mode (`editMode = true`), which caused `_onFsChange()` to return early with no update. Removed the `editMode` guard. When an agent edits the file on disk, Markr now: (1) updates the right-hand preview pane with green diff flash, (2) syncs the textarea to the agent's content, (3) fires the Live badge and token delta regardless of edit mode.

### Changed
- **License updated**: Markr is now proprietary — All Rights Reserved, free for personal use, commercial licence required for organisations (10+ users / product embedding / white-labelling). Contact sumit.patil@apptware.com for commercial terms.

---

## [3.9.4] — 2026-06-05

### Added
- **Two-phase file scan**: root-level `.md` files appear in the Notebooks panel in under 20ms (no full workspace traversal needed). The deep scan runs in the background and updates the list once complete. Large repos no longer show a blank panel while scanning.

### Changed
- **SCM-style file list**: the Notebooks panel file list now matches VS Code's Source Control aesthetic — compact rows, filename left, parent folder right-aligned and dimmed. AI config files show their tool badge (Claude, Cursor, Agent) on the right. Cleaner, denser, easier to scan at a glance.

---

## [3.9.3] — 2026-06-05

### Fixed
- **Critical: .md files no longer hijacked by Markr** — the auto-open behaviour that replaced VS Code's text editor with Markr is now **off by default**. Files open normally in VS Code. The text editor is always preserved.

### Added
- **`markr.autoOpenAiConfigs` setting** (default: `false`) — opt-in toggle in VS Code Settings. When enabled, opening CLAUDE.md, .cursorrules, agent.md, or any AI config file automatically opens Markr alongside the text editor (Beside column). Both editors stay open — the user controls their layout. Enable via: *Settings → Extensions → Markr → Auto Open AI Configs*

### Changed
- Auto-open no longer closes the text editor tab under any circumstance — both Markr and the text editor stay open when the feature is enabled

---

## [3.9.2] — 2026-06-04

### Changed
- **Display name updated**: `Markr – Markdown Preview` → `Markr – AI Config Editor & Markdown Preview` — reflects the primary use case
- **Description updated**: leads with AI config editor + Agent Watch positioning for better marketplace search ranking
- **Keywords expanded**: added `agent watch`, `live preview`, `real-time preview`, `agent config`, `agent editor`, `ai agent`, `claude md`, `cursor rules`, `copilot instructions`, `context window`, `token counter`, `mermaid diagram`
- **README "See it in action" updated**: new gif-07 (auto-open) and gif-06 (agent watch) demos placed at the top — most differentiating features shown first
- **Demo files refreshed**: `samples/demo-ai-workflow.md` restored to proper AI agent architecture content (Mermaid sequence + flowchart, tables, alerts) for GIF recording

---

## [3.9.1] — 2026-06-03

### Fixed
- **No more false unsaved changes on open**: opening any file in Markr no longer shows the ● (unsaved changes) dot in the VS Code tab. The `edit` handler now guards against calling `applyEdit()` when the webview content is identical to the current document — which was happening on every file open due to the initial edit-mode sync

### Changed
- **Activity Bar icon updated**: the Markr sidebar icon (monochrome, shown in VS Code's Activity Bar) is now a document shape with folded corner and AI sparkle — matching the brand logo design from `icon.png`

---

## [3.9.0] — 2026-06-03

### Added
- **Markr IS the editor for AI config files**: opening CLAUDE.md, .cursorrules, agent.md, skill.md, copilot-instructions.md, .windsurfrules, or any AI config file from anywhere in VS Code (Explorer, Ctrl+P, terminal, git checkout) now opens it **exclusively in Markr** — the text editor tab is automatically closed so Markr's split-edit view is the only editor for these files
- **Agent Watch — real-time live preview**: Markr watches files directly on disk via `fs.watch`. When Claude Code, Codex, Cursor, or any AI agent edits a file **without saving**, the preview refreshes automatically (300ms debounce) — no save event needed
- **Live badge**: a `⬤ Live` indicator in the toolbar pulses green and shows `⬤ Updated` for 3 seconds when an agent edit is detected
- **Token delta badge**: `+N tok` / `−N tok` appears for 8 seconds after each agent edit — shows the exact context cost of what the agent wrote
- **Block-level diff highlighting**: new sections added by an agent flash green with a fade animation so you can see exactly what changed
- **Folder tree in Activity Bar panel**: the Workspace section shows files grouped in a collapsible nested folder tree instead of a flat list
- **Search in Activity Bar**: 🔍 button in the panel title opens a fuzzy Quick Pick over all workspace files — instant from cache, scans directly if cold
- **Extension icon regenerated**: `icon.png` regenerated from `icon.svg` for consistent branding

### Fixed
- **Search was stuck/empty**: `markr.searchFiles` now uses cached files instantly; if the cache is cold it scans directly with a progress indicator — never shows an empty picker
- **Faster workspace scan**: exclusion list expanded to skip `build/`, `coverage/`, `.turbo/`, `.cache/`, `tmp/`, `vendor/`, `public/` and more — significantly faster on large repos
- **Source button loop guard**: clicking "Source" in Markr to open the raw text editor works correctly — auto-close is suppressed for 2 seconds so the text editor stays open

---

## [3.8.1] — 2026-06-03

### Added
- **Folder tree in Activity Bar panel**: the Workspace section now shows files grouped in a nested folder tree — directories are collapsible, sorted alphabetically with files inside each folder. Previously all files were shown as a flat list with a directory description
- **Search button in Activity Bar panel**: a 🔍 search icon now appears in the Markr panel title bar. Clicking it opens a fuzzy Quick Pick over all workspace Markdown and AI config files — AI configs are pinned at the top, matches on both filename and path

### Fixed
- **Extension icon regenerated**: `icon.png` regenerated from `icon.svg` to ensure the marketplace icon and installed extension icon are consistent

---

## [3.8.0] — 2026-06-03

### Summary
Milestone release consolidating all v3.7.x features, GIF demos, and bug fixes into a clean publish.

### Added (since v3.7.0)
- **Activity Bar panel** — browse AI configs and workspace files without opening a markdown file first
- **New AI Config wizard** — `+` button creates CLAUDE.md, .cursorrules, copilot-instructions.md, agent.md etc. with quality starter templates
- **Copy any table as rich HTML** — hover any table → "Copy table" → pastes as a real formatted table in Slack, Google Chat, Google Docs, Notion
- **Copy any table / code block / diagram as PNG** — hover → 📷 Image → 2× retina PNG to clipboard; falls back to PNG download if clipboard API is blocked
- **Rich copy (Cmd+C)** — selecting content in the preview and pressing Cmd+C writes `text/html` + `text/plain`; formatting is preserved when pasting into Slack, Docs, Notion
- **Paste & Preview clipboard panel** — click Preview Clipboard (or Cmd+Shift+P) to open markdown in a split edit pane; edit live, Mermaid renders on the right, save as .md
- **File search in Notebooks panel** — search box filters workspace .md files by name or path; press Esc to clear
- **Skeleton loading state** — animated shimmer rows replace the invisible "loading" text while workspace files scan
- **Mermaid copy as PNG** — hover any diagram → 🖼 Copy image or ⤢ Expand with zoom + copy in modal

### Fixed (since v3.7.0)
- **Mermaid theme re-renders on theme switch** — switching Light/Dark/Notion/Linear now immediately updates all diagram colours; previously colours stayed stale until you navigated away and back
- **Mermaid renders in clipboard preview and split-edit mode** — diagrams in clipboard content and AI-config split-edit panes now render correctly
- **Gantt chart syntax error** — Unicode arrow characters (`→`) in task names caused a parser error; replaced with ASCII-safe text in demo files
- **Clipboard preview layout shift** — clipboard content no longer adds a tab entry, preventing the tab-bar from appearing and shifting the layout
- **Clipboard Dismiss restores previous file** — clicking Close/Dismiss on the clipboard banner now fully restores the previous file, title, AI badge, TOC, and edit mode state
- **AI config file switching stale content** — switching between CLAUDE.md / agent.md / skill.md files while in edit mode now correctly loads the new file's content into the textarea

### Changed
- README restructured: **GIFs come first** in a dedicated "See it in action" section — Activity Bar → Table copy → Diagram PNG → Paste & Preview → File search — all at consistent 100% width
- GIFs loaded via GitHub raw URLs (not bundled in `.vsix`) — keeps package at ~1.8 MB instead of 58 MB
- Demo sample files added to `samples/` folder for testing all features
- `.vscodeignore` updated to exclude large GIF files from the installed extension bundle

---

## [3.7.9] — 2026-06-03

### Changed
- Version bump — `markr-3.7.8.vsix` published to VS Code Marketplace and Open VSX
- GIF demo files (`gif-01` through `gif-05`) committed to the repository; README now references them via absolute GitHub raw URLs so they render on the Marketplace overview page without being bundled into the `.vsix`
- `.vscodeignore` updated to exclude `images/screenshots/*.gif` — keeps the installed extension package at ~1.8 MB instead of 58 MB
- Demo markdown samples (`demo-ai-workflow.md`, `demo-claude-md.md`, `demo-copy-features.md`) added to `samples/` for testing and marketing content

---

## [3.7.8] — 2026-06-03

### Fixed
- **Mermaid theme change now re-renders diagrams instantly**: switching between Markr themes (Light → Dark → Notion → Linear) now immediately updates all rendered Mermaid diagrams with the correct colour palette. Previously diagrams kept the original theme colours until you navigated to another file and back. Each diagram's source is now stored in `data-mermaid-src` and the Mermaid module re-initialises + re-runs on every `markr-theme-change` event
- **Gantt chart syntax error with Unicode arrows**: task names containing `→` (U+2192) caused a Mermaid parser syntax error. Fixed in the demo files by replacing with `to` (ASCII)

### Changed
- README screenshots section updated to use existing screenshots — GIFs are now properly embedded inline within their respective feature sections (no broken image links)
- Demo sample files updated: Gantt chart task names use ASCII-safe text

---

## [3.7.7] — 2026-06-02

### Added
- **"Copy as image" on every table and code block**: hover any table or code block to reveal two buttons — "Copy table" (rich HTML/TSV for chat apps) and "📷 Image" (PNG for anywhere HTML paste doesn't work — Figma, mobile apps, screenshots, Confluence). Uses SVG `foreignObject` rendering at 2× retina resolution with the current Markr theme colours baked in
- The `📷 Image` button falls back to downloading `markr-export.png` if the Clipboard API is unavailable

### Changed
- Copy buttons on code blocks are now grouped in a flex row alongside the new Image button — cleaner layout, same hover-reveal behaviour

---

## [3.7.6] — 2026-06-02

### Added
- **Rich copy — paste formatted content into Slack, Google Chat, Notion, Docs**: selecting any text in the preview and pressing `Cmd/Ctrl+C` now copies both `text/html` (full formatting) and `text/plain` to the clipboard. Tables, bold, lists, code, headings, blockquotes — all preserved when pasting into any app that supports rich text. A subtle toast confirms when formatted content was copied
- **Table "Copy table" button**: hovering a table reveals a "Copy table" button (top-right, same as code blocks). Copies the table as HTML for rich apps (Slack renders it as a real table) and as tab-separated text for spreadsheet apps (Excel, Google Sheets)

### Fixed
- Table `margin-bottom` spacing preserved correctly after wrapping tables for the copy button

---

## [3.7.5] — 2026-06-01

### Added
- **File search / filter in Notebooks panel**: a search box now sits below the "Notebooks" section header. Type to filter files instantly — matches against both filename and path. Shows a flat list while filtering (no folder tree) for quick scanning. Press `×` or `Escape` to clear
- **Skeleton loading state**: the "Loading workspace files…" plain text is replaced by animated skeleton rows (pulse shimmer) plus a spinning indicator and "Scanning workspace…" label — clearly communicates background scanning without blocking the UI

---

## [3.7.4] — 2026-06-01

### Fixed
- **Mermaid diagrams not rendering in clipboard preview**: sequence diagrams, Gantt charts, and all other Mermaid blocks now render correctly in the split-preview pane when content is pasted via Preview Clipboard. Previously the diagram showed as a raw code block because `setupMermaid()` was never called after seeding the split-preview
- **Mermaid not rendering in split-edit mode**: Mermaid diagrams now also render in the right-hand preview pane when editing any file (AI config or otherwise) in split-edit mode — previously they showed as code blocks while editing

---

## [3.7.3] — 2026-06-01

### Added
- **Copy Mermaid diagram as PNG image**: every rendered diagram now has a "🖼 Copy image" button (appears on hover, top-right of the diagram). Click it and the diagram is copied to your clipboard as a high-resolution PNG (2× retina) — ready to paste into Notion, Slack, Google Docs, email, or anywhere else
- **Copy image in the fullscreen modal**: the expanded diagram modal also has a "🖼 Copy image" button in the controls bar so you can copy while zoomed in
- **Download fallback**: if the Clipboard API is blocked (permissions / browser), the button automatically downloads `diagram.png` instead of silently failing
- **Theme-aware background**: the PNG fill colour matches the active Markr theme (white for Light/Notion, dark for Dark/Linear) so diagrams look correct when pasted

---

## [3.7.2] — 2026-05-29

### Changed
- **"Preview Clipboard" is now a paste & edit panel**: clicking the button (or pressing `Cmd/Ctrl+Shift+P`) opens the markdown in split-edit mode — the raw text is in the left textarea (editable), the live rendered preview is on the right. Users can paste, edit, and type freely before saving
- **No more silent clipboard reads**: the content is always visible and editable — no more surprise "random text from a file" appearing. Whatever is in the clipboard is loaded into the editor where you can see and change it before it becomes a real file
- **Edits stay in the clipboard pane**: typing in the paste editor never modifies the real file you had open. The extension now routes clipboard edits through a render-only path (no disk writes) until you explicitly press "Save as .md"
- **Save uses latest content**: "Save as .md" saves whatever is currently in the editor at the time of clicking — including any edits made after pasting
- **Close restores previous state**: closing the clipboard panel restores your previous file, title, TOC, and edit mode exactly as they were

---

## [3.7.1] — 2026-05-29

### Fixed
- **Clipboard preview layout shift**: clicking "Preview Clipboard" no longer adds a tab or triggers the tab-bar, preventing the `margin-top` layout shift that made the content area jump. Clipboard content is now a pure overlay with no effect on the tab state
- **Clipboard dismiss restores previous file**: clicking "Dismiss" on the clipboard banner now correctly restores the previously open file's content, title, AI badge, edit mode, and TOC — instead of leaving the clipboard content in the viewport with a hidden banner
- **Tracked document preserved across clipboard preview**: the extension now keeps `this._document` pointing at the real on-disk file during a clipboard preview, so scroll-sync, save, and "Open in editor" continue to work correctly after dismissing
- **`Cmd+Shift+P` / `Ctrl+Shift+P` shows the clipboard banner**: the keyboard shortcut path now routes through the same overlay mechanism as the toolbar button — the "Clipboard preview" banner is always shown and the content is never silently mixed into the file history

---

## [3.7.0] — 2026-05-29

### Added
- **Activity Bar panel**: Markr now appears in the VS Code / Cursor sidebar as a dedicated panel — no need to open a Markdown file first. The panel shows two sections: **AI Configs** (CLAUDE.md, .cursorrules, copilot-instructions.md, agent.md, etc.) and **Workspace** (all other `.md` files). Click any file to open it in Markr instantly
- **New AI Config wizard** (`+` button in panel): creates a starter file for CLAUDE.md, `.cursorrules`, `.github/copilot-instructions.md`, `agent.md`, `system-prompt.md`, or `.windsurfrules` — each with a high-quality template. Creates parent directories automatically (e.g. `.github/`). Handles existing files gracefully with a "file already exists — open it?" prompt
- **Smart `Cmd+Shift+M` without a file open**: invoking the command from any editor now shows a full workspace Quick Pick sorted AI configs first, instead of showing an error message
- **Refresh button** in the panel header for on-demand re-scan

---

## [3.6.3] — 2026-05-28

### Fixed
- **Edit area stale when switching AI config files**: switching from one `skill.md`/`agent.md` to another while in edit mode now correctly loads the new file's content into the editor (previously the textarea kept showing the previous file)

### Added
- **Format toolbar active state**: buttons now highlight when the cursor is inside the corresponding format — e.g. Bold lights up inside `**…**`, Italic inside `*…*`, H2 on an `## ` line, Blockquote on a `> ` line, etc.
- **Toggle formatting off**: clicking an already-active button removes the format — works for all inline markers (bold, italic, strikethrough, inline code) and all line-prefix formats (H1–H4, blockquote, bullet/numbered/task lists)
- **H4 heading button** added to the format toolbar
- **Indent / Outdent buttons** added to the format toolbar (also accessible via Tab / Shift+Tab on list lines)
- **Smart Tab / Shift+Tab**: pressing Tab on a list item indents the whole line by 2 spaces; Shift+Tab outdents — non-list lines still get the 2-space insert on Tab

---

## [3.6.2] — 2026-05-28

### Fixed
- LICENSE copyright corrected to Apptware Labs Pvt Ltd

---

## [3.6.1] — 2026-05-28

### Fixed
- **Mermaid expand modal — zoom in/out restored**: switched from CSS `%`-width approach to pixel-based SVG sizing (`naturalWidth × zoom`); zoom-out to 25% and zoom-in to 400% now both work correctly
- **Gantt chart centering**: Mermaid's Gantt SVGs often omit a `viewBox`; modal now injects one from the rendered dimensions so the diagram scales proportionally and appears centred
- **All diagram types centred in modal**: `.mermaid-modal-body` is now a flex container with `justify-content: center`

### Changed
- Extension display name: `Markr` → `Markr – Markdown Preview` (improves marketplace search ranking)
- Description updated to lead with "Markdown preview & viewer" for better keyword indexing
- Categories: added `Notebooks` alongside `Visualization` and `Other`
- Keywords expanded with multi-word phrases (`markdown preview`, `markdown viewer`, `md preview`, `github markdown`) and AI tool terms (`claude`, `copilot`, `cursor`, `agents`, `skills`, `llm`) while retaining all original tags (`notebook`, `reader`, `viewer`, `editor`, `markr`, etc.)
- Copyright and author name unified to **Apptware Labs Pvt Ltd** across all files

---

## [3.6.0] — 2026-05-26

### Added
- **Explicit save flow**: changes no longer auto-write to disk; an orange `● Save` button appears in the toolbar when there are unsaved changes; `Cmd/Ctrl+S` triggers the save
- **Custom undo/redo stack**: replaced the deprecated `document.execCommand('undo')` with a reliable 100-entry history stack; `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` now work correctly inside VS Code's webview
- **Diff chip**: after every undo/redo, a small chip in the toolbar shows what text was removed (red) and added (green)
- **Clipboard paste preview banner**: pasting markdown from clipboard shows an orange banner ("Clipboard preview — not saved to disk") with `Save as .md` and `Dismiss` actions; saving writes the file, reloads Markr as a real document, and keeps the panel open
- **Mermaid expand modal**: diagrams can be opened fullscreen with zoom in/out (`+`/`−`), reset, and Ctrl+scroll/pinch-to-zoom; modal is 96 vw × 92 vh

### Fixed
- **Focus mode sidebar bug**: clicking the sidebar icon while in focus mode now exits focus mode and restores the sidebar (previously did nothing)
- **Markr panel closing after Save dialog**: native OS file picker was shifting VS Code focus away from the webview; fixed with `panel.reveal()` after file save
- **Split preview scroll jumping**: `innerHTML` swap on each keystroke was resetting `scrollTop` to 0; now saves and restores scroll position across the swap
- **Scroll sync pane fighting**: replaced `requestAnimationFrame` debounce with a 50 ms timeout to prevent both panes triggering each other

### Changed
- Mermaid Gantt demo markdown: removed characters (`&`, `%`, em dash) that cause Mermaid's parser to silently produce blank diagrams

---

## [3.5.1] — 2026-05-10

### Fixed
- Mermaid expand modal now fills 96 vw × 92 vh (was too small)
- SVG scales to fit the modal correctly

---

## [3.4.0] — 2026-05-05

### Added
- **Paste Markdown to Preview**: new toolbar button and command lets you preview clipboard markdown without opening or creating a file; accessible via `Cmd/Ctrl+Shift+P` when no editor is focused

---

## [3.3.1] — 2026-04-28

### Changed
- Added marketplace screenshots to README and extension gallery

---

## [3.3.0] — 2026-04-25

### Changed
- Professional branding: publisher metadata, README, and repository links updated to Apptware Labs Pvt Ltd

---

## [3.2.0] — 2026-04-18

### Added
- Fast file switching between tabs without re-rendering from scratch
- Undo/redo buttons in the format toolbar
- Auto-save on debounce timer while editing

### Fixed
- Nested folder file tree now renders correctly in the sidebar

---

## [3.1.2] — 2026-04-12

### Added
- **Multi-tab navigation**: open multiple markdown files as tabs within a single Markr panel
- File navigation improvements — clicking a sidebar file no longer resets scroll position

### Fixed
- Theme-aware scrollbars visible in Notion and Markr Light themes
- Heading slug generation for `marked` v9

---

## [3.1.0] — 2026-04-08

### Added
- **Notion theme**: clean white, Notion-inspired colour palette
- **Linear theme**: cool dark purple/indigo palette inspired by Linear
- HTML export, PDF export (Chrome headless), and print support

---

## [3.0.0] — 2026-04-01

### Added
- **Markdown notebook UI**: full sidebar with workspace file browser, folder tree, and Table of Contents panel
- **Format toolbar**: bold, italic, strikethrough, code, headings, lists, tables, HR, blockquote, links, images
- **AI config editor mode**: `CLAUDE.md`, `copilot-instructions.md`, `.cursorrules`, and other AI doc files open directly in split-edit mode with a ✦ badge
- **GitHub Alerts**: `[!NOTE]`, `[!WARNING]`, `[!TIP]`, `[!IMPORTANT]`, `[!CAUTION]` callout blocks
- **Quick Open** (`Cmd/Ctrl+K`): fuzzy-search across all workspace markdown files
- **Keyboard shortcuts panel** (`?`)
- **Image paste**: paste an image in edit mode — saves as file and inserts the markdown reference
- **Frontmatter panel**: YAML front matter rendered as a styled metadata strip
- **Token count**: estimated token count in the toolbar for AI context planning
- **Scroll sync**: editor cursor position synced to preview scroll
- **Focus mode**: hides sidebar for distraction-free reading
- **Back-to-top button**

---

## [2.0.0] — 2026-03-15

### Added
- GitHub-style Markdown rendering (GFM, tables, task lists, syntax highlighting via highlight.js)
- Mermaid diagram support (flowchart, sequence, class, state, ER, Gantt, pie, mindmap, timeline, git graph)
- Light and Dark themes
- Split-edit mode (edit + live preview side by side)
- Table of Contents generation from headings
- Copy code button on code blocks
- Heading anchor links
- `Cmd/Ctrl+Shift+M` keyboard shortcut to open preview

---

*Built with ❤️ by [Apptware Labs Pvt Ltd](https://apptware.com)*
