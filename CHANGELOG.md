# Changelog

All notable changes to **Markr – Markdown Preview** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versions follow [Semantic Versioning](https://semver.org/).

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
