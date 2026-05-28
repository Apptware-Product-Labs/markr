# Changelog

All notable changes to **Markr – Markdown Preview** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versions follow [Semantic Versioning](https://semver.org/).

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
