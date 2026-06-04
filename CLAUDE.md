# Markr — VS Code Extension

> You are working on **Markr**, a VS Code extension that provides GitHub-accurate Markdown preview and is the primary editor for AI config files (CLAUDE.md, .cursorrules, agent.md etc.). Read this file completely before writing any code.

---

## What Markr Is

Markr is a VS Code / Cursor extension. It renders `.md` files exactly as GitHub does and provides first-class support for AI agent configuration files. When an AI config file is opened anywhere in VS Code, Markr automatically becomes the editor — the text editor tab closes and Markr's split-edit view takes over.

**Current version:** 3.9.0  
**Publisher:** Apptware-Product-Lab  
**Marketplace:** https://marketplace.visualstudio.com/items?itemName=Apptware-Product-Lab.markr

---

## Architecture

| Layer | Technology | Notes |
|-------|-----------|-------|
| Extension host | TypeScript + esbuild | Bundled to `out/extension.js` |
| Webview UI | Vanilla JS in template literals | No framework — single SCRIPT const |
| Markdown rendering | marked v9 + marked-highlight | GitHub-accurate GFM |
| Syntax highlighting | highlight.js | 190+ languages |
| Diagram rendering | Mermaid v10 (CDN, ES module) | Loaded lazily on demand |
| File watching | Node.js `fs.watch` | Real-time agent-edit detection |

---

## Project Structure

```
src/
├── extension.ts      # Activation, commands, auto-open AI files
├── preview.ts        # WebviewPanel, all HTML/CSS/JS, fs.watch
└── markrExplorer.ts  # Activity Bar TreeDataProvider, folder tree

samples/              # Demo markdown files for testing / marketing
scripts/              # Build and utility scripts
images/               # Icons and screenshots
out/                  # Compiled output (gitignored)
```

---

## Key Commands

```bash
npm run build        # Development build (esbuild)
npm run watch        # Rebuild on file change
npm run package      # Package .vsix for marketplace upload
node scripts/make-icon.js   # Regenerate icon.png from icon.svg
```

---

## Critical Rules

### Never use backtick template literals inside SCRIPT
The entire webview JS lives inside a TypeScript backtick template literal (`const SCRIPT = \`...\``). Any JS inside SCRIPT that uses backtick strings will cause an esbuild parse error. Use string concatenation (`'...' + var + '...'`) inside SCRIPT instead.

### Webview Content Security Policy
All scripts in the webview must use the `scriptNonce`. External resources (Mermaid CDN) are whitelisted in `_buildPage`.

### Keep .vsix under 5 MB
GIF files are excluded from the package via `.vscodeignore` and loaded from GitHub raw URLs in the README. Never bundle large assets.

---

## AI Config Files Markr Handles

| File | Tool |
|------|------|
| `CLAUDE.md`, `claude.local.md` | Claude Code |
| `.cursorrules`, `cursor.md` | Cursor |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.windsurfrules`, `windsurf.md` | Windsurf |
| `agent.md`, `agents.md`, `skill.md` | Claude Agents |
| `system-prompt.md`, `prompt.md` | Generic AI prompts |

> [!IMPORTANT]
> When adding new AI config filenames, update **both** `AI_CONFIG_NAMES` in `src/markrExplorer.ts` AND the identical set in `src/preview.ts`. They are intentionally duplicated to avoid circular imports.
