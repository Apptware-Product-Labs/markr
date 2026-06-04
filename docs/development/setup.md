# Development Setup

## Prerequisites

- Node.js 18+
- VS Code 1.80+
- Git

## Getting Started

```bash
git clone https://github.com/Apptware-Product-Labs/markr.git
cd markr
npm install
npm run build
```

Open the folder in VS Code. Press `F5` to launch the Extension Development Host.

## Build Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | One-time development build |
| `npm run watch` | Rebuild on every file save |
| `npm run package` | Package `.vsix` for upload |
| `node scripts/make-icon.js` | Regenerate `icon.png` from `icon.svg` |

## Project Layout

```
src/
  extension.ts       Main entry point
  preview.ts         Webview panel (2000+ lines)
  markrExplorer.ts   Activity Bar tree provider

out/
  extension.js       Compiled bundle (gitignored)

samples/
  demo-claude-md.md
  demo-copy-features.md
  demo-ai-workflow.md
  markr-showcase.md
```

## Coding Conventions

- All webview JavaScript lives inside the `SCRIPT` template literal in `preview.ts`
- **No backtick template literals inside SCRIPT** — use string concatenation
- CSS variables (`--bg`, `--text`, `--accent`, etc.) are defined per theme in `_buildPage()`
- New AI config filenames go in **both** `AI_CONFIG_NAMES` sets (markrExplorer.ts + preview.ts)
