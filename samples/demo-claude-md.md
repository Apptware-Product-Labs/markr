# Markr — AI Agent Workbench for VS Code

> **Vision:** Be the Postman for AI agents — the tool every AI developer has open while they build, test, and iterate on their agent stack. Not just a markdown preview, but a full workbench for writing, testing, and managing AI context.

---

## What Markr Is

Markr is a VS Code / Cursor extension. It starts as a GitHub-accurate Markdown preview and AI config file editor, and evolves into the essential AI development companion:

- **See** your CLAUDE.md, .cursorrules, agent.md rendered beautifully in split-edit mode
- **Watch** your files update in real-time as Claude Code or any AI agent edits them
- **Measure** exact token counts per model — Claude, GPT-4, GPT-4o, Llama 3, Gemini
- **Compose** your full context — see all AI configs in scope, combined token count
- **Test** — run your system prompt against real models without leaving VS Code

**Publisher:** Apptware Labs Pvt Ltd | **License:** All Rights Reserved (free for personal use)

---

## Architecture

```
src/
├── extension.ts        Entry point — activates commands, wires modules together
├── preview.ts          Main WebviewPanel — all HTML/CSS/JS for the editor UI
│                       (large by design: webview JS lives here as template literals)
├── markrExplorer.ts    Activity Bar TreeDataProvider — file tree + search
├── tokenEngine.ts      Token counting — model-aware, exact for GPT/Llama, est. for Claude
├── contextComposer.ts  Context Composer — discover all AI configs in scope, merge them
└── promptRunner.ts     Prompt Runner — SecretStorage keys, streaming API to Claude/GPT/Gemini
```

### Key design constraints

1. **Webview JS lives in SCRIPT template literal in preview.ts**
   All client-side JavaScript is inside `const SCRIPT = \`...\`` in preview.ts.
   **Do NOT use backtick template literals inside SCRIPT** — it breaks esbuild parsing.
   Use string concatenation: `'value: ' + variable + ' end'`

2. **Extension host ↔ Webview communication via postMessage only**
   Extension sends: `panel.webview.postMessage({ type: 'xxx', ...data })`
   Webview sends: `vsc.postMessage({ type: 'xxx', ...data })`

3. **API keys in SecretStorage only**
   Never store keys in settings.json, never in code, never in git.
   Use `context.secrets.store/get/delete` via the PromptRunner class.

4. **Token counting uses tokenEngine.ts**
   Import `countTokens`, `detectModel`, `fmtTokens` from `./tokenEngine`.
   Never use `chars / 4` directly — call the model-aware functions.

5. **Keep .vsix under 5 MB**
   GIF files → `.vscodeignore`, loaded from GitHub raw URLs in README.
   Dependencies must be lightweight (no WASM bundles).

---

## Adding a New Feature

### If it's UI-only (new button, panel, etc.):
1. Add CSS to the `CSS` constant in preview.ts
2. Add HTML to the `_buildPage()` return value
3. Add JS event handlers to the `SCRIPT` constant
4. If the feature needs extension-side data: add a postMessage handler

### If it needs extension logic (file I/O, API calls, etc.):
1. Create a new `src/featureName.ts` module
2. Export the class/functions
3. Import and instantiate in `extension.ts`
4. Wire up commands/webview messages

### If it adds a new AI model:
1. Add the model to `AiModel` type in `tokenEngine.ts`
2. Add detection logic to `detectModel()`
3. Add display label to `modelLabel()`
4. Add token counting logic to `countTokens()`
5. Add context window size to `CONTEXT_WINDOWS` in `contextComposer.ts`
6. Add model to `MODELS` array in `promptRunner.ts`

---

## Current Features

| Feature | Status | File |
|---------|--------|------|
| Markdown preview (GitHub-accurate) | ✅ | preview.ts |
| Split edit mode | ✅ | preview.ts |
| AI config auto-detection | ✅ | preview.ts, markrExplorer.ts |
| Activity Bar panel + folder tree | ✅ | markrExplorer.ts |
| Agent Watch (fs.watch live reload) | ✅ | preview.ts |
| Token counter (model-aware) | ✅ | tokenEngine.ts |
| Token section breakdown panel | ✅ | preview.ts |
| Mermaid diagrams + copy as PNG | ✅ | preview.ts |
| Copy table as rich HTML / PNG | ✅ | preview.ts |
| Rich copy (Cmd+C) to Slack/Docs | ✅ | preview.ts |
| Paste & Preview clipboard panel | ✅ | preview.ts |
| File search in sidebar | ✅ | preview.ts |
| Context Composer | 🔨 | contextComposer.ts |
| Prompt Runner | 🔨 | promptRunner.ts |
| MCP config editor | 📋 planned | — |
| Prompt history | 📋 planned | — |

---

## Commands

```bash
npm run build        # Development build (esbuild, fast)
npm run watch        # Watch mode — rebuilds on save
npm run package      # Package .vsix for marketplace upload
node scripts/make-icon.js   # Regenerate icon.png from icon.svg
bash scripts/demo-agent-edit.sh  # Simulate agent editing CLAUDE.md (for GIF recording)
```

---

## Important Rules

- Never query `hq_*` tables — those belong to BenchMark HQ (different product)
- Never commit API keys — they live in SecretStorage
- Keep CLAUDE.md under 4,000 tokens — the token counter in Markr's toolbar shows exactly
- When adding AI config filenames: update **both** `AI_CONFIG_NAMES` in markrExplorer.ts AND preview.ts

---

> [!NOTE]
> This CLAUDE.md is also a demo file for Markr's agent watch and token counting features. Open it in Markr to see the token section breakdown — click the token count in the toolbar.
