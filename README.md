<div align="center">

<img src="icon.png" alt="Markr" width="80" />

# Markr

### The Markdown preview VS Code deserves.

**GitHub-accurate rendering · Live TOC · Syntax highlighting · Mermaid · Multi-tab · Themes · Export**

<br/>

[![Version](https://img.shields.io/visual-studio-marketplace/v/Apptware-Product-Lab.markr?color=F97316&label=VS%20Code&style=flat-square)](https://marketplace.visualstudio.com/items?itemName=Apptware-Product-Lab.markr)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/Apptware-Product-Lab.markr?color=EF4444&label=installs&style=flat-square)](https://marketplace.visualstudio.com/items?itemName=Apptware-Product-Lab.markr)
[![Open VSX](https://img.shields.io/open-vsx/dt/Apptware-Product-Lab/markr?color=F97316&label=Open%20VSX&style=flat-square)](https://open-vsx.org/extension/Apptware-Product-Lab/markr)
[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg?style=flat-square)](LICENSE)
[![Made by Apptware Labs](https://img.shields.io/badge/made%20by-Apptware%20Labs-F97316?style=flat-square)](https://apptware.com)

<br/>

[**Install on VS Code**](https://marketplace.visualstudio.com/items?itemName=Apptware-Product-Lab.markr) · [**Install on Cursor / Open VSX**](https://open-vsx.org/extension/Apptware-Product-Lab/markr) · [**Report a Bug**](https://github.com/Apptware-Product-Labs/markr/issues) · [**Request a Feature**](https://github.com/Apptware-Product-Labs/markr/issues/new)

</div>

---

## What is Markr?

Markr is a free, open-source Markdown preview extension for VS Code and Cursor. It renders your `.md` files exactly as GitHub does — clean typography, accurate colors, beautiful tables — with a full suite of power features built in.

Whether you're writing documentation, maintaining a README, managing AI agent configs, or working in a large Markdown-heavy repo, Markr gives you a significantly better experience than the built-in preview. No configuration. No fuss.

**Open any `.md` file. Press `Cmd+Shift+M`. That's it.**

---

## Why Markr?

| | Built-in VS Code Preview | Markr |
|---|:---:|:---:|
| GitHub-accurate styling | Partial | ✅ Pixel-perfect |
| Live Table of Contents | ✗ | ✅ Collapsible, scroll spy |
| Multi-tab navigation | ✗ | ✅ Open multiple files |
| Workspace file browser | ✗ | ✅ Grouped by folder |
| Mermaid diagrams | ✗ | ✅ Flowcharts, Gantt & more |
| Syntax highlighting | Basic | ✅ 190+ languages |
| Copy code buttons | ✗ | ✅ Hover to reveal |
| Heading anchor links | ✗ | ✅ Click to copy |
| Word count + reading time | ✗ | ✅ Always visible |
| Export to HTML / PDF | ✗ | ✅ One click |
| Themes | VS Code only | ✅ Light, Dark, Notion, Linear |
| Focus / reading mode | ✗ | ✅ Distraction-free |
| Split edit mode | ✗ | ✅ Preview + editor side by side |
| AI config file support | ✗ | ✅ AGENTS.md, CLAUDE.md & more |

---

## Features

### 📄 GitHub-Style Rendering
Headings, tables, blockquotes, task lists, strikethrough, footnotes, inline code, fenced code blocks — all rendered exactly as GitHub does. Automatically switches between light and dark with your VS Code theme.

### 📑 Live Table of Contents
Auto-generated from your headings the moment you open the file. Scroll spy highlights the active section in real time. Click any item to jump there. Collapse it with one button.

### 🗂 Workspace File Browser
Browse and switch between all `.md` files in your workspace without leaving the preview. Files are grouped by folder, AI config files are pinned at the top, and the browser handles large repos (500+ files) without blocking.

### 📂 Multi-Tab Navigation
Open multiple Markdown files in tabs — just like your editor. Switching between previously-opened files is instant with no round-trip to the extension host.

### 🎨 Syntax Highlighting — 190+ Languages
TypeScript, Python, Go, Rust, Java, SQL, YAML, Bash, Dockerfile — every language highlighted with GitHub's exact color tokens, in both light and dark themes.

### 🔀 Mermaid Diagrams
Drop a `mermaid` block in your Markdown and Markr renders it live. Flowcharts, sequence diagrams, Gantt charts, class diagrams, and pie charts — all supported.

### ✦ AI Config File Support
Markr detects and highlights AI documentation files — `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, Cursor rules, Copilot instructions, and more. They open directly into split edit mode so you can read and edit simultaneously.

### ⚡ Scroll Sync
Move your cursor in the editor — the preview scrolls to match. Always in context, never lost.

### 🛠 Toolbar

```
◈ Markr  ·  filename.md      3 min read · 580 words    [Source] [MD] [HTML] [Print] [PDF] [≡] [⊡]
```

| Button | What it does |
|--------|--------------|
| `Source` | Jump to VS Code's built-in editor for this file |
| `MD` | Copy raw Markdown to clipboard |
| `HTML` | Copy rendered HTML to clipboard |
| `Print` | Print-ready layout |
| `PDF` | Export as PDF using Chrome/Edge |
| `≡` | Toggle TOC sidebar |
| `⊡` | Focus / reading mode |

### 🎯 Focus Mode
One click hides the sidebar, widens content to 720 px, bumps the font size. Pure reading flow.

### 🎨 Themes
Switch between four themes from the toolbar — **Markr Light**, **Markr Dark**, **Notion White**, **Linear Dark**. Your choice is remembered across sessions.

---

## Getting Started

**VS Code**
1. Open the Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Search for **Markr**
3. Click **Install**

**Cursor / VSCodium / Open VSX**
Same search — pulls from [Open VSX Registry](https://open-vsx.org/extension/Apptware-Product-Lab/markr).

**First use**
Open any `.md` file → press `Cmd+Shift+M` (macOS) or `Ctrl+Shift+M` (Windows/Linux).

---

## Keyboard Shortcuts

| Action | Mac | Windows / Linux |
|--------|-----|-----------------|
| Open Markr Preview | `Cmd+Shift+M` | `Ctrl+Shift+M` |

Also available via:
- The **preview icon** in the editor title bar when a `.md` file is open
- Right-click any `.md` file in Explorer → **Open Markr Preview**
- The Command Palette → **Markr: Open Markr Preview**

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `markr.scrollSync` | `true` | Sync preview scroll with editor cursor |
| `markr.showTOC` | `true` | Show TOC sidebar when preview opens |
| `markr.maxWorkspaceFiles` | `500` | Max `.md` files shown in the workspace browser |

---

## Requirements

- VS Code `1.80.0` or higher
- Internet connection for Mermaid rendering *(all other features work fully offline)*
- Chrome, Edge, or Chromium for direct PDF export *(falls back to browser print otherwise)*

---

## Contributing

Markr is open source and contributions are welcome.

```bash
git clone https://github.com/Apptware-Product-Labs/markr.git
cd markr
npm install
npm run build     # development build
npm run watch     # rebuild on change
npm run package   # package .vsix
```

1. Fork the repo and create a branch: `git checkout -b feat/your-feature`
2. Make your changes and run `npm run build` to verify
3. Open a pull request with a clear description of what you changed and why

For bugs or feature requests → [open an issue](https://github.com/Apptware-Product-Labs/markr/issues).

---

## Roadmap

- [ ] Custom theme editor
- [ ] Table of Contents depth control
- [ ] Markdown linting indicators
- [ ] Image optimisation on paste

---

## License

MIT — free for personal and commercial use. See [LICENSE](LICENSE).

---

<div align="center">

Built with ❤️ by **[Apptware Labs Pvt Ltd](https://apptware.com)**

*Apptware Labs is a product studio building developer tools and enterprise software — open source and commercial.*

<br/>

**Our Products**

[Markr](https://marketplace.visualstudio.com/items?itemName=Apptware-Product-Lab.markr) &nbsp;·&nbsp; Syncrra &nbsp;·&nbsp; BenchMark &nbsp;·&nbsp; HireFlow

<br/>

[🌐 apptware.com](https://apptware.com) &nbsp;·&nbsp; [GitHub](https://github.com/Apptware-Product-Labs) &nbsp;·&nbsp; [LinkedIn](https://www.linkedin.com/company/apptware)

</div>
