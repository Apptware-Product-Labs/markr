import * as vscode from 'vscode';
import { marked, Renderer } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileEntry {
  label: string;
  relPath: string;
  uri: string;
  active: boolean;
  dir: string;
}

// ─── Marked setup ────────────────────────────────────────────────────────────

marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  })
);

const renderer = new Renderer();
renderer.heading = function ({ text, depth }) {
  const id = slugify(text);
  return `<h${depth} id="${id}">${text}<a class="h-anchor" href="#${id}" title="Copy link">#</a></h${depth}>\n`;
};
marked.use({ gfm: true, breaks: false, renderer });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function wordCount(text: string): number {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/^\s*#{1,6}\s/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~>|\\]/g, ' ')
    .split(/\s+/)
    .filter(w => w.trim().length > 0).length;
}

function readingTime(words: number): string {
  return `${Math.max(1, Math.ceil(words / 200))} min`;
}

function docStats(text: string) {
  const words = wordCount(text);
  const headings = (text.match(/^#{1,6}\s/gm) ?? []).length;
  const codeBlocks = Math.floor(((text.match(/^```/gm) ?? []).length) / 2);
  return { words, headings, codeBlocks };
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function nearestHeading(text: string, line: number): string | null {
  const lines = text.split('\n');
  for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
    const m = lines[i].match(/^#{1,6}\s+(.+)/);
    if (m) return slugify(m[1]);
  }
  return null;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const CSS = /* css */`
/* === Tokens (Light) ========================================================*/
[data-m="light"] {
  --accent:       #F97316;
  --accent-dim:   #C2570A;
  --accent-bg:    rgba(249,115,22,0.08);
  --text:         #1c1a17;
  --text-2:       #4a4540;
  --text-muted:   #888178;
  --text-faint:   #c5bfb7;
  --bg:           #faf9f7;
  --bg-panel:     #f3f0eb;
  --bg-hover:     #eceae4;
  --bg-subtle:    #f3f0eb;
  --border:       #e5e0d8;
  --border-faint: #ede9e2;
  --code-bg:      #ede9e2;
  --quote-brd:    #d7d2c8;
  --link:         #0b6e99;
  --link-hv:      #0550ae;
  --success:      #0f7b6c;
  --fg:           #1c1a17;
  --fg-muted:     #888178;
  --code-inline:  rgba(110,104,96,0.13);
  --code-block:   #ede9e2;
  --hr:           #e5e0d8;
  --table-alt:    #f3f0eb;
  --brd-muted:    #e5e0d8;
  --hl:           #1c1a17;
  --hl-kw:        #d73a49;
  --hl-fn:        #6f42c1;
  --hl-lit:       #005cc5;
  --hl-str:       #032f62;
  --hl-bi:        #e36209;
  --hl-cm:        #888178;
  --hl-tag:       #22863a;
  --hl-add-bg:    #f0fff4;
  --hl-del-bg:    #ffeef0;
  --hl-add-fg:    #22863a;
  --hl-del-fg:    #b31d28;
}

/* === Tokens (Dark) =========================================================*/
[data-m="dark"] {
  --accent:       #FB923C;
  --accent-dim:   #EA7E28;
  --accent-bg:    rgba(251,146,60,0.1);
  --text:         #e8e3dc;
  --text-2:       #b5afa8;
  --text-muted:   #7e7970;
  --text-faint:   #48443e;
  --bg:           #141210;
  --bg-panel:     #1b1916;
  --bg-hover:     #242019;
  --bg-subtle:    #1e1c19;
  --border:       #2e2a26;
  --border-faint: #232018;
  --code-bg:      #1e1c18;
  --quote-brd:    #3b3630;
  --link:         #61afef;
  --link-hv:      #7ec8e3;
  --success:      #4dac97;
  --fg:           #e8e3dc;
  --fg-muted:     #7e7970;
  --code-inline:  rgba(140,134,124,0.18);
  --code-block:   #1e1c18;
  --hr:           #2e2a26;
  --table-alt:    #1e1c18;
  --brd-muted:    #2e2a26;
  --hl:           #e8e3dc;
  --hl-kw:        #ff7b72;
  --hl-fn:        #d2a8ff;
  --hl-lit:       #79c0ff;
  --hl-str:       #a5d6ff;
  --hl-bi:        #ffa657;
  --hl-cm:        #7e7970;
  --hl-tag:       #7ee787;
  --hl-add-bg:    rgba(46,160,67,0.15);
  --hl-del-bg:    rgba(248,81,73,0.15);
  --hl-add-fg:    #aff5b4;
  --hl-del-fg:    #ffdcd7;
}

/* === Reset =================================================================*/
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}

/* === Main Toolbar ==========================================================*/
#toolbar {
  position: fixed;
  inset: 0 0 auto 0;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  background: var(--vscode-editor-background, var(--bg));
  border-bottom: 1px solid var(--border);
  z-index: 300;
  gap: 4px;
  user-select: none;
}
.tl { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; overflow: hidden; }
.tr { display: flex; align-items: center; gap: 1px; flex-shrink: 0; }

.logo-mark {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: -0.3px;
  white-space: nowrap;
  background: linear-gradient(120deg, #F97316 0%, #EF4444 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  flex-shrink: 0;
}
.logo-mark svg { flex-shrink: 0; filter: none; -webkit-text-fill-color: initial; }

.sep-dot { color: var(--border); font-size: 16px; flex-shrink: 0; line-height: 1; }
.fname {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 11.5px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.edit-dot {
  font-size: 8px;
  color: var(--accent);
  opacity: 0;
  transition: opacity 0.2s;
  line-height: 1;
  flex-shrink: 0;
}
body.edit-mode .edit-dot { opacity: 1; }

.stats {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  padding: 0 4px;
  cursor: default;
}
.sep-v { width: 1px; height: 16px; background: var(--border); margin: 0 3px; flex-shrink: 0; }

.tb-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border: none;
  border-radius: 4px;
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  color: var(--vscode-foreground, var(--text));
  background: transparent;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
  line-height: 1;
  height: 26px;
  flex-shrink: 0;
}
.tb-btn:hover { background: var(--vscode-toolbar-hoverBackground, var(--bg-hover)); }
.tb-btn.on {
  background: var(--accent-bg);
  color: var(--accent);
}
.tb-btn.accent {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.tb-btn.accent:hover { background: var(--accent-dim); }
.tb-btn svg { flex-shrink: 0; }

/* === Format Toolbar (Edit mode) ============================================*/
#fmt-toolbar {
  position: fixed;
  inset: 42px 0 auto 0;
  height: 36px;
  display: none;
  align-items: center;
  padding: 0 8px;
  gap: 1px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  z-index: 290;
  overflow-x: auto;
  overflow-y: hidden;
}
body.edit-mode #fmt-toolbar { display: flex; }

.fmt-group { display: flex; align-items: center; gap: 1px; }
.fmt-sep { width: 1px; height: 18px; background: var(--border); margin: 0 4px; flex-shrink: 0; }

.fmt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 26px;
  padding: 0 5px;
  border: none;
  border-radius: 4px;
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  color: var(--text-muted);
  background: transparent;
  transition: background 0.1s, color 0.1s;
  white-space: nowrap;
  flex-shrink: 0;
}
.fmt-btn:hover { background: var(--bg-hover); color: var(--text); }
.fmt-btn b { font-weight: 800; font-size: 13px; }
.fmt-btn i { font-style: italic; font-size: 13px; }
.fmt-btn s { font-size: 12px; }
.fmt-btn.h-btn { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; letter-spacing: -0.5px; }
.fmt-btn svg { flex-shrink: 0; }

/* === Outer layout ==========================================================*/
#outer-layout {
  display: flex;
  margin-top: 42px;
  height: calc(100vh - 42px);
  overflow: hidden;
}
body.edit-mode #outer-layout {
  margin-top: 78px;
  height: calc(100vh - 78px);
}

/* === Sidebar ===============================================================*/
#sidebar {
  width: 240px;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  overflow: hidden;
  transition: width 0.2s ease, min-width 0.2s ease, opacity 0.2s ease;
  flex-shrink: 0;
}
#sidebar.hidden {
  width: 0; min-width: 0; opacity: 0; overflow: hidden;
}

.sb-section {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border);
  min-height: 0;
}
.sb-section.flex-fill { flex: 1; overflow: hidden; }

.sb-header {
  display: flex;
  align-items: center;
  padding: 0 10px 0 12px;
  height: 32px;
  gap: 4px;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
}
.sb-header:hover { background: var(--bg-hover); }
.sb-title {
  flex: 1;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  white-space: nowrap;
}
.sb-action {
  width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 3px;
  font-size: 16px; line-height: 1;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}
.sb-action:hover { background: var(--bg-hover); color: var(--accent); }
.sb-chevron {
  width: 16px; height: 16px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint);
  transition: transform 0.15s;
  flex-shrink: 0;
}
.sb-section.collapsed .sb-chevron { transform: rotate(-90deg); }

.sb-body {
  overflow-y: auto;
  overflow-x: hidden;
  padding: 2px 0 8px;
}
.sb-section.collapsed .sb-body { display: none; }

/* File items */
.file-dir {
  padding: 8px 12px 2px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-item {
  display: flex;
  align-items: center;
  padding: 4px 10px 4px 12px;
  gap: 6px;
  font-size: 12px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  color: var(--text-muted);
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
}
.file-item:hover { background: var(--bg-hover); color: var(--text); }
.file-item.active {
  color: var(--accent);
  border-left-color: var(--accent);
  background: var(--accent-bg);
}
.file-item svg { flex-shrink: 0; opacity: 0.5; }
.file-item.active svg { opacity: 1; }
.file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* TOC inside sidebar */
.toc-item { list-style: none; margin: 0; padding: 0; }
.toc-item a {
  display: block;
  padding: 3px 12px 3px 10px;
  color: var(--text-muted);
  text-decoration: none;
  border-left: 2px solid transparent;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.1s, background 0.1s, border-color 0.1s;
  line-height: 1.5;
  font-size: 12.5px;
}
.toc-item a:hover { color: var(--text); background: var(--bg-hover); }
.toc-item a.active { color: var(--accent); border-left-color: var(--accent); background: var(--accent-bg); }
.toc-item.h1 a { padding-left: 10px; font-weight: 600; font-size: 12.5px; }
.toc-item.h2 a { padding-left: 18px; }
.toc-item.h3 a { padding-left: 28px; font-size: 12px; }
.toc-item.h4 a { padding-left: 36px; font-size: 11.5px; }
.toc-item.h5 a, .toc-item.h6 a { padding-left: 44px; font-size: 11px; }

/* === Main column ===========================================================*/
#main-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* === Content area ==========================================================*/
#main {
  flex: 1;
  display: flex;
  overflow: hidden;
}
#scroller { flex: 1; overflow-y: auto; overflow-x: hidden; }

/* === Edit area =============================================================*/
#edit-area, #split-preview { display: none; }

body.edit-mode #scroller { display: none; }
body.edit-mode #edit-area {
  display: block;
  flex: 1;
  padding: 28px 32px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--text);
  background: var(--bg);
  border: none;
  border-right: 1px solid var(--border);
  outline: none;
  resize: none;
  overflow-y: auto;
  tab-size: 2;
  caret-color: var(--accent);
}
body.edit-mode #split-preview {
  display: block;
  flex: 1;
  overflow-y: auto;
}

/* === Markdown body =========================================================*/
.markdown-body {
  max-width: 780px;
  margin: 0 auto;
  padding: 32px 36px 100px;
  word-wrap: break-word;
}

/* Headings */
.markdown-body h1,.markdown-body h2,.markdown-body h3,
.markdown-body h4,.markdown-body h5,.markdown-body h6 {
  margin-top: 1.5em; margin-bottom: .4em;
  font-weight: 700; line-height: 1.25; color: var(--text);
  position: relative;
}
.markdown-body h1:first-child,.markdown-body h2:first-child,.markdown-body h3:first-child { margin-top: 0; }
.markdown-body h1 { font-size: 2em; }
.markdown-body h2 {
  font-size: 1.5em;
  padding-bottom: .35em;
  border-bottom: 1px solid var(--border);
}
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1em; }
.markdown-body h5 { font-size: .875em; }
.markdown-body h6 { font-size: .85em; color: var(--text-muted); }

/* Heading anchor */
.h-anchor {
  opacity: 0;
  font-size: .65em;
  font-weight: 400;
  margin-left: 8px;
  color: var(--text-faint);
  text-decoration: none;
  transition: opacity 0.15s, color 0.15s;
  vertical-align: middle;
}
h1:hover .h-anchor,h2:hover .h-anchor,h3:hover .h-anchor,
h4:hover .h-anchor,h5:hover .h-anchor,h6:hover .h-anchor { opacity: 1; }
.h-anchor:hover { color: var(--accent); }

/* Body text */
.markdown-body p { margin-top: 0; margin-bottom: 16px; line-height: 1.75; }
.markdown-body strong { font-weight: 600; }
.markdown-body em { font-style: italic; }
.markdown-body del { text-decoration: line-through; color: var(--text-muted); }

/* Links */
.markdown-body a { color: var(--link); text-decoration: none; }
.markdown-body a:hover { color: var(--link-hv); text-decoration: underline; }

/* Inline code */
.markdown-body code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 85%;
  padding: .2em .4em;
  background: var(--code-inline);
  border-radius: 4px;
}

/* Code blocks */
.markdown-body pre {
  position: relative;
  margin: 0 0 16px;
  padding: 16px;
  overflow: auto;
  font-size: 84%;
  line-height: 1.65;
  background: var(--code-bg);
  border-radius: 8px;
  border: 1px solid var(--border);
}
.markdown-body pre code {
  padding: 0; margin: 0; background: transparent; border-radius: 0;
  font-size: 100%; white-space: pre; word-break: normal; overflow-wrap: normal; color: inherit;
}

/* Copy button */
.copy-btn {
  position: absolute; top: 7px; right: 7px;
  padding: 3px 6px;
  font-size: 11px; font-family: inherit;
  border: none; border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
  display: flex; align-items: center; gap: 3px;
  line-height: 1.5;
}
pre:hover .copy-btn { opacity: 1; }
.copy-btn:hover { color: var(--text); background: var(--bg-hover); }
.copy-btn.done { color: var(--success); opacity: 1; }

/* Blockquote */
.markdown-body blockquote {
  margin: 0 0 16px; padding: 0 1em;
  color: var(--text-muted);
  border-left: 3px solid var(--accent);
  background: var(--accent-bg);
  border-radius: 0 6px 6px 0;
  padding: 10px 16px;
}
.markdown-body blockquote > :first-child { margin-top: 0; }
.markdown-body blockquote > :last-child { margin-bottom: 0; }

/* Lists */
.markdown-body ul,.markdown-body ol { margin-top: 0; margin-bottom: 16px; padding-left: 2em; }
.markdown-body ul ul,.markdown-body ul ol,.markdown-body ol ul,.markdown-body ol ol { margin: 0; }
.markdown-body li { word-wrap: break-all; }
.markdown-body li + li { margin-top: .25em; }
.markdown-body li > p { margin-top: 16px; }
.markdown-body .task-list-item { list-style-type: none; }
.markdown-body .task-list-item input[type="checkbox"] {
  margin: 0 .5em 0 -1.6em; vertical-align: middle; accent-color: var(--accent);
}

/* Images */
.markdown-body img { max-width: 100%; border-style: none; border-radius: 6px; }

/* HR */
.markdown-body hr { height: 1px; padding: 0; margin: 24px 0; background: var(--border); border: 0; }

/* Tables */
.markdown-body table {
  border-spacing: 0; border-collapse: collapse;
  display: block; width: max-content; max-width: 100%;
  overflow: auto; margin-bottom: 16px;
  border-radius: 6px; border: 1px solid var(--border);
}
.markdown-body table th {
  font-weight: 600; padding: 8px 14px;
  border-bottom: 2px solid var(--border);
  text-align: left; background: var(--bg-subtle);
}
.markdown-body table td { padding: 7px 14px; border-bottom: 1px solid var(--border-faint); }
.markdown-body table tr:last-child td { border-bottom: none; }
.markdown-body table tr:nth-child(2n) td { background: var(--bg-subtle); }

/* Keyboard */
.markdown-body kbd {
  display: inline-block; padding: 3px 5px;
  font-family: ui-monospace, monospace; font-size: 11px; line-height: 10px;
  color: var(--text); vertical-align: middle;
  background: var(--bg-subtle); border: 1px solid var(--border); border-radius: 4px;
  box-shadow: inset 0 -1px 0 var(--border);
}

/* Details */
.markdown-body details { display: block; margin-bottom: 16px; }
.markdown-body details summary { display: list-item; cursor: pointer; font-weight: 600; }

/* Callout-style bold intro paragraph */
.markdown-body p strong:first-child:last-child { color: var(--text); }

/* Mermaid */
.mermaid-wrap { margin-bottom: 16px; }
.mermaid { text-align: center; overflow-x: auto; }
.mermaid-error {
  padding: 12px 16px; border-radius: 6px;
  background: var(--code-bg); border: 1px solid var(--border);
  color: var(--text-muted); font-size: 13px; font-style: italic;
}

/* === Highlight.js ==========================================================*/
.hljs                              { color: var(--hl); background: transparent; }
.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,
.hljs-template-tag,.hljs-template-variable,
.hljs-type,.hljs-variable.language_ { color: var(--hl-kw); }
.hljs-title,.hljs-title.class_,
.hljs-title.class_.inherited__,
.hljs-title.function_              { color: var(--hl-fn); }
.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,
.hljs-number,.hljs-operator,.hljs-variable,
.hljs-selector-attr,.hljs-selector-class,
.hljs-selector-id                  { color: var(--hl-lit); }
.hljs-regexp,.hljs-string,.hljs-meta .hljs-string { color: var(--hl-str); }
.hljs-built_in,.hljs-symbol        { color: var(--hl-bi); }
.hljs-comment,.hljs-code,.hljs-formula { color: var(--hl-cm); font-style: italic; }
.hljs-name,.hljs-quote,.hljs-selector-tag,
.hljs-selector-pseudo              { color: var(--hl-tag); }
.hljs-subst                        { color: var(--hl); }
.hljs-section                      { color: var(--hl-lit); font-weight: bold; }
.hljs-bullet                       { color: var(--hl-bi); }
.hljs-emphasis                     { font-style: italic; }
.hljs-strong                       { font-weight: bold; }
.hljs-addition { color: var(--hl-add-fg); background: var(--hl-add-bg); }
.hljs-deletion { color: var(--hl-del-fg); background: var(--hl-del-bg); }

/* === Back to top ===========================================================*/
#top-btn {
  position: fixed; bottom: 24px; right: 20px;
  width: 34px; height: 34px;
  border-radius: 50%; border: 1px solid var(--border);
  background: var(--bg); color: var(--text-muted);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transform: translateY(10px);
  transition: opacity 0.2s, transform 0.2s, background 0.15s;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}
#top-btn.show { opacity: 1; transform: translateY(0); }
#top-btn:hover { background: var(--accent-bg); color: var(--accent); border-color: var(--accent); }

/* === Focus mode ============================================================*/
body.focus-mode #sidebar { width: 0; min-width: 0; opacity: 0; overflow: hidden; }
body.focus-mode .markdown-body { max-width: 720px; font-size: 16.5px; line-height: 1.85; }

/* === Scrollbar =============================================================*/
::-webkit-scrollbar              { width: 6px; height: 6px; }
::-webkit-scrollbar-track        { background: transparent; }
::-webkit-scrollbar-thumb        { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover  { background: var(--text-muted); }

/* === Print =================================================================*/
@media print {
  #toolbar,#fmt-toolbar,#sidebar,#top-btn,.copy-btn,.h-anchor { display: none !important; }
  body,html { overflow: visible; height: auto; }
  #outer-layout { height: auto; overflow: visible; }
  #scroller { overflow: visible; }
  .markdown-body { max-width: 100%; padding: 0; }
}

/* === Responsive ============================================================*/
@media (max-width: 700px) {
  #sidebar { display: none; }
  .markdown-body { padding: 20px 16px 60px; }
  .fname { max-width: 100px; }
}
`;

// ─── Webview Script ──────────────────────────────────────────────────────────

const SCRIPT = /* javascript */`
(function () {
  const vsc = acquireVsCodeApi();

  let currentMarkdown = (typeof __MD__ !== 'undefined') ? __MD__ : '';
  let editMode = false;
  let editTimer;

  // ── Utilities ──────────────────────────────────────────────────────────────
  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }

  // ── File list ──────────────────────────────────────────────────────────────
  function renderFileList(files) {
    const container = qs('#files-list');
    if (!container) return;
    if (!files || !files.length) {
      container.innerHTML = '<div style="padding:8px 12px;font-size:11.5px;color:var(--text-faint)">No .md files found</div>';
      return;
    }
    // Group by dir
    const groups = {};
    files.forEach(f => {
      const key = f.dir || '';
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    });
    let html = '';
    Object.keys(groups).sort().forEach(dir => {
      if (dir) {
        html += '<div class="file-dir">' + escHtml(dir) + '</div>';
      }
      groups[dir].forEach(f => {
        html += '<div class="file-item' + (f.active ? ' active' : '') + '" data-uri="' + escHtml(f.uri) + '" title="' + escHtml(f.relPath) + '">';
        html += '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h8l4 4v8H2V2zm7 0v4h4"/></svg>';
        html += '<span class="file-name">' + escHtml(f.label) + '</span>';
        html += '</div>';
      });
    });
    container.innerHTML = html;

    qsa('.file-item', container).forEach(el => {
      el.addEventListener('click', () => {
        const uri = el.getAttribute('data-uri');
        if (uri) vsc.postMessage({ type: 'openFile', uri });
      });
    });
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── TOC ────────────────────────────────────────────────────────────────────
  function buildTOC() {
    const hs = qsa('.markdown-body h1,h2,h3,h4,h5,h6');
    const body = qs('#toc-body');
    if (!body) return;
    if (!hs.length) {
      const sec = qs('#sec-toc');
      if (sec) sec.style.display = 'none';
      return;
    }
    body.innerHTML = '';
    hs.forEach(h => {
      const level = parseInt(h.tagName[1]);
      const li = document.createElement('li');
      li.className = 'toc-item h' + level;
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = (h.textContent || '').replace(/#\\s*$/, '').trim();
      a.addEventListener('click', e => {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      li.appendChild(a);
      body.appendChild(li);
    });
  }

  // ── Scroll spy ─────────────────────────────────────────────────────────────
  function setupScrollSpy() {
    const scroller = qs('#scroller');
    if (!scroller) return;
    const hs = qsa('.markdown-body h1,h2,h3,h4,h5,h6');
    if (!hs.length) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const link = qs('#toc-body a[href="#' + entry.target.id + '"]');
        if (!link) return;
        if (entry.isIntersecting) {
          qsa('#toc-body a').forEach(a => a.classList.remove('active'));
          link.classList.add('active');
          link.scrollIntoView({ block: 'nearest' });
        }
      });
    }, { root: scroller, rootMargin: '-10% 0% -70% 0%', threshold: 0 });
    hs.forEach(h => obs.observe(h));
  }

  // ── Copy buttons ───────────────────────────────────────────────────────────
  function addCopyButtons() {
    qsa('pre').forEach(pre => {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
      btn.addEventListener('click', () => {
        const code = pre.querySelector('code');
        navigator.clipboard.writeText(code ? code.textContent || '' : '').then(() => {
          btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Copied';
          btn.classList.add('done');
          setTimeout(() => {
            btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"/></svg> Copy';
            btn.classList.remove('done');
          }, 2200);
        });
      });
      pre.appendChild(btn);
    });
  }

  // ── Heading anchor copy ────────────────────────────────────────────────────
  function setupHeadingAnchors() {
    qsa('.h-anchor').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        navigator.clipboard.writeText(window.location.href.split('#')[0] + a.getAttribute('href'));
        const orig = a.textContent;
        a.textContent = '✓';
        setTimeout(() => { a.textContent = orig; }, 1500);
      });
    });
  }

  // ── Mermaid ────────────────────────────────────────────────────────────────
  function setupMermaid() {
    const blocks = qsa('pre code.language-mermaid');
    if (!blocks.length) return;
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = [
      "import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';",
      "const dark = document.documentElement.getAttribute('data-m') === 'dark';",
      "mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'loose' });",
      "document.querySelectorAll('pre code.language-mermaid').forEach(async block => {",
      "  const pre = block.parentElement; if (!pre) return;",
      "  const wrap = document.createElement('div'); wrap.className = 'mermaid-wrap';",
      "  const div = document.createElement('div'); div.className = 'mermaid';",
      "  div.textContent = block.textContent || '';",
      "  wrap.appendChild(div); pre.replaceWith(wrap);",
      "});",
      "try { await mermaid.run(); } catch(e) { console.warn('Mermaid:', e); }",
    ].join('\\n');
    document.head.appendChild(script);
  }

  // ── Format toolbar ─────────────────────────────────────────────────────────
  function applyFormat(action) {
    const ta = qs('#edit-area');
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const val   = ta.value;
    const sel   = val.slice(start, end);

    function wrap(before, after, ph) {
      const inner = sel || ph || '';
      ta.value = val.slice(0, start) + before + inner + after + val.slice(end);
      ta.selectionStart = start + before.length;
      ta.selectionEnd   = start + before.length + inner.length;
      ta.focus();
      triggerEdit();
    }

    function linePrefix(prefix) {
      const ls = val.lastIndexOf('\\n', start - 1) + 1;
      const line = val.slice(ls, end);
      const clean = line.replace(/^#{1,6}\\s/, '').replace(/^>\\s?/, '').replace(/^-\\s/, '').replace(/^\\d+\\.\\s/, '');
      ta.value = val.slice(0, ls) + prefix + clean + val.slice(end);
      ta.selectionStart = ta.selectionEnd = ls + prefix.length + clean.length;
      ta.focus();
      triggerEdit();
    }

    switch (action) {
      case 'bold':        return wrap('**', '**', 'bold text');
      case 'italic':      return wrap('*', '*', 'italic text');
      case 'strike':      return wrap('~~', '~~', 'strikethrough');
      case 'code':        return wrap('\`', '\`', 'code');
      case 'codeblock':   return wrap('\\n\`\`\`\\n', '\\n\`\`\`\\n', 'code here');
      case 'link':        return wrap('[', '](url)', sel || 'link text');
      case 'image':       return wrap('![', '](url)', sel || 'alt text');
      case 'quote':       return linePrefix('> ');
      case 'h1':          return linePrefix('# ');
      case 'h2':          return linePrefix('## ');
      case 'h3':          return linePrefix('### ');
      case 'ul':          return linePrefix('- ');
      case 'ol':          return linePrefix('1. ');
      case 'task':        return linePrefix('- [ ] ');
      case 'hr': {
        const ins = '\\n\\n---\\n\\n';
        ta.value = val.slice(0, start) + ins + val.slice(end);
        ta.selectionStart = ta.selectionEnd = start + ins.length;
        ta.focus();
        triggerEdit();
        break;
      }
      case 'table': {
        const tbl = '\\n| Column 1 | Column 2 | Column 3 |\\n|----------|----------|----------|\\n| Cell     | Cell     | Cell     |\\n';
        ta.value = val.slice(0, start) + tbl + val.slice(end);
        ta.selectionStart = ta.selectionEnd = start + tbl.length;
        ta.focus();
        triggerEdit();
        break;
      }
    }
  }

  // Format toolbar button clicks
  qsa('.fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      if (action) applyFormat(action);
    });
  });

  // ── Smart editor keyboard ──────────────────────────────────────────────────
  function triggerEdit() {
    const ta = qs('#edit-area');
    if (!ta) return;
    const content = ta.value;
    currentMarkdown = content;
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      vsc.postMessage({ type: 'edit', content });
    }, 250);
  }

  qs('#edit-area')?.addEventListener('keydown', e => {
    const ta = e.target;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const val   = ta.value;

    // Tab → 2 spaces
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      ta.value = val.slice(0, start) + '  ' + val.slice(end);
      ta.selectionStart = ta.selectionEnd = start + 2;
      triggerEdit();
      return;
    }

    // Cmd/Ctrl shortcuts
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'b') { e.preventDefault(); applyFormat('bold'); return; }
    if (mod && e.key === 'i') { e.preventDefault(); applyFormat('italic'); return; }
    if (mod && e.key === 'k') { e.preventDefault(); applyFormat('link'); return; }
    if (mod && e.key === '\`') { e.preventDefault(); applyFormat('code'); return; }
    if (mod && e.shiftKey && e.key === '1') { e.preventDefault(); applyFormat('h1'); return; }
    if (mod && e.shiftKey && e.key === '2') { e.preventDefault(); applyFormat('h2'); return; }
    if (mod && e.shiftKey && e.key === '3') { e.preventDefault(); applyFormat('h3'); return; }

    // Smart Enter: continue list items
    if (e.key === 'Enter') {
      const ls = val.lastIndexOf('\\n', start - 1) + 1;
      const line = val.slice(ls, start);
      const taskM    = line.match(/^(\\s*)([-*])\\s\\[[ x]\\]\\s/);
      const bulletM  = line.match(/^(\\s*)([-*])\\s/);
      const numM     = line.match(/^(\\s*)(\\d+)\\.\\s/);

      if (taskM || bulletM || numM) {
        const content = line.slice((taskM || bulletM || numM)[0].length);
        if (!content.trim()) {
          // Empty item → break out of list
          e.preventDefault();
          ta.value = val.slice(0, ls) + '\\n' + val.slice(start);
          ta.selectionStart = ta.selectionEnd = ls + 1;
          triggerEdit();
          return;
        }
        e.preventDefault();
        let insert;
        if (taskM) {
          insert = '\\n' + taskM[1] + taskM[2] + ' [ ] ';
        } else if (bulletM) {
          insert = '\\n' + bulletM[1] + bulletM[2] + ' ';
        } else if (numM) {
          insert = '\\n' + numM[1] + (parseInt(numM[2]) + 1) + '. ';
        }
        ta.value = val.slice(0, start) + insert + val.slice(end);
        ta.selectionStart = ta.selectionEnd = start + insert.length;
        triggerEdit();
      }
    }
  });

  qs('#edit-area')?.addEventListener('input', e => {
    currentMarkdown = e.target.value;
    triggerEdit();
  });

  // ── External links ─────────────────────────────────────────────────────────
  document.addEventListener('click', e => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      e.preventDefault();
      vsc.postMessage({ type: 'openLink', href });
    }
  });

  // ── Toolbar buttons ────────────────────────────────────────────────────────
  qs('#btn-copy-md')?.addEventListener('click', () => {
    vsc.postMessage({ type: 'copyMarkdown' });
  });

  qs('#btn-copy-html')?.addEventListener('click', () => {
    const html = qs('.markdown-body')?.innerHTML || '';
    navigator.clipboard.writeText(html);
    const btn = qs('#btn-copy-html');
    if (btn) {
      const prev = btn.innerHTML;
      btn.textContent = '✓';
      setTimeout(() => { btn.innerHTML = prev; }, 2000);
    }
  });

  qs('#btn-print')?.addEventListener('click', () => window.print());

  // Sidebar toggle
  let sidebarOpen = true;
  const sidebarEl = qs('#sidebar');
  qs('#btn-sidebar')?.addEventListener('click', () => {
    sidebarOpen = !sidebarOpen;
    sidebarEl?.classList.toggle('hidden', !sidebarOpen);
    qs('#btn-sidebar')?.classList.toggle('on', sidebarOpen);
  });

  // Section collapse toggles
  qsa('.sb-section').forEach(sec => {
    const header = sec.querySelector('.sb-header');
    header?.addEventListener('click', e => {
      // Don't collapse if clicking the action button (+)
      if (e.target.closest('.sb-action')) return;
      sec.classList.toggle('collapsed');
    });
  });

  // New file button
  qs('#btn-new-file')?.addEventListener('click', e => {
    e.stopPropagation();
    vsc.postMessage({ type: 'newFile' });
  });

  // Focus mode
  let focusMode = false;
  qs('#btn-focus')?.addEventListener('click', () => {
    focusMode = !focusMode;
    document.body.classList.toggle('focus-mode', focusMode);
    qs('#btn-focus')?.classList.toggle('on', focusMode);
  });

  // Edit / Preview toggle
  qs('#btn-edit')?.addEventListener('click', () => {
    editMode = !editMode;
    document.body.classList.toggle('edit-mode', editMode);
    const ea = qs('#edit-area');
    if (ea && editMode) ea.value = currentMarkdown;
    const btn = qs('#btn-edit');
    if (btn) btn.textContent = editMode ? '← Preview' : 'Edit';
    vsc.postMessage({ type: 'modeChange', mode: editMode ? 'edit' : 'preview' });
  });

  // Back to top
  const topBtn  = qs('#top-btn');
  const scroller = qs('#scroller');
  scroller?.addEventListener('scroll', () => {
    topBtn?.classList.toggle('show', (scroller.scrollTop || 0) > 300);
  });
  topBtn?.addEventListener('click', () => scroller?.scrollTo({ top: 0, behavior: 'smooth' }));

  // ── Messages from extension ────────────────────────────────────────────────
  window.addEventListener('message', ev => {
    const msg = ev.data;

    if (msg.type === 'scrollToHeading') {
      const el = document.getElementById(msg.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.style.transition = 'background 0.3s';
        el.style.background = 'var(--accent-bg)';
        setTimeout(() => { el.style.background = ''; }, 1400);
      }
    }

    if (msg.type === 'updateSplitPreview') {
      const sp = qs('#split-preview .markdown-body');
      if (sp) sp.innerHTML = msg.html;
    }

    if (msg.type === 'updateFiles') {
      renderFileList(msg.files);
    }
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  if (typeof __FILES__ !== 'undefined') renderFileList(__FILES__);
  buildTOC();
  setupScrollSpy();
  addCopyButtons();
  setupHeadingAnchors();
  setupMermaid();

  // Init sidebar button state
  qs('#btn-sidebar')?.classList.add('on');
})();
`;

// ─── SVG Icons ───────────────────────────────────────────────────────────────

const ICON = {
  logo: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="-webkit-text-fill-color:initial"><rect x="1" y="1" width="14" height="14" rx="3" fill="url(#lgr)"/><path d="M4 5h8M4 8h6M4 11h7" stroke="white" stroke-width="1.5" stroke-linecap="round"/><defs><linearGradient id="lgr" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#F97316"/><stop offset="100%" stop-color="#EF4444"/></linearGradient></defs></svg>`,
  sidebar: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`,
  copyMd: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  copyHtml: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  print: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  focus: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`,
  arrowUp: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  chevron: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  link: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  image: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  ul: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/></svg>`,
  ol: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1V4" stroke-linecap="round"/><path d="M3 10h2v1H3v1h2" stroke-linecap="round"/><path d="M3 16h1.5a.5.5 0 0 1 0 1H3a.5.5 0 0 0 0 1h2" stroke-linecap="round"/></svg>`,
};

// ─── Panel ───────────────────────────────────────────────────────────────────

export class MarkdownPreviewPanel {
  public  static currentPanel: MarkdownPreviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _document: vscode.TextDocument;
  private readonly _disposables: vscode.Disposable[] = [];
  private _editMode = false;

  // ── Static API ─────────────────────────────────────────────────────────────

  public static createOrShow(document: vscode.TextDocument): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (MarkdownPreviewPanel.currentPanel) {
      MarkdownPreviewPanel.currentPanel._panel.reveal(column);
      MarkdownPreviewPanel.currentPanel._document = document;
      MarkdownPreviewPanel.currentPanel._editMode = false;
      MarkdownPreviewPanel.currentPanel._render();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'markr', 'Markr', column,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    MarkdownPreviewPanel.currentPanel = new MarkdownPreviewPanel(panel, document);
  }

  public static update(document: vscode.TextDocument): void {
    const p = MarkdownPreviewPanel.currentPanel;
    if (!p) return;
    p._document = document;
    if (p._editMode) return;
    p._render();
  }

  public static syncScroll(document: vscode.TextDocument, line: number): void {
    const p = MarkdownPreviewPanel.currentPanel;
    if (!p) return;
    if (p._document.uri.toString() !== document.uri.toString()) return;
    const id = nearestHeading(document.getText(), line);
    if (id) p._panel.webview.postMessage({ type: 'scrollToHeading', id });
  }

  public static async refreshFiles(): Promise<void> {
    const p = MarkdownPreviewPanel.currentPanel;
    if (!p) return;
    const files = await p._getWorkspaceFiles();
    p._panel.webview.postMessage({ type: 'updateFiles', files });
  }

  // ── Instance ───────────────────────────────────────────────────────────────

  private constructor(panel: vscode.WebviewPanel, document: vscode.TextDocument) {
    this._panel = panel;
    this._document = document;
    this._render();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    vscode.window.onDidChangeActiveColorTheme(() => this._render(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'openLink') {
        vscode.env.openExternal(vscode.Uri.parse(msg.href));
      }

      if (msg.type === 'copyMarkdown') {
        vscode.env.clipboard.writeText(this._document.getText()).then(() => {
          vscode.window.setStatusBarMessage('$(check) Markr: Markdown copied', 3000);
        });
      }

      if (msg.type === 'edit') {
        this._editMode = true;
        const doc = this._document;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri,
          new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
          msg.content
        );
        vscode.workspace.applyEdit(edit).then(() => {
          const html = marked.parse(msg.content) as string;
          this._panel.webview.postMessage({ type: 'updateSplitPreview', html });
        });
      }

      if (msg.type === 'modeChange') {
        this._editMode = msg.mode === 'edit';
        if (msg.mode === 'preview') this._render();
      }

      if (msg.type === 'openFile') {
        const uri = vscode.Uri.parse(msg.uri);
        vscode.workspace.openTextDocument(uri).then(doc => {
          vscode.window.showTextDocument(doc, { preview: false });
          MarkdownPreviewPanel.createOrShow(doc);
        });
      }

      if (msg.type === 'newFile') {
        vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
      }
    }, null, this._disposables);
  }

  private _render(): void {
    const text    = this._document.getText();
    const body    = marked.parse(text) as string;
    const stats   = docStats(text);
    const filename = this._document.uri.path.split('/').pop() ?? 'preview';
    this._panel.title = `Markr — ${filename}`;
    this._getWorkspaceFiles().then(files => {
      this._panel.webview.html = this._buildPage(body, filename, stats, text, files);
    });
  }

  private async _getWorkspaceFiles(): Promise<FileEntry[]> {
    try {
      const uris = await vscode.workspace.findFiles(
        '**/*.md',
        '{**/node_modules/**,**/.git/**,**/.vscode/**,**/.next/**,**/out/**,**/dist/**}',
        200
      );
      const currentUri = this._document.uri.toString();
      return uris
        .sort((a, b) =>
          vscode.workspace.asRelativePath(a).localeCompare(vscode.workspace.asRelativePath(b))
        )
        .map(uri => {
          const relPath = vscode.workspace.asRelativePath(uri);
          const parts   = relPath.split('/');
          const label   = parts[parts.length - 1];
          const dir     = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
          return { label, relPath, uri: uri.toString(), active: uri.toString() === currentUri, dir };
        });
    } catch {
      return [];
    }
  }

  private _buildPage(
    body: string,
    filename: string,
    stats: ReturnType<typeof docStats>,
    text: string,
    files: FileEntry[]
  ): string {
    const nonce   = getNonce();
    const theme   = vscode.window.activeColorTheme;
    const isDark  = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;
    const mode    = isDark ? 'dark' : 'light';
    const cfg     = vscode.workspace.getConfiguration('markr');
    const showTOC = cfg.get<boolean>('showTOC', true);
    const mdJson  = JSON.stringify(text);
    const filesJson = JSON.stringify(files);
    const statsTitle = `${stats.words.toLocaleString()} words · ${stats.headings} heading${stats.headings !== 1 ? 's' : ''} · ${stats.codeBlocks} code block${stats.codeBlocks !== 1 ? 's' : ''}`;

    return /* html */`<!DOCTYPE html>
<html lang="en" data-m="${mode}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           style-src 'unsafe-inline';
           img-src https: data: ${this._panel.webview.cspSource};
           script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;
           connect-src https://cdn.jsdelivr.net;">
<title>Markr</title>
<style>${CSS}</style>
</head>
<body>

<!-- ── Toolbar ─────────────────────────────────────────────────────────── -->
<div id="toolbar">
  <div class="tl">
    <button id="btn-sidebar" class="tb-btn on" title="Toggle sidebar">${ICON.sidebar}</button>
    <span class="logo-mark">${ICON.logo} Markr</span>
    <span class="sep-dot">·</span>
    <span class="fname" title="${filename}">${filename}</span>
    <span class="edit-dot" title="Editing">●</span>
  </div>
  <div class="tr">
    <span class="stats" title="${statsTitle}">${readingTime(stats.words)} · ${stats.words.toLocaleString()}w</span>
    <div class="sep-v"></div>
    <button id="btn-edit"      class="tb-btn" title="Toggle split edit mode (⌘E)">Edit</button>
    <div class="sep-v"></div>
    <button id="btn-copy-md"   class="tb-btn" title="Copy raw Markdown">${ICON.copyMd} MD</button>
    <button id="btn-copy-html" class="tb-btn" title="Copy rendered HTML">${ICON.copyHtml} HTML</button>
    <button id="btn-print"     class="tb-btn" title="Print">${ICON.print} Print</button>
    <div class="sep-v"></div>
    <button id="btn-focus"     class="tb-btn" title="Focus / reading mode">${ICON.focus}</button>
  </div>
</div>

<!-- ── Format Toolbar (edit mode) ──────────────────────────────────────── -->
<div id="fmt-toolbar">
  <div class="fmt-group">
    <button class="fmt-btn" data-action="bold"  title="Bold (⌘B)"><b>B</b></button>
    <button class="fmt-btn" data-action="italic" title="Italic (⌘I)"><i>I</i></button>
    <button class="fmt-btn" data-action="strike" title="Strikethrough"><s>S</s></button>
    <button class="fmt-btn" data-action="code"  title="Inline code"><code style="font-size:12px;padding:0 2px;background:transparent">&#96;</code></button>
    <button class="fmt-btn" data-action="codeblock" title="Code block">${ICON.copyHtml}</button>
  </div>
  <div class="fmt-sep"></div>
  <div class="fmt-group">
    <button class="fmt-btn h-btn" data-action="h1" title="Heading 1 (⌘⇧1)">H1</button>
    <button class="fmt-btn h-btn" data-action="h2" title="Heading 2 (⌘⇧2)">H2</button>
    <button class="fmt-btn h-btn" data-action="h3" title="Heading 3 (⌘⇧3)">H3</button>
  </div>
  <div class="fmt-sep"></div>
  <div class="fmt-group">
    <button class="fmt-btn" data-action="link"  title="Link (⌘K)">${ICON.link}</button>
    <button class="fmt-btn" data-action="image" title="Image">${ICON.image}</button>
    <button class="fmt-btn" data-action="quote" title="Blockquote" style="font-size:14px;font-style:italic">"</button>
  </div>
  <div class="fmt-sep"></div>
  <div class="fmt-group">
    <button class="fmt-btn" data-action="ul"   title="Bullet list">${ICON.ul}</button>
    <button class="fmt-btn" data-action="ol"   title="Numbered list">${ICON.ol}</button>
    <button class="fmt-btn" data-action="task" title="Task list" style="font-size:13px">☐</button>
  </div>
  <div class="fmt-sep"></div>
  <div class="fmt-group">
    <button class="fmt-btn" data-action="table" title="Insert table" style="font-size:13px">⊞</button>
    <button class="fmt-btn" data-action="hr"    title="Horizontal rule" style="font-size:16px;letter-spacing:-2px">——</button>
  </div>
</div>

<!-- ── Outer layout ─────────────────────────────────────────────────────── -->
<div id="outer-layout">

  <!-- Sidebar: file browser + TOC -->
  <div id="sidebar">
    <div class="sb-section">
      <div class="sb-header" title="All Markdown files in workspace">
        <span class="sb-title">Notebooks</span>
        <button class="sb-action" id="btn-new-file" title="New markdown file">+</button>
        <span class="sb-chevron">${ICON.chevron}</span>
      </div>
      <div class="sb-body" id="files-list"></div>
    </div>

    <div class="sb-section flex-fill ${showTOC ? '' : 'collapsed'}" id="sec-toc">
      <div class="sb-header" title="Headings on this page">
        <span class="sb-title">On this page</span>
        <span class="sb-chevron">${ICON.chevron}</span>
      </div>
      <div class="sb-body" id="toc-body"></div>
    </div>
  </div>

  <!-- Main content column -->
  <div id="main-col">
    <div id="main">
      <div id="scroller">
        <article class="markdown-body">${body}</article>
      </div>
      <textarea id="edit-area" spellcheck="false" autocorrect="off" autocapitalize="off"></textarea>
      <div id="split-preview">
        <article class="markdown-body">${body}</article>
      </div>
    </div>
  </div>

</div>

<!-- ── Back to top ──────────────────────────────────────────────────────── -->
<button id="top-btn" title="Back to top">${ICON.arrowUp}</button>

<script nonce="${nonce}">const __MD__ = ${mdJson}; const __FILES__ = ${filesJson};</script>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
  }

  public dispose(): void {
    MarkdownPreviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) this._disposables.pop()?.dispose();
  }
}
