import * as vscode from 'vscode';
import { marked, Renderer } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

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

// Custom renderer: heading IDs + anchor links
const renderer = new Renderer();
renderer.heading = function ({ text, depth }) {
  const id = slugify(text);
  return `<h${depth} id="${id}">${text}<a class="h-anchor" href="#${id}" title="Copy link" aria-label="Copy link to ${text}">#</a></h${depth}>\n`;
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
  const mins = Math.max(1, Math.ceil(words / 200));
  return `${mins} min read`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Find the heading ID closest to the cursor line (walk backwards)
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
  --fg:           #1f2328;
  --fg-muted:     #636c76;
  --bg:           #ffffff;
  --bg-subtle:    #f6f8fa;
  --border:       #d0d7de;
  --brd-muted:    #d8dee4;
  --link:         #0969da;
  --link-hv:      #0550ae;
  --code-inline:  rgba(175,184,193,0.2);
  --code-block:   #f6f8fa;
  --quote-brd:    #d0d7de;
  --hr:           hsla(210,18%,87%,1);
  --table-alt:    #f6f8fa;
  --success:      #1a7f37;
  /* hljs light */
  --hl:           #24292e;
  --hl-kw:        #d73a49;
  --hl-fn:        #6f42c1;
  --hl-lit:       #005cc5;
  --hl-str:       #032f62;
  --hl-bi:        #e36209;
  --hl-cm:        #6a737d;
  --hl-tag:       #22863a;
  --hl-add-bg:    #f0fff4;
  --hl-del-bg:    #ffeef0;
  --hl-add-fg:    #22863a;
  --hl-del-fg:    #b31d28;
}

/* === Tokens (Dark) =========================================================*/
[data-m="dark"] {
  --fg:           #e6edf3;
  --fg-muted:     #8d96a0;
  --bg:           #0d1117;
  --bg-subtle:    #161b22;
  --border:       #30363d;
  --brd-muted:    #21262d;
  --link:         #2f81f7;
  --link-hv:      #58a6ff;
  --code-inline:  rgba(110,118,129,0.4);
  --code-block:   #161b22;
  --quote-brd:    #3d444d;
  --hr:           #21262d;
  --table-alt:    #161b22;
  --success:      #3fb950;
  /* hljs dark */
  --hl:           #c9d1d9;
  --hl-kw:        #ff7b72;
  --hl-fn:        #d2a8ff;
  --hl-lit:       #79c0ff;
  --hl-str:       #a5d6ff;
  --hl-bi:        #ffa657;
  --hl-cm:        #8b949e;
  --hl-tag:       #7ee787;
  --hl-add-bg:    rgba(46,160,67,0.15);
  --hl-del-bg:    rgba(248,81,73,0.15);
  --hl-add-fg:    #aff5b4;
  --hl-del-fg:    #ffdcd7;
}

/* === Reset ==================================================================*/
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; padding: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
    Helvetica, Arial, sans-serif, "Apple Color Emoji";
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}

/* === Toolbar ================================================================*/
#toolbar {
  position: fixed;
  inset: 0 0 auto 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 8px;
  background: var(--vscode-editor-background, var(--bg));
  border-bottom: 1px solid var(--border);
  z-index: 200;
  gap: 8px;
  user-select: none;
}
.tl { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.tr { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.logo {
  font-weight: 700;
  font-size: 13px;
  letter-spacing: -0.3px;
  color: var(--link);
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 5px;
}
.logo svg { flex-shrink: 0; }
.sep-dot { color: var(--border); font-size: 16px; line-height: 1; }
.fname {
  color: var(--fg-muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}
.stats {
  color: var(--fg-muted);
  font-size: 12px;
  white-space: nowrap;
  padding: 0 4px;
}
.sep-v { width: 1px; height: 18px; background: var(--border); margin: 0 4px; flex-shrink: 0; }
.tb-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border: none;
  border-radius: 5px;
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  color: var(--vscode-foreground, var(--fg));
  background: transparent;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
  line-height: 1;
  height: 28px;
}
.tb-btn:hover {
  background: var(--vscode-toolbar-hoverBackground, rgba(120,120,120,0.18));
}
.tb-btn.on {
  background: var(--vscode-button-background, var(--link));
  color: var(--vscode-button-foreground, #fff);
}
.tb-btn svg { flex-shrink: 0; }

/* === Layout ================================================================*/
#layout {
  display: flex;
  height: calc(100vh - 44px);
  margin-top: 44px;
  overflow: hidden;
}

/* === TOC ===================================================================*/
#toc {
  width: 220px;
  min-width: 220px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding: 14px 0 40px;
  font-size: 12.5px;
  transition: min-width 0.2s ease, width 0.2s ease, opacity 0.2s ease, padding 0.2s ease;
}
#toc.hidden {
  width: 0; min-width: 0; opacity: 0; padding: 0; overflow: hidden;
}
.toc-heading {
  padding: 0 16px 10px;
  margin: 0;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--fg-muted);
  white-space: nowrap;
}
#toc-body { padding: 0; }
.ti { list-style: none; margin: 0; padding: 0; }
.ti a {
  display: block;
  padding: 3px 16px 3px 12px;
  color: var(--fg-muted);
  text-decoration: none;
  border-left: 2px solid transparent;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.1s, background 0.1s, border-color 0.1s;
  line-height: 1.5;
}
.ti a:hover { color: var(--fg); background: var(--bg-subtle); }
.ti a.active { color: var(--link); border-left-color: var(--link); background: var(--bg-subtle); }
.ti.h1 a { padding-left: 12px; font-weight: 600; font-size: 12.5px; }
.ti.h2 a { padding-left: 18px; font-size: 12.5px; }
.ti.h3 a { padding-left: 28px; font-size: 12px; }
.ti.h4 a { padding-left: 38px; font-size: 11.5px; }
.ti.h5 a, .ti.h6 a { padding-left: 46px; font-size: 11px; }

/* === Content scroller ======================================================*/
#scroller {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/* === Markdown body =========================================================*/
.markdown-body {
  max-width: 780px;
  margin: 0 auto;
  padding: 32px 32px 80px;
  word-wrap: break-word;
}

/* Headings */
.markdown-body h1,.markdown-body h2,.markdown-body h3,
.markdown-body h4,.markdown-body h5,.markdown-body h6 {
  margin-top: 1.5em; margin-bottom: .5em;
  font-weight: 600; line-height: 1.25; color: var(--fg);
  position: relative;
}
.markdown-body h1:first-child,.markdown-body h2:first-child,.markdown-body h3:first-child { margin-top: 0; }
.markdown-body h1 { font-size: 2em;   padding-bottom: .3em; border-bottom: 1px solid var(--border); }
.markdown-body h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1em; }
.markdown-body h5 { font-size: .875em; }
.markdown-body h6 { font-size: .85em; color: var(--fg-muted); }

/* Heading anchor (# on hover) */
.h-anchor {
  opacity: 0;
  font-size: .7em;
  font-weight: 400;
  margin-left: 8px;
  color: var(--fg-muted);
  text-decoration: none;
  transition: opacity 0.15s, color 0.15s;
  vertical-align: middle;
}
h1:hover .h-anchor, h2:hover .h-anchor, h3:hover .h-anchor,
h4:hover .h-anchor, h5:hover .h-anchor, h6:hover .h-anchor { opacity: 1; }
.h-anchor:hover { color: var(--link); }

/* Body text */
.markdown-body p { margin-top: 0; margin-bottom: 16px; }
.markdown-body strong { font-weight: 600; }
.markdown-body em { font-style: italic; }
.markdown-body del { text-decoration: line-through; color: var(--fg-muted); }

/* Links */
.markdown-body a { color: var(--link); text-decoration: none; }
.markdown-body a:hover { color: var(--link-hv); text-decoration: underline; }

/* Inline code */
.markdown-body code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 85%;
  padding: .2em .4em;
  background: var(--code-inline);
  border-radius: 6px;
}

/* Code blocks */
.markdown-body pre {
  position: relative;
  margin: 0 0 16px;
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.6;
  background: var(--code-block);
  border-radius: 8px;
  border: 1px solid var(--border);
}
.markdown-body pre code {
  padding: 0; margin: 0; background: transparent; border-radius: 0;
  font-size: 100%; white-space: pre; word-break: normal; overflow-wrap: normal; color: inherit;
}

/* Copy button on code blocks */
.copy-btn {
  position: absolute; top: 8px; right: 8px;
  padding: 3px 9px;
  font-size: 11px; font-family: inherit;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-subtle);
  color: var(--fg-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  display: flex; align-items: center; gap: 4px;
  line-height: 1.5;
}
pre:hover .copy-btn { opacity: 1; }
.copy-btn:hover { background: var(--bg); color: var(--fg); }
.copy-btn.done { color: var(--success); border-color: var(--success); opacity: 1; }

/* Blockquote */
.markdown-body blockquote {
  margin: 0 0 16px; padding: 0 1em;
  color: var(--fg-muted); border-left: 4px solid var(--quote-brd);
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
  margin: 0 .5em 0 -1.6em; vertical-align: middle; accent-color: var(--link);
}

/* Images */
.markdown-body img { max-width: 100%; border-style: none; border-radius: 6px; }

/* HR */
.markdown-body hr { height: .25em; padding: 0; margin: 24px 0; background: var(--hr); border: 0; border-radius: 2px; }

/* Tables */
.markdown-body table { border-spacing: 0; border-collapse: collapse; display: block; width: max-content; max-width: 100%; overflow: auto; margin-bottom: 16px; }
.markdown-body table th { font-weight: 600; padding: 6px 13px; border: 1px solid var(--border); background: var(--bg-subtle); }
.markdown-body table td { padding: 6px 13px; border: 1px solid var(--border); }
.markdown-body table tr { background: var(--bg); border-top: 1px solid var(--brd-muted); }
.markdown-body table tr:nth-child(2n) { background: var(--table-alt); }

/* Keyboard */
.markdown-body kbd {
  display: inline-block; padding: 3px 5px;
  font-family: ui-monospace, monospace; font-size: 11px; line-height: 10px;
  color: var(--fg); vertical-align: middle;
  background: var(--bg-subtle); border: 1px solid var(--border); border-radius: 6px;
  box-shadow: inset 0 -1px 0 var(--border);
}

/* Details */
.markdown-body details { display: block; margin-bottom: 16px; }
.markdown-body details summary { display: list-item; cursor: pointer; font-weight: 600; }

/* Mermaid diagrams */
.mermaid-wrap { margin-bottom: 16px; }
.mermaid { text-align: center; overflow-x: auto; }
.mermaid-error {
  padding: 12px 16px; border-radius: 8px;
  background: var(--code-block); border: 1px solid var(--border);
  color: var(--fg-muted); font-size: 13px; font-style: italic;
}

/* === Highlight.js (CSS-var driven) =========================================*/
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
.hljs-addition   { color: var(--hl-add-fg); background: var(--hl-add-bg); }
.hljs-deletion   { color: var(--hl-del-fg); background: var(--hl-del-bg); }

/* === Back to top ===========================================================*/
#top-btn {
  position: fixed; bottom: 24px; right: 20px;
  width: 36px; height: 36px;
  border-radius: 50%; border: 1px solid var(--border);
  background: var(--bg); color: var(--fg-muted);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transform: translateY(10px);
  transition: opacity 0.2s, transform 0.2s, background 0.15s;
  z-index: 100;
  box-shadow: 0 2px 10px rgba(0,0,0,0.15);
}
#top-btn.show { opacity: 1; transform: translateY(0); }
#top-btn:hover { background: var(--bg-subtle); color: var(--fg); }

/* === Focus (reading) mode ==================================================*/
body.focus-mode #toc { width: 0; min-width: 0; opacity: 0; padding: 0; overflow: hidden; }
body.focus-mode .markdown-body { max-width: 720px; font-size: 16.5px; line-height: 1.8; }

/* === Scrollbar =============================================================*/
::-webkit-scrollbar              { width: 7px; height: 7px; }
::-webkit-scrollbar-track        { background: transparent; }
::-webkit-scrollbar-thumb        { background: var(--border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover  { background: var(--fg-muted); }

/* === Print =================================================================*/
@media print {
  #toolbar,#toc,#top-btn,.copy-btn,.h-anchor { display: none !important; }
  body,html { overflow: visible; height: auto; }
  #layout { height: auto; overflow: visible; }
  #scroller { overflow: visible; }
  .markdown-body { max-width: 100%; padding: 0; }
}

/* === Responsive ============================================================*/
@media (max-width: 680px) {
  #toc { display: none; }
  .markdown-body { padding: 20px 16px 60px; }
  .fname { max-width: 120px; }
}
`;

// ─── Webview Script ──────────────────────────────────────────────────────────

const SCRIPT = /* javascript */`
(function () {
  const vsc = acquireVsCodeApi();

  // ── TOC ────────────────────────────────────────────────────────────────────
  function buildTOC() {
    const hs = [...document.querySelectorAll('.markdown-body h1,h2,h3,h4,h5,h6')];
    const body = document.getElementById('toc-body');
    if (!body || hs.length === 0) {
      const toc = document.getElementById('toc');
      if (toc) toc.classList.add('hidden');
      const btn = document.getElementById('btn-toc');
      if (btn) { btn.style.display = 'none'; }
      return;
    }
    body.innerHTML = '';
    hs.forEach(h => {
      const level = parseInt(h.tagName[1]);
      const li = document.createElement('li');
      li.className = 'ti h' + level;
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = (h.textContent || '').replace(/#\\s*$/, '').trim();
      a.addEventListener('click', e => {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // small offset for toolbar
        setTimeout(() => {
          const scroller = document.getElementById('scroller');
          if (scroller) scroller.scrollBy(0, -8);
        }, 300);
      });
      li.appendChild(a);
      body.appendChild(li);
    });
  }

  // ── Scroll spy ─────────────────────────────────────────────────────────────
  function setupScrollSpy() {
    const scroller = document.getElementById('scroller');
    if (!scroller) return;
    const hs = [...document.querySelectorAll('.markdown-body h1,h2,h3,h4,h5,h6')];
    if (!hs.length) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const link = document.querySelector('#toc-body a[href="#' + entry.target.id + '"]');
        if (!link) return;
        if (entry.isIntersecting) {
          document.querySelectorAll('#toc-body a').forEach(a => a.classList.remove('active'));
          link.classList.add('active');
          // Scroll TOC item into view (within TOC panel)
          link.scrollIntoView({ block: 'nearest' });
        }
      });
    }, { root: scroller, rootMargin: '-15% 0% -70% 0%', threshold: 0 });
    hs.forEach(h => obs.observe(h));
  }

  // ── Copy buttons on code blocks ────────────────────────────────────────────
  function addCopyButtons() {
    document.querySelectorAll('pre').forEach(pre => {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
      btn.addEventListener('click', () => {
        const code = pre.querySelector('code');
        const text = code ? code.textContent || '' : '';
        navigator.clipboard.writeText(text).then(() => {
          btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
          btn.classList.add('done');
          setTimeout(() => {
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
            btn.classList.remove('done');
          }, 2200);
        });
      });
      pre.appendChild(btn);
    });
  }

  // ── Heading anchor copy ─────────────────────────────────────────────────────
  function setupHeadingAnchors() {
    document.querySelectorAll('.h-anchor').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        navigator.clipboard.writeText(window.location.href.split('#')[0] + a.getAttribute('href'));
        const el = a;
        const orig = el.textContent;
        el.textContent = '✓';
        setTimeout(() => { el.textContent = orig; }, 1500);
      });
    });
  }

  // ── Mermaid diagrams ────────────────────────────────────────────────────────
  function setupMermaid() {
    const blocks = document.querySelectorAll('pre code.language-mermaid');
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

  // ── External links ──────────────────────────────────────────────────────────
  document.addEventListener('click', e => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      e.preventDefault();
      vsc.postMessage({ type: 'openLink', href });
    }
  });

  // ── Toolbar: Copy Markdown ──────────────────────────────────────────────────
  document.getElementById('btn-copy-md')?.addEventListener('click', () => {
    vsc.postMessage({ type: 'copyMarkdown' });
  });

  // ── Toolbar: Copy HTML ──────────────────────────────────────────────────────
  document.getElementById('btn-copy-html')?.addEventListener('click', () => {
    const html = document.querySelector('.markdown-body')?.innerHTML || '';
    navigator.clipboard.writeText(html);
    const btn = document.getElementById('btn-copy-html');
    if (btn) {
      const prev = btn.innerHTML;
      btn.innerHTML = btn.innerHTML.replace('HTML', '✓ Copied');
      setTimeout(() => { btn.innerHTML = prev; }, 2000);
    }
  });

  // ── Toolbar: Print ─────────────────────────────────────────────────────────
  document.getElementById('btn-print')?.addEventListener('click', () => window.print());

  // ── Toolbar: TOC toggle ─────────────────────────────────────────────────────
  let tocOpen = true;
  const tocEl = document.getElementById('toc');
  const tocBtn = document.getElementById('btn-toc');
  tocBtn?.addEventListener('click', () => {
    tocOpen = !tocOpen;
    tocEl?.classList.toggle('hidden', !tocOpen);
    tocBtn.classList.toggle('on', tocOpen);
  });

  // ── Toolbar: Focus mode ─────────────────────────────────────────────────────
  let focusMode = false;
  const focusBtn = document.getElementById('btn-focus');
  focusBtn?.addEventListener('click', () => {
    focusMode = !focusMode;
    document.body.classList.toggle('focus-mode', focusMode);
    focusBtn.classList.toggle('on', focusMode);
    if (focusMode) { tocOpen = false; tocEl?.classList.add('hidden'); tocBtn?.classList.remove('on'); }
  });

  // ── Back to top ─────────────────────────────────────────────────────────────
  const topBtn = document.getElementById('top-btn');
  const scroller = document.getElementById('scroller');
  scroller?.addEventListener('scroll', () => {
    topBtn?.classList.toggle('show', (scroller.scrollTop || 0) > 300);
  });
  topBtn?.addEventListener('click', () => {
    scroller?.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ── Messages from extension ─────────────────────────────────────────────────
  window.addEventListener('message', ev => {
    const msg = ev.data;
    if (msg.type === 'scrollToHeading') {
      const el = document.getElementById(msg.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Highlight effect
        el.style.transition = 'background 0.3s';
        el.style.background = 'var(--code-inline)';
        setTimeout(() => { el.style.background = ''; }, 1200);
      }
    }
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  buildTOC();
  setupScrollSpy();
  addCopyButtons();
  setupHeadingAnchors();
  setupMermaid();

  // Initialise TOC button state
  if (tocBtn && tocEl && !tocEl.classList.contains('hidden')) {
    tocBtn.classList.add('on');
  }
})();
`;

// ─── SVG icons ───────────────────────────────────────────────────────────────

const ICON = {
  logo: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v2H2zM2 7h8v2H2zM2 12h10v2H2z"/></svg>`,
  toc: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>`,
  copyMd: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  copyHtml: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  print: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  focus: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`,
  arrowUp: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
};

// ─── Panel ───────────────────────────────────────────────────────────────────

export class MarkdownPreviewPanel {
  public static currentPanel: MarkdownPreviewPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _document: vscode.TextDocument;
  private readonly _disposables: vscode.Disposable[] = [];

  // ── Static API ──────────────────────────────────────────────────────────────

  public static createOrShow(document: vscode.TextDocument): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (MarkdownPreviewPanel.currentPanel) {
      MarkdownPreviewPanel.currentPanel._panel.reveal(column);
      MarkdownPreviewPanel.currentPanel._document = document;
      MarkdownPreviewPanel.currentPanel._render();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'markr',
      'Markr',
      column,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    MarkdownPreviewPanel.currentPanel = new MarkdownPreviewPanel(panel, document);
  }

  public static update(document: vscode.TextDocument): void {
    if (!MarkdownPreviewPanel.currentPanel) return;
    MarkdownPreviewPanel.currentPanel._document = document;
    MarkdownPreviewPanel.currentPanel._render();
  }

  public static syncScroll(document: vscode.TextDocument, line: number): void {
    const p = MarkdownPreviewPanel.currentPanel;
    if (!p) return;
    if (p._document.uri.toString() !== document.uri.toString()) return;
    const id = nearestHeading(document.getText(), line);
    if (id) p._panel.webview.postMessage({ type: 'scrollToHeading', id });
  }

  // ── Instance ────────────────────────────────────────────────────────────────

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
    }, null, this._disposables);
  }

  private _render(): void {
    const text = this._document.getText();
    const body = marked.parse(text) as string;
    const words = wordCount(text);
    const filename = this._document.uri.path.split('/').pop() ?? 'preview';
    this._panel.title = `Markr — ${filename}`;
    this._panel.webview.html = this._buildPage(body, filename, words);
  }

  private _buildPage(body: string, filename: string, words: number): string {
    const nonce = getNonce();
    const theme = vscode.window.activeColorTheme;
    const isDark =
      theme.kind === vscode.ColorThemeKind.Dark ||
      theme.kind === vscode.ColorThemeKind.HighContrast;
    const mode = isDark ? 'dark' : 'light';
    const cfg = vscode.workspace.getConfiguration('markr');
    const showTOC = cfg.get<boolean>('showTOC', true);

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

<!-- ── Toolbar ──────────────────────────────────────────────────────────── -->
<div id="toolbar">
  <div class="tl">
    <button id="btn-toc" class="tb-btn ${showTOC ? 'on' : ''}" title="Toggle Table of Contents">
      ${ICON.toc}
    </button>
    <span class="logo">${ICON.logo} Markr</span>
    <span class="sep-dot">·</span>
    <span class="fname" title="${filename}">${filename}</span>
  </div>
  <div class="tr">
    <span class="stats">${readingTime(words)} · ${words.toLocaleString()} words</span>
    <div class="sep-v"></div>
    <button id="btn-copy-md"   class="tb-btn" title="Copy raw Markdown">${ICON.copyMd} MD</button>
    <button id="btn-copy-html" class="tb-btn" title="Copy rendered HTML">${ICON.copyHtml} HTML</button>
    <button id="btn-print"     class="tb-btn" title="Print">${ICON.print} Print</button>
    <div class="sep-v"></div>
    <button id="btn-focus"     class="tb-btn" title="Focus mode — wider content, no sidebar">${ICON.focus}</button>
  </div>
</div>

<!-- ── Layout ───────────────────────────────────────────────────────────── -->
<div id="layout">
  <nav id="toc" ${showTOC ? '' : 'class="hidden"'}>
    <p class="toc-heading">On this page</p>
    <div id="toc-body"></div>
  </nav>
  <div id="scroller">
    <article class="markdown-body">${body}</article>
  </div>
</div>

<!-- ── Back to top ──────────────────────────────────────────────────────── -->
<button id="top-btn" title="Back to top">${ICON.arrowUp}</button>

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
