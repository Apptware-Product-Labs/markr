<div align="center">

# Markr

Fast, polished Markdown preview for VS Code.

GitHub-style rendering, workspace navigation, AI docs support, live table of contents, Mermaid diagrams, split editing, themes, and clean export tools in one focused preview.

[![Version](https://img.shields.io/visual-studio-marketplace/v/Apptware-Product-Lab.markr?color=F97316&label=version&style=flat-square)](https://marketplace.visualstudio.com/items?itemName=Apptware-Product-Lab.markr)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/Apptware-Product-Lab.markr?color=EF4444&style=flat-square)](https://marketplace.visualstudio.com/items?itemName=Apptware-Product-Lab.markr)
[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg?style=flat-square)](LICENSE)

</div>

---

## Why Markr

The built-in Markdown preview is useful, but it is intentionally minimal. Markr is built for people who spend real time in Markdown: documentation, specs, README files, notes, AI instructions, changelogs, and long-form project files.

Open any `.md` file and run **Markr: Open Markr Preview** or press:

| Platform | Shortcut |
|---|---|
| macOS | `Cmd+Shift+M` |
| Windows / Linux | `Ctrl+Shift+M` |

---

## Highlights

| Area | What Markr Adds |
|---|---|
| Reading | Clean typography, focus mode, back-to-top, reading time, word count |
| Navigation | Collapsible workspace folders, live table of contents, scroll spy, heading links |
| AI Markdown | First-class handling for `AGENTS.md`, `SKILL.md`, prompts, rules, and context files |
| Editing | Resizable split edit mode, formatting toolbar, autosave, image paste support |
| Rendering | GitHub-style Markdown, syntax highlighting, alerts, Mermaid diagrams |
| Export | Copy Markdown, copy HTML, export HTML, print, export PDF |
| Themes | Markr Light, Markr Dark, Notion, Linear |

---

## Workspace Navigation

Markr includes a file panel for Markdown-heavy projects. It indexes workspace `.md` files, groups them by folder, lets folders collapse, highlights AI configuration files, and lets you switch between files without leaving the preview.

The file list loads asynchronously so the preview can appear quickly even in projects with many Markdown files. You can control the list size with `markr.maxWorkspaceFiles`.

---

## AI Markdown Files

Modern development projects often contain Markdown files that define agent behavior, coding rules, prompts, skills, memory, and context. Markr detects and highlights common AI docs, including:

- `AGENTS.md`
- `SKILL.md` and `skills.md`
- `CLAUDE.md`, `codex.md`, `gemini.md`, and Copilot instruction files
- Cursor, Windsurf, Aider, prompt, rule, memory, and context Markdown files

AI docs open directly into split edit mode, show a clear type badge, and stay grouped at the top of the file panel. The split can be resized, and switching to preview is remembered for that file during the session. Use the **Source** toolbar action to jump from Markr into the normal VS Code Markdown editor whenever you want the full editor experience.

---

## Markdown Rendering

Markr supports the Markdown features expected in modern documentation:

- Headings, lists, tables, blockquotes, links, images, and inline code
- Fenced code blocks with syntax highlighting
- GitHub-style task lists
- GitHub alerts: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION`
- Mermaid diagrams through fenced `mermaid` blocks
- Frontmatter display for Markdown files that use metadata

---

## Editing Tools

Use split edit mode when you want to make quick changes without leaving the preview. The formatting toolbar supports common Markdown actions such as bold, italic, headings, links, images, lists, code, quotes, and horizontal rules.

Changes are saved back to the active Markdown file.

---

## Export Tools

Markr includes practical export actions directly in the toolbar:

| Action | Use |
|---|---|
| Source | Open the current file in the VS Code Markdown editor |
| Copy Markdown | Copy the source Markdown |
| Copy HTML | Copy the rendered HTML |
| Export HTML | Save a standalone HTML file |
| Print | Open a print-ready view |
| Export PDF | Generate a PDF using Chrome or Edge |

---

## Settings

| Setting | Default | Description |
|---|---:|---|
| `markr.scrollSync` | `true` | Sync the preview to the editor cursor |
| `markr.showTOC` | `true` | Show the table of contents when preview opens |
| `markr.maxWorkspaceFiles` | `500` | Maximum Markdown files shown in the workspace file panel |

---

## Requirements

- VS Code `1.80.0` or newer
- Internet access for Mermaid rendering from jsDelivr
- Chrome, Edge, or Chromium for direct PDF export

All non-Mermaid preview features work offline.

---

## Feedback

Report issues or request features on GitHub:

https://github.com/Apptware-Product-Labs/markr/issues

---

Built by Apptware Product Lab. Licensed under MIT.
