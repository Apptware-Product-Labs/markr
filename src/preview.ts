import * as vscode from 'vscode';
import { marked, Renderer, type MarkedExtension } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import * as cp from 'child_process';
import * as os from 'os';
import * as nodePath from 'path';
import * as fs from 'fs';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileEntry {
  label: string;
  relPath: string;
  uri: string;
  active: boolean;
  dir: string;
  isAiConfig: boolean;
  aiKind: string;
}

// ─── AI Markdown detection ───────────────────────────────────────────────────

const AI_CONFIG_NAMES = new Set([
  'claude.md', 'claude.local.md', 'codex.md', 'agents.md', 'gemini.md',
  'skills.md', 'skill.md', 'system-prompt.md', 'systemprompt.md',
  'copilot-instructions.md', '.cursorrules', 'cursor.md', 'windsurf.md',
  'aider.md', 'gpt.md', 'openai.md', 'anthropic.md', 'context.md',
  'instructions.md', 'memory.md', 'rules.md', 'prompt.md', 'prompts.md',
]);

function aiDocKind(label: string, relPath = ''): string {
  const lower = label.toLowerCase();
  const path = relPath.toLowerCase();
  if (lower === 'agents.md' || lower === 'agent.md') return 'Agent';
  if (lower === 'skill.md' || lower === 'skills.md' || path.includes('/skills/')) return 'Skill';
  if (lower.includes('copilot')) return 'Copilot';
  if (lower.includes('claude')) return 'Claude';
  if (lower.includes('codex')) return 'Codex';
  if (lower.includes('gemini')) return 'Gemini';
  if (lower.includes('cursor') || lower === '.cursorrules') return 'Cursor';
  if (lower.includes('windsurf')) return 'Windsurf';
  if (lower.includes('aider')) return 'Aider';
  if (lower.includes('system') || lower.includes('prompt')) return 'Prompt';
  if (lower.includes('context') || lower.includes('memory')) return 'Context';
  if (lower.includes('rule') || lower.includes('instruction')) return 'Rules';
  if (AI_CONFIG_NAMES.has(lower) || /^claude(\.local)?\.md$/i.test(lower)) return 'AI Doc';
  return '';
}

// ─── Marked setup ────────────────────────────────────────────────────────────

const highlightExtension = markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }) as unknown as MarkedExtension;
marked.use(highlightExtension);

const renderer = new Renderer();
renderer.heading = function (text: string, depth: number) {
  const t  = text ?? '';
  const id = slugify(t);
  return `<h${depth} id="${id}">${t}<a class="h-anchor" href="#${id}" title="Copy link">#</a></h${depth}>\n`;
};
marked.use({ gfm: true, breaks: false, renderer });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  if (!text) return '';
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

function tokenEstimate(chars: number): string {
  const t = Math.round(chars / 4);
  return t < 1000 ? `${t} tok` : `~${(t / 1000).toFixed(1)}K tok`;
}

function docStats(text: string) {
  const words      = wordCount(text);
  const chars      = text.length;
  const headings   = (text.match(/^#{1,6}\s/gm) ?? []).length;
  const codeBlocks = Math.floor(((text.match(/^```/gm) ?? []).length) / 2);
  return { words, chars, headings, codeBlocks };
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

// Transforms > [!NOTE/WARNING/TIP/IMPORTANT/CAUTION] blockquotes into styled alerts
function applyGithubAlerts(html: string): string {
  const cfg: Record<string, [string, string]> = {
    NOTE:      ['ℹ',  'Note'],
    TIP:       ['◆',  'Tip'],
    IMPORTANT: ['★',  'Important'],
    WARNING:   ['⚠',  'Warning'],
    CAUTION:   ['⛔', 'Caution'],
  };
  return html.replace(
    /<blockquote>\n?<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n?([\s\S]*?)<\/blockquote>/g,
    (_, type: string, body: string) => {
      const [icon, label] = cfg[type];
      return `<div class="gh-alert ${type.toLowerCase()}"><p class="gh-alert-title">${icon} ${label}</p><p>${body}</div>`;
    }
  );
}

// Parses YAML frontmatter at start of document
function extractFrontmatter(text: string): { meta: Record<string, string> | null; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: null, body: text };
  const meta: Record<string, string> = {};
  m[1].split('\n').forEach(line => {
    const colon = line.indexOf(':');
    if (colon < 1) return;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    if (key) meta[key] = val;
  });
  return { meta, body: m[2] };
}

function renderFrontmatter(meta: Record<string, string>): string {
  const items = Object.entries(meta)
    .map(([k, v]) => `<span class="fm-item"><span class="fm-key">${k}</span><span class="fm-colon">:</span><span class="fm-val">${v}</span></span>`)
    .join('');
  return `<div class="fm-panel">${items}</div>`;
}

function buildPdfHtml(content: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  :root {
    --hl-kw:#d73a49;--hl-fn:#6f42c1;--hl-lit:#005cc5;--hl-str:#032f62;
    --hl-bi:#e36209;--hl-cm:#6a737d;--hl-tag:#22863a;--hl-fg:#24292e;
    --hl-add-bg:#f0fff4;--hl-del-bg:#ffeef0;--hl-add-fg:#22863a;--hl-del-fg:#b31d28;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 48px 48px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 15px; line-height: 1.75; color: #24292e; background: #fff;
    max-width: 860px; margin: 0 auto;
  }
  h1,h2,h3,h4,h5,h6 { font-weight: 700; margin-top: 1.5em; margin-bottom: .4em; line-height: 1.25; page-break-after: avoid; }
  h1:first-child,h2:first-child,h3:first-child { margin-top: 0; }
  h1 { font-size: 2em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #e5e0d8; padding-bottom: .35em; }
  h3 { font-size: 1.25em; }
  h4 { font-size: 1em; }
  h5 { font-size: .875em; } h6 { font-size: .85em; color: #6a737d; }
  p { margin: 0 0 16px; }
  strong { font-weight: 600; }
  em { font-style: italic; }
  del { text-decoration: line-through; color: #6a737d; }
  a { color: #0b6e99; text-decoration: none; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 85%; padding: .2em .4em; background: rgba(110,104,96,.12); border-radius: 4px; }
  pre { position: relative; margin: 0 0 16px; padding: 16px; overflow: auto; font-size: 13px; line-height: 1.65; background: #f6f8fa; border-radius: 6px; border: 1px solid #e1e4e8; page-break-inside: avoid; }
  pre code { padding: 0; background: transparent; border-radius: 0; font-size: 100%; }
  blockquote { margin: 0 0 16px; padding: 10px 16px; color: #6a737d; border-left: 3px solid #F97316; background: rgba(249,115,22,.07); border-radius: 0 6px 6px 0; }
  blockquote > :first-child { margin-top: 0; } blockquote > :last-child { margin-bottom: 0; }
  ul,ol { margin: 0 0 16px; padding-left: 2em; }
  ul ul,ul ol,ol ul,ol ol { margin: 0; }
  li + li { margin-top: .25em; }
  .task-list-item { list-style-type: none; }
  .task-list-item input[type="checkbox"] { margin: 0 .5em 0 -1.6em; vertical-align: middle; }
  img { max-width: 100%; border-radius: 6px; }
  hr { height: 1px; padding: 0; margin: 24px 0; background: #e1e4e8; border: 0; }
  table { border-spacing: 0; border-collapse: collapse; display: block; width: max-content; max-width: 100%; overflow: auto; margin-bottom: 16px; border: 1px solid #e1e4e8; border-radius: 6px; page-break-inside: avoid; }
  th { font-weight: 600; padding: 8px 14px; border-bottom: 2px solid #e1e4e8; text-align: left; background: #f6f8fa; }
  td { padding: 7px 14px; border-bottom: 1px solid #eaecef; }
  tr:last-child td { border-bottom: none; }
  tr:nth-child(2n) td { background: #f6f8fa; }
  kbd { display: inline-block; padding: 3px 5px; font-family: ui-monospace, monospace; font-size: 11px; background: #fafbfc; border: 1px solid #e1e4e8; border-radius: 3px; }
  details { display: block; margin-bottom: 16px; }
  details summary { cursor: pointer; font-weight: 600; }
  .h-anchor { display: none; }
  .copy-btn { display: none; }
  .fm-panel { background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 8px; padding: 10px 14px; margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12px; font-family: ui-monospace, monospace; }
  .fm-item { display: flex; gap: 3px; }
  .fm-key { color: #6a737d; } .fm-colon { color: #bbb; } .fm-val { color: #24292e; }
  .gh-alert { padding: 12px 16px; margin: 0 0 16px; border-radius: 6px; border-left: 4px solid; page-break-inside: avoid; }
  .gh-alert-title { font-weight: 600; font-size: 13.5px; margin: 0 0 8px; }
  .gh-alert.note { background: rgba(9,105,218,.07); border-color: #0969da; }
  .gh-alert.note .gh-alert-title { color: #0969da; }
  .gh-alert.tip { background: rgba(26,127,55,.07); border-color: #1a7f37; }
  .gh-alert.tip .gh-alert-title { color: #1a7f37; }
  .gh-alert.important { background: rgba(130,80,223,.07); border-color: #8250df; }
  .gh-alert.important .gh-alert-title { color: #8250df; }
  .gh-alert.warning { background: rgba(154,103,0,.07); border-color: #9a6700; }
  .gh-alert.warning .gh-alert-title { color: #9a6700; }
  .gh-alert.caution { background: rgba(207,34,46,.07); border-color: #cf222e; }
  .gh-alert.caution .gh-alert-title { color: #cf222e; }
  .hljs { color: var(--hl-fg); background: transparent; }
  .hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_ { color: var(--hl-kw); }
  .hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_ { color: var(--hl-fn); }
  .hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-variable,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id { color: var(--hl-lit); }
  .hljs-regexp,.hljs-string,.hljs-meta .hljs-string { color: var(--hl-str); }
  .hljs-built_in,.hljs-symbol { color: var(--hl-bi); }
  .hljs-comment,.hljs-code,.hljs-formula { color: var(--hl-cm); font-style: italic; }
  .hljs-name,.hljs-quote,.hljs-selector-tag,.hljs-selector-pseudo { color: var(--hl-tag); }
  .hljs-addition { color: var(--hl-add-fg); background: var(--hl-add-bg); }
  .hljs-deletion { color: var(--hl-del-fg); background: var(--hl-del-bg); }
  .hljs-emphasis { font-style: italic; }
  .hljs-strong { font-weight: bold; }
  @page { margin: 20mm 18mm; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>${content}</body>
</html>`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const CSS = /* css */`
/* === Tokens (Light) ========================================================*/
[data-m="light"] {
  --accent:       #F97316;
  --accent-dim:   #C2570A;
  --accent-bg:    rgba(249,115,22,0.08);
  --accent-border: rgba(249,115,22,0.3);
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
  --link:         #0b6e99;
  --link-hv:      #0550ae;
  --success:      #0f7b6c;
  --fg:           #1c1a17;
  --fg-muted:     #888178;
  --code-inline:  rgba(110,104,96,0.13);
  --hr:           #e5e0d8;
  --table-alt:    #f3f0eb;
  --brd-muted:    #e5e0d8;
  --hl: #1c1a17; --hl-kw: #d73a49; --hl-fn: #6f42c1; --hl-lit: #005cc5;
  --hl-str: #032f62; --hl-bi: #e36209; --hl-cm: #888178; --hl-tag: #22863a;
  --hl-add-bg: #f0fff4; --hl-del-bg: #ffeef0; --hl-add-fg: #22863a; --hl-del-fg: #b31d28;
  --sb-thumb:     rgba(88,78,66,0.42); --sb-thumb-hv:  rgba(88,78,66,0.62);
  --sb-track:     #f0ece5;             --sb-track-panel: #e8e2d8;        --sb-track-code: #e2dacf;
}

/* === Notion (clean white) ===================================================*/
[data-m="notion"] {
  --accent:       #37352f;  --accent-dim:   #2f2d28;  --accent-bg:    rgba(55,53,47,0.08);
  --accent-border: rgba(55,53,47,0.12);
  --text:         #37352f;  --text-2:       #55534e;  --text-muted:   #787774;  --text-faint:   #b9b8b6;
  --bg:           #ffffff;  --bg-panel:     #fbfbfa;  --bg-hover:     rgba(55,53,47,0.08);  --bg-subtle:    #f7f6f3;
  --border:       #e9e9e7;  --border-faint: #f1f0ef;  --code-bg:      #f7f6f3;
  --link:         #337ea9;  --link-hv:      #2c6e95;  --success:      #448361;
  --fg:           #37352f;  --fg-muted:     #787774;  --code-inline:  rgba(135,131,120,0.15);
  --hr:           #e9e9e7;  --table-alt:    #f7f6f3;  --brd-muted:    #e9e9e7;
  --hl: #37352f; --hl-kw: #d73a49; --hl-fn: #6f42c1; --hl-lit: #005cc5;
  --hl-str: #032f62; --hl-bi: #e36209; --hl-cm: #9b9a97; --hl-tag: #22863a;
  --hl-add-bg: #f0fff4; --hl-del-bg: #ffeef0; --hl-add-fg: #22863a; --hl-del-fg: #b31d28;
  --sb-thumb:     rgba(55,53,47,0.28); --sb-thumb-hv:  rgba(55,53,47,0.45);
  --sb-track:     #f7f6f3;             --sb-track-panel: #f1f1ef;        --sb-track-code: #efeeeb;
}

[data-m="notion"] #toolbar { background: var(--bg); }
[data-m="notion"] .logo-mark {
  background: none; background-clip: initial;
  color: var(--text); -webkit-text-fill-color: var(--text);
}
[data-m="notion"] .logo-mark svg rect { fill: var(--text); }
[data-m="notion"] .file-item.active,
[data-m="notion"] .toc-item a.active {
  color: var(--text); border-left-color: transparent; background: var(--accent-bg);
}
[data-m="notion"] .tab.active {
  color: var(--text); border-color: transparent; background: var(--accent-bg);
}
[data-m="notion"] .tb-btn {
  color: var(--text); background: rgba(55,53,47,0.06); border-color: rgba(55,53,47,0.18);
}
[data-m="notion"] .tb-btn:hover {
  background: rgba(55,53,47,0.1); border-color: rgba(55,53,47,0.24);
  box-shadow: inset 0 0 0 1px rgba(55,53,47,0.08);
}
[data-m="notion"] .tb-btn.on {
  color: var(--text); background: rgba(55,53,47,0.1); border-color: rgba(55,53,47,0.2);
}
[data-m="notion"] .markdown-body blockquote {
  color: var(--text-2); background: transparent; border-left-color: rgba(55,53,47,0.24);
}
[data-m="notion"] .markdown-body h1,
[data-m="notion"] .markdown-body h2,
[data-m="notion"] .markdown-body h3,
[data-m="notion"] .markdown-body h4,
[data-m="notion"] .markdown-body h5,
[data-m="notion"] .markdown-body h6 {
  font-weight: 600;
}
[data-m="notion"] .markdown-body pre {
  border-radius: 4px; border-color: rgba(55,53,47,0.09);
}
[data-m="notion"] .markdown-body table {
  border-radius: 3px; border-color: var(--border);
}
[data-m="notion"] .markdown-body table th {
  border-bottom-width: 1px; font-weight: 500;
}
[data-m="notion"] .markdown-body table td {
  border-bottom-color: var(--border);
}
[data-m="notion"] .markdown-body .task-list-item input[type="checkbox"] { accent-color: #2383e2; }

/* === Linear (cool dark) =====================================================*/
[data-m="linear"] {
  --accent:       #5e6ad2;  --accent-dim:   #4956c3;  --accent-bg:    rgba(94,106,210,0.13);
  --accent-border: rgba(94,106,210,0.3);
  --text:         #e2e2e6;  --text-2:       #b0b0b8;  --text-muted:   #72727a;  --text-faint:   #3a3a42;
  --bg:           #0d0d10;  --bg-panel:     #131318;  --bg-hover:     #1b1b22;  --bg-subtle:    #111116;
  --border:       #1e1e28;  --border-faint: #17171e;  --code-bg:      #0a0a0d;
  --link:         #818cf8;  --link-hv:      #a5b4fc;  --success:      #4ade80;
  --fg:           #e2e2e6;  --fg-muted:     #72727a;  --code-inline:  rgba(255,255,255,0.07);
  --hr:           #1e1e28;  --table-alt:    #111116;  --brd-muted:    #1e1e28;
  --hl: #e2e2e6; --hl-kw: #ff7b72; --hl-fn: #c9a7ff; --hl-lit: #79c0ff;
  --hl-str: #a5d6ff; --hl-bi: #ffa657; --hl-cm: #72727a; --hl-tag: #7ee787;
  --hl-add-bg: rgba(46,160,67,0.15); --hl-del-bg: rgba(248,81,73,0.15);
  --hl-add-fg: #aff5b4; --hl-del-fg: #ffdcd7;
  --sb-thumb:     rgba(255,255,255,0.22); --sb-thumb-hv:  rgba(255,255,255,0.38);
  --sb-track:     #111116;                --sb-track-panel: #17171e;       --sb-track-code: #0d0d10;
}

/* === Tokens (Dark) =========================================================*/
[data-m="dark"] {
  --accent:       #FB923C;
  --accent-dim:   #EA7E28;
  --accent-bg:    rgba(251,146,60,0.1);
  --accent-border: rgba(251,146,60,0.3);
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
  --link:         #61afef;
  --link-hv:      #7ec8e3;
  --success:      #4dac97;
  --fg:           #e8e3dc;
  --fg-muted:     #7e7970;
  --code-inline:  rgba(140,134,124,0.18);
  --hr:           #2e2a26;
  --table-alt:    #1e1c18;
  --brd-muted:    #2e2a26;
  --hl: #e8e3dc; --hl-kw: #ff7b72; --hl-fn: #d2a8ff; --hl-lit: #79c0ff;
  --hl-str: #a5d6ff; --hl-bi: #ffa657; --hl-cm: #7e7970; --hl-tag: #7ee787;
  --hl-add-bg: rgba(46,160,67,0.15); --hl-del-bg: rgba(248,81,73,0.15);
  --hl-add-fg: #aff5b4; --hl-del-fg: #ffdcd7;
  --sb-thumb:     rgba(255,255,255,0.22); --sb-thumb-hv:  rgba(255,255,255,0.38);
  --sb-track:     #1e1c19;                --sb-track-panel: #242019;       --sb-track-code: #181612;
}

/* === Reset =================================================================*/
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; padding: 0;
  background: var(--bg); color: var(--text);
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 15px; line-height: 1.6;
  -webkit-font-smoothing: antialiased; overflow: hidden;
}

/* === Main Toolbar ==========================================================*/
#toolbar {
  position: fixed; inset: 0 0 auto 0; height: 42px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 8px;
  background: var(--vscode-editor-background, var(--bg));
  border-bottom: 1px solid var(--border); z-index: 300; gap: 4px; user-select: none;
}
.tl { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; overflow: hidden; }
.tr { display: flex; align-items: center; gap: 1px; flex-shrink: 0; }
.logo-mark {
  display: inline-flex; align-items: center; gap: 5px;
  font-weight: 700; font-size: 13px; letter-spacing: -0.3px; white-space: nowrap;
  background: linear-gradient(120deg, #F97316 0%, #EF4444 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text; flex-shrink: 0;
}
.logo-mark svg { flex-shrink: 0; filter: none; -webkit-text-fill-color: initial; }
.sep-dot { color: var(--border); font-size: 16px; flex-shrink: 0; line-height: 1; }
.fname {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 11.5px; color: var(--text-muted); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 200px;
}
.ai-badge {
  display: inline-flex; align-items: center; gap: 2px; font-size: 9.5px;
  font-weight: 700; letter-spacing: 0.05em; color: var(--accent);
  background: var(--accent-bg); border: 1px solid var(--accent);
  border-radius: 3px; padding: 1px 4px; white-space: nowrap; flex-shrink: 0; opacity: 0.85;
}
.stats {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 11px; color: var(--text-muted); white-space: nowrap; padding: 0 2px; cursor: default;
}
.stats-accent { color: var(--accent); }
.save-status {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 11px; opacity: 0; transition: opacity 0.2s, color 0.2s;
  white-space: nowrap; flex-shrink: 0;
}
.save-status.saving  { color: var(--text-muted); opacity: 1; }
.save-status.saved   { color: #22c55e; opacity: 1; }

/* Undo/redo diff chip — shows what text was removed/added */
#diff-chip {
  display: none; align-items: center; gap: 3px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10.5px; max-width: 220px; overflow: hidden; white-space: nowrap;
  opacity: 0; transition: opacity 0.2s; flex-shrink: 0;
}
#diff-chip.show { display: inline-flex; opacity: 1; }
.dc-del { color: #ef4444; background: rgba(239,68,68,0.12); border-radius: 3px; padding: 1px 5px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.dc-add { color: #22c55e; background: rgba(34,197,94,0.12); border-radius: 3px; padding: 1px 5px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }

/* Explicit save button — hidden until user enters edit mode */
body:not(.edit-mode) #btn-save-file { display: none; }
#btn-save-file.dirty {
  background: var(--accent); color: #fff; font-weight: 700;
  border-color: var(--accent-dim);
}
#btn-save-file.dirty:hover { background: var(--accent-dim); }

/* Clipboard preview banner */
#clipboard-banner {
  display: none; align-items: center; justify-content: space-between;
  padding: 6px 14px; gap: 8px; flex-shrink: 0;
  background: var(--accent-bg); border-bottom: 1px solid var(--accent-border);
  font-size: 11.5px;
}
#clipboard-banner.open { display: flex; }
.cb-label { color: var(--accent); display: flex; align-items: center; gap: 5px; font-weight: 500; }
.cb-actions { display: flex; gap: 6px; }
.cb-save {
  background: var(--accent); color: #fff; border: none;
  border-radius: 4px; padding: 3px 10px; font-size: 11px; font-family: inherit;
  cursor: pointer; font-weight: 600;
}
.cb-save:hover { opacity: 0.88; }
.cb-dismiss {
  background: transparent; color: var(--text-muted);
  border: 1px solid var(--border); border-radius: 4px;
  padding: 3px 8px; font-size: 11px; font-family: inherit; cursor: pointer;
}
.cb-dismiss:hover { background: var(--bg-hover); color: var(--text); }
.sep-v { width: 1px; height: 16px; background: var(--border); margin: 0 3px; flex-shrink: 0; }
.tb-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px;
  border: 1px solid var(--border-faint); border-radius: 4px; font-size: 11.5px; font-family: inherit;
  cursor: pointer; color: var(--vscode-foreground, var(--text)); background: rgba(127,127,127,0.04);
  white-space: nowrap; transition: background 0.1s, color 0.1s, border-color 0.1s, box-shadow 0.1s; line-height: 1; height: 26px; flex-shrink: 0;
}
.tb-btn:hover { background: var(--vscode-toolbar-hoverBackground, var(--bg-hover)); border-color: var(--border); box-shadow: inset 0 0 0 1px var(--border-faint); }
.tb-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.tb-btn.on { background: var(--accent-bg); color: var(--accent); border-color: var(--accent-border); }
.tb-btn.accent { background: var(--accent); color: #fff; font-weight: 600; }
.tb-btn.accent:hover { background: var(--accent-dim); }
.tb-btn svg { flex-shrink: 0; }

/* === Format Toolbar ========================================================*/
#fmt-toolbar {
  position: fixed; inset: 42px 0 auto 0; height: 36px; display: none;
  align-items: center; padding: 0 8px; gap: 1px;
  background: var(--bg-panel); border-bottom: 1px solid var(--border); z-index: 290;
  overflow-x: auto; overflow-y: hidden;
}
body.edit-mode #fmt-toolbar { display: flex; }
.fmt-group { display: flex; align-items: center; gap: 1px; }
.fmt-sep { width: 1px; height: 18px; background: var(--border); margin: 0 4px; flex-shrink: 0; }
.fmt-btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 28px; height: 26px; padding: 0 5px; border: none; border-radius: 4px;
  font-size: 11.5px; font-family: inherit; cursor: pointer;
  color: var(--text-muted); background: transparent;
  transition: background 0.1s, color 0.1s; white-space: nowrap; flex-shrink: 0;
}
.fmt-btn:hover { background: var(--bg-hover); color: var(--text); }
.fmt-btn.on { background: var(--accent-bg); color: var(--accent); }
.fmt-btn b { font-weight: 800; font-size: 13px; }
.fmt-btn i { font-style: italic; font-size: 13px; }
.fmt-btn s { font-size: 12px; }
.fmt-btn.h-btn { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; letter-spacing: -0.5px; }
.fmt-btn svg { flex-shrink: 0; }

/* === Layout ================================================================*/
#outer-layout { display: flex; margin-top: 42px; height: calc(100vh - 42px); overflow: hidden; }
body.edit-mode #outer-layout { margin-top: 78px; height: calc(100vh - 78px); }

/* === Sidebar ===============================================================*/
#sidebar {
  width: 240px; min-width: 240px; display: flex; flex-direction: column;
  background: var(--bg-panel); border-right: 1px solid var(--border);
  overflow: hidden; transition: width 0.2s ease, min-width 0.2s ease, opacity 0.2s ease; flex-shrink: 0;
}
#sidebar.hidden { width: 0; min-width: 0; opacity: 0; overflow: hidden; }
.sb-section { display: flex; flex-direction: column; border-bottom: 1px solid var(--border); min-height: 0; }
.sb-section.flex-fill { flex: 1; overflow: hidden; }
#sec-files { flex: 0 1 52%; min-height: 138px; overflow: hidden; }
#sec-toc { flex: 1 1 48%; min-height: 150px; overflow: hidden; }
#sidebar.no-toc #sec-files { flex: 1 1 auto; }
.sb-header {
  display: flex; align-items: center; padding: 0 10px 0 12px; height: 32px;
  gap: 4px; flex-shrink: 0; cursor: pointer; user-select: none;
}
.sb-header:hover { background: var(--bg-hover); }
.sb-title { flex: 1; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted); white-space: nowrap; }
.sb-action {
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 3px; font-size: 16px; line-height: 1;
  color: var(--text-muted); background: transparent; cursor: pointer; transition: background 0.1s, color 0.1s; flex-shrink: 0;
}
.sb-action:hover { background: var(--bg-hover); color: var(--accent); }
.sb-chevron { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; color: var(--text-faint); transition: transform 0.15s; flex-shrink: 0; }
.sb-section.collapsed .sb-chevron { transform: rotate(-90deg); }
.sb-body { overflow-y: auto; overflow-x: hidden; padding: 2px 0 8px; }
.sb-section.collapsed .sb-body { display: none; }
.sb-section.collapsed #file-search-wrap { display: none; }
.sb-ai-label { padding: 6px 12px 2px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); opacity: 0.7; font-family: ui-monospace, monospace; }

/* File search input */
#file-search-wrap {
  display: flex; align-items: center; gap: 5px;
  margin: 5px 10px 3px; padding: 4px 8px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 5px; flex-shrink: 0;
}
#file-search-wrap:focus-within { border-color: var(--accent); }
.file-search-icon { opacity: 0.35; flex-shrink: 0; }
#file-search {
  flex: 1; border: none; outline: none; background: transparent;
  font-size: 11.5px; color: var(--text); padding: 0; font-family: inherit;
}
#file-search::placeholder { color: var(--text-faint); }
#file-search-clear {
  display: none; border: none; background: transparent;
  color: var(--text-faint); cursor: pointer; font-size: 14px;
  line-height: 1; padding: 0 1px; border-radius: 3px;
  flex-shrink: 0;
}
#file-search-clear.visible { display: block; }
#file-search-clear:hover { color: var(--text); background: var(--bg-hover); }
.files-empty { padding: 10px 14px; font-size: 11.5px; color: var(--text-faint); line-height: 1.5; }
.files-empty em { color: var(--accent); font-style: normal; font-weight: 600; }

/* Skeleton loader — shown while workspace files are being scanned */
@keyframes sk-pulse { 0%,100% { opacity: 0.35; } 50% { opacity: 0.8; } }
.file-skeleton { padding: 6px 0; }
.sk-row {
  height: 20px; border-radius: 3px; margin: 4px 12px;
  background: var(--bg-hover);
  animation: sk-pulse 1.5s ease-in-out infinite;
}
.sk-row:nth-child(1) { width: 55%; animation-delay: 0s; }
.sk-row:nth-child(2) { width: 80%; animation-delay: 0.12s; }
.sk-row:nth-child(3) { width: 65%; animation-delay: 0.24s; }
.sk-row:nth-child(4) { width: 48%; animation-delay: 0.36s; }
.sk-row:nth-child(5) { width: 72%; animation-delay: 0.48s; }
.sk-row:nth-child(6) { width: 58%; animation-delay: 0.60s; }
.sk-scanning {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px 8px; font-size: 11px; color: var(--text-faint);
}
@keyframes spin { to { transform: rotate(360deg); } }
.sk-spinner {
  width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0;
  border: 1.5px solid var(--border); border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}
.file-dir {
  width: 100%; display: flex; align-items: center; gap: 5px;
  padding: 6px 10px 3px calc(10px + (var(--depth, 0) * 12px));
  border: none; background: transparent; cursor: pointer; text-align: left;
  font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--text-faint); font-family: ui-monospace, monospace; white-space: nowrap;
}
.file-dir:hover { background: var(--bg-hover); color: var(--text-muted); }
.file-dir .folder-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.file-dir .folder-count { opacity: 0.7; font-size: 9px; }
.folder-chevron { width: 10px; height: 10px; transition: transform 0.12s; flex-shrink: 0; }
.file-dir.collapsed .folder-chevron { transform: rotate(-90deg); }
.file-item {
  display: flex; align-items: center; padding: 4px 10px 4px calc(12px + (var(--depth, 0) * 12px)); gap: 6px;
  font-size: 12px; font-family: ui-monospace, monospace; color: var(--text-muted);
  cursor: pointer; border-left: 2px solid transparent;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: none;
}
.file-item:hover { background: var(--bg-hover); color: var(--text); }
.file-item.active { color: var(--accent); border-left-color: var(--accent); background: var(--accent-bg); }
.file-item.ai svg { color: var(--accent); opacity: 0.8; }
.file-item svg { flex-shrink: 0; opacity: 0.45; }
.file-item.active svg { opacity: 1; }
.file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-ai-kind {
  flex-shrink: 0; max-width: 58px; overflow: hidden; text-overflow: ellipsis;
  font-size: 9px; line-height: 1; color: var(--accent);
  background: var(--accent-bg); border: 1px solid var(--accent-border);
  border-radius: 3px; padding: 2px 4px;
}
.toc-item { list-style: none; margin: 0; padding: 0; }
.toc-item a {
  display: block; padding: 3px 12px 3px 10px; color: var(--text-muted); text-decoration: none;
  border-left: 2px solid transparent; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: color 0.1s, background 0.1s, border-color 0.1s; line-height: 1.5; font-size: 12.5px;
}
.toc-item a:hover { color: var(--text); background: var(--bg-hover); }
.toc-item a.active { color: var(--accent); border-left-color: var(--accent); background: var(--accent-bg); }
.toc-item.h1 a { padding-left: 10px; font-weight: 600; }
.toc-item.h2 a { padding-left: 18px; }
.toc-item.h3 a { padding-left: 28px; font-size: 12px; }
.toc-item.h4 a { padding-left: 36px; font-size: 11.5px; }
.toc-item.h5 a, .toc-item.h6 a { padding-left: 44px; font-size: 11px; }

/* === Main / Edit ===========================================================*/
#main-col { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
#main { flex: 1; display: flex; overflow: hidden; }
#scroller { flex: 1; overflow-y: auto; overflow-x: hidden; }
#edit-area, #split-preview, #split-resizer { display: none; }
body.edit-mode #scroller { display: none; }
body.edit-mode #edit-area {
  display: block; flex: 0 0 var(--edit-pane-width, 50%); min-width: 260px; padding: 24px 28px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 13.5px; line-height: 1.8; color: var(--text); background: var(--bg);
  border: none; border-right: 1px solid var(--border); outline: none; resize: none;
  overflow-y: auto; tab-size: 2; caret-color: var(--accent); white-space: pre-wrap;
}
body.edit-mode #split-preview { display: block; flex: 1; overflow-y: auto; }
body.edit-mode #split-resizer {
  display: block; width: 7px; flex: 0 0 7px; cursor: col-resize;
  background: var(--bg-panel); border-left: 1px solid var(--border); border-right: 1px solid var(--border);
}
body.edit-mode #split-resizer:hover,
body.resizing-split #split-resizer { background: var(--accent-bg); }

/* === Frontmatter ============================================================*/
.fm-panel {
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 14px; margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 4px 16px;
  font-size: 12px; font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
.fm-item { display: flex; gap: 3px; }
.fm-key { color: var(--text-muted); }
.fm-colon { color: var(--text-faint); }
.fm-val { color: var(--text); }

/* === GitHub Alerts =========================================================*/
.gh-alert { padding: 12px 16px; margin: 0 0 16px; border-radius: 6px; border-left: 4px solid; }
.gh-alert-title { font-weight: 600; font-size: 13.5px; margin: 0 0 8px; display: flex; align-items: center; gap: 6px; }
.gh-alert p { color: var(--text); margin: 0 0 8px; }
.gh-alert p:last-child { margin-bottom: 0; }
.gh-alert.note      { background: rgba(9,105,218,.07);  border-color: #0969da; }
.gh-alert.note .gh-alert-title { color: #0969da; }
.gh-alert.tip       { background: rgba(26,127,55,.07);  border-color: #1a7f37; }
.gh-alert.tip .gh-alert-title { color: #1a7f37; }
.gh-alert.important { background: rgba(130,80,223,.07); border-color: #8250df; }
.gh-alert.important .gh-alert-title { color: #8250df; }
.gh-alert.warning   { background: rgba(154,103,0,.07);  border-color: #9a6700; }
.gh-alert.warning .gh-alert-title { color: #9a6700; }
.gh-alert.caution   { background: rgba(207,34,46,.07);  border-color: #cf222e; }
.gh-alert.caution .gh-alert-title { color: #cf222e; }
[data-m="dark"] .gh-alert.note      { background: rgba(31,111,235,.12);  border-color: #1f6feb; }
[data-m="dark"] .gh-alert.note .gh-alert-title { color: #58a6ff; }
[data-m="dark"] .gh-alert.tip       { background: rgba(63,185,80,.12);   border-color: #3fb950; }
[data-m="dark"] .gh-alert.tip .gh-alert-title { color: #3fb950; }
[data-m="dark"] .gh-alert.important { background: rgba(163,113,247,.12); border-color: #a371f7; }
[data-m="dark"] .gh-alert.important .gh-alert-title { color: #a371f7; }
[data-m="dark"] .gh-alert.warning   { background: rgba(210,153,34,.12);  border-color: #d29922; }
[data-m="dark"] .gh-alert.warning .gh-alert-title { color: #d29922; }
[data-m="dark"] .gh-alert.caution   { background: rgba(248,81,73,.12);   border-color: #f85149; }
[data-m="dark"] .gh-alert.caution .gh-alert-title { color: #f85149; }

/* === Quick Open (Cmd+K) ====================================================*/
#quick-open {
  position: fixed; inset: 0; z-index: 600; display: none;
  align-items: flex-start; justify-content: center; padding-top: 72px;
}
#quick-open.open { display: flex; }
.qo-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.38); backdrop-filter: blur(3px); }
.qo-panel {
  position: relative; width: 520px; max-height: 400px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.32); overflow: hidden;
  display: flex; flex-direction: column;
}
#qo-input {
  width: 100%; padding: 14px 16px; font-size: 13.5px; font-family: inherit;
  border: none; border-bottom: 1px solid var(--border);
  background: transparent; color: var(--text); outline: none;
}
#qo-input::placeholder { color: var(--text-faint); }
.qo-hint {
  padding: 6px 16px 0; font-size: 10.5px; color: var(--text-faint);
  font-family: ui-monospace, monospace;
}
.qo-results { overflow-y: auto; padding: 6px; flex: 1; }
.qo-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-radius: 6px; cursor: pointer; color: var(--text-muted);
  font-size: 12px; font-family: ui-monospace, monospace; transition: background 0.08s;
}
.qo-item:hover, .qo-item.selected { background: var(--accent-bg); color: var(--text); }
.qo-item.ai { }
.qo-item.ai .qo-name, .qo-item.selected .qo-name { color: var(--text); }
.qo-name { font-weight: 500; }
.qo-path { opacity: 0.55; font-size: 11px; flex: 1; text-align: right; }
.qo-empty { padding: 24px; text-align: center; color: var(--text-faint); font-size: 13px; }

/* === Keyboard Shortcuts Panel ==============================================*/
#shortcuts-panel {
  position: fixed; inset: 0; z-index: 600; display: none;
  align-items: center; justify-content: center;
}
#shortcuts-panel.open { display: flex; }
.sp-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(3px); }
.sp-card {
  position: relative; width: 540px; max-height: 72vh;
  background: var(--bg); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.32); overflow-y: auto; padding: 24px 28px;
}
.sp-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.sp-title { font-size: 15px; font-weight: 700; margin: 0; }
.sp-close { border: none; background: transparent; cursor: pointer; color: var(--text-muted); font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 4px; }
.sp-close:hover { background: var(--bg-hover); color: var(--text); }
.sp-section { margin-bottom: 18px; }
.sp-section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); margin: 0 0 8px; }
.sp-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--border-faint); font-size: 13px; }
.sp-row:last-child { border-bottom: none; }
.sp-keys { display: flex; gap: 3px; }
.sp-key { font-family: ui-monospace, monospace; font-size: 11px; padding: 2px 6px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: 4px; color: var(--text); white-space: nowrap; }
.sp-desc { color: var(--text-muted); }

/* === Markdown body =========================================================*/
.markdown-body { max-width: 780px; margin: 0 auto; padding: 32px 36px 100px; word-wrap: break-word; }
.markdown-body h1,.markdown-body h2,.markdown-body h3,
.markdown-body h4,.markdown-body h5,.markdown-body h6 {
  margin-top: 1.5em; margin-bottom: .4em; font-weight: 700; line-height: 1.25; color: var(--text); position: relative;
}
.markdown-body h1:first-child,.markdown-body h2:first-child,.markdown-body h3:first-child { margin-top: 0; }
.markdown-body h1 { font-size: 2em; }
.markdown-body h2 { font-size: 1.5em; padding-bottom: .35em; border-bottom: 1px solid var(--border); }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1em; }
.markdown-body h5 { font-size: .875em; }
.markdown-body h6 { font-size: .85em; color: var(--text-muted); }
.h-anchor {
  opacity: 0; font-size: .65em; font-weight: 400; margin-left: 8px;
  color: var(--text-faint); text-decoration: none; transition: opacity 0.15s; vertical-align: middle;
}
h1:hover .h-anchor,h2:hover .h-anchor,h3:hover .h-anchor,
h4:hover .h-anchor,h5:hover .h-anchor,h6:hover .h-anchor { opacity: 1; }
.h-anchor:hover { color: var(--accent); }
.markdown-body p { margin-top: 0; margin-bottom: 16px; line-height: 1.75; }
.markdown-body strong { font-weight: 600; }
.markdown-body em { font-style: italic; }
.markdown-body del { text-decoration: line-through; color: var(--text-muted); }
.markdown-body a { color: var(--link); text-decoration: none; }
.markdown-body a:hover { color: var(--link-hv); text-decoration: underline; }
.markdown-body code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 85%; padding: .2em .4em; background: var(--code-inline); border-radius: 4px; }
.markdown-body pre { position: relative; margin: 0 0 16px; padding: 16px; overflow: auto; font-size: 84%; line-height: 1.65; background: var(--code-bg); border-radius: 8px; border: 1px solid var(--border); }
.markdown-body pre code { padding: 0; margin: 0; background: transparent; border-radius: 0; font-size: 100%; white-space: pre; word-break: normal; overflow-wrap: normal; color: inherit; }
.copy-btn {
  padding: 3px 6px; font-size: 11px; font-family: inherit;
  border: none; border-radius: 4px; background: transparent; color: var(--text-muted);
  cursor: pointer; transition: color 0.15s, background 0.15s;
  display: flex; align-items: center; gap: 3px; line-height: 1.5; white-space: nowrap;
}
.copy-btn:hover { color: var(--text); background: var(--bg-hover); }
.copy-btn.done { color: var(--success); }
.markdown-body blockquote { margin: 0 0 16px; padding: 10px 16px; color: var(--text-muted); border-left: 3px solid var(--accent); background: var(--accent-bg); border-radius: 0 6px 6px 0; }
.markdown-body blockquote > :first-child { margin-top: 0; }
.markdown-body blockquote > :last-child { margin-bottom: 0; }
.markdown-body ul,.markdown-body ol { margin-top: 0; margin-bottom: 16px; padding-left: 2em; }
.markdown-body ul ul,.markdown-body ul ol,.markdown-body ol ul,.markdown-body ol ol { margin: 0; }
.markdown-body li { word-wrap: break-all; }
.markdown-body li + li { margin-top: .25em; }
.markdown-body li > p { margin-top: 16px; }
.markdown-body .task-list-item { list-style-type: none; }
.markdown-body .task-list-item input[type="checkbox"] { margin: 0 .5em 0 -1.6em; vertical-align: middle; accent-color: var(--accent); }
.markdown-body img { max-width: 100%; border-style: none; border-radius: 6px; }
.markdown-body hr { height: 1px; padding: 0; margin: 24px 0; background: var(--border); border: 0; }
.table-wrap { position: relative; margin-bottom: 16px; overflow-x: auto; }
/* Button group for table — flex row at top-right, same hover-reveal pattern as Mermaid */
.el-btn-group {
  position: absolute; top: 5px; right: 5px; z-index: 2;
  display: flex; gap: 3px; align-items: center;
  opacity: 0; transition: opacity 0.15s;
}
.table-wrap:hover .el-btn-group,
pre:hover .el-btn-group { opacity: 1; }
/* Buttons inside a group don't need absolute positioning */
.el-btn-group .copy-btn { position: static; opacity: 1; }
.img-copy-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 6px; font-size: 11px; font-family: inherit;
  border: none; border-radius: 4px; background: transparent; color: var(--text-muted);
  cursor: pointer; transition: color 0.15s, background 0.15s; line-height: 1.5; white-space: nowrap;
}
.img-copy-btn:hover { color: var(--text); background: var(--bg-hover); }
.img-copy-btn.done { color: var(--success); }
.markdown-body table { border-spacing: 0; border-collapse: collapse; display: block; width: max-content; max-width: 100%; overflow: auto; margin-bottom: 0; border-radius: 6px; border: 1px solid var(--border); }
.markdown-body table th { font-weight: 600; padding: 8px 14px; border-bottom: 2px solid var(--border); text-align: left; background: var(--bg-subtle); }
.markdown-body table td { padding: 7px 14px; border-bottom: 1px solid var(--border-faint); }
.markdown-body table tr:last-child td { border-bottom: none; }
.markdown-body table tr:nth-child(2n) td { background: var(--bg-subtle); }

/* Rich-copy toast — shown briefly when Cmd+C copies formatted content */
#rich-copy-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(8px);
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px;
  padding: 6px 14px; font-size: 11.5px; color: var(--text-muted);
  z-index: 9999; pointer-events: none; opacity: 0;
  transition: opacity 0.18s ease, transform 0.18s ease;
  white-space: nowrap;
}
#rich-copy-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.markdown-body kbd { display: inline-block; padding: 3px 5px; font-family: ui-monospace, monospace; font-size: 11px; line-height: 10px; color: var(--text); vertical-align: middle; background: var(--bg-subtle); border: 1px solid var(--border); border-radius: 4px; box-shadow: inset 0 -1px 0 var(--border); }
.markdown-body details { display: block; margin-bottom: 16px; }
.markdown-body details summary { display: list-item; cursor: pointer; font-weight: 600; }
/* Mermaid diagrams */
.mermaid-wrap { margin-bottom: 16px; position: relative; }
.mermaid { text-align: center; overflow-x: auto; cursor: zoom-in; }
/* Button group — floats top-right on hover, contains Copy + Expand */
.mermaid-btn-group {
  position: absolute; top: 8px; right: 8px;
  display: flex; gap: 4px; align-items: center;
  opacity: 0; transition: opacity 0.15s;
}
.mermaid-wrap:hover .mermaid-btn-group { opacity: 1; }
.mermaid-zoom-btn, .mermaid-copy-btn {
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 6px; padding: 3px 8px; font-size: 11px;
  color: var(--text-muted); cursor: pointer; line-height: 1.4; white-space: nowrap;
}
.mermaid-zoom-btn:hover, .mermaid-copy-btn:hover { background: var(--bg-hover); color: var(--text); }

/* Mermaid fullscreen modal */
.mermaid-modal {
  display: none; position: fixed; inset: 0; z-index: 9999;
  align-items: center; justify-content: center;
}
.mermaid-modal.open { display: flex; }
.mermaid-modal-backdrop {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
}
.mermaid-modal-box {
  position: relative; z-index: 1;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 12px; box-shadow: 0 24px 64px rgba(0,0,0,0.4);
  width: 96vw; height: 92vh;
  display: flex; flex-direction: column; overflow: hidden;
}
.mermaid-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
  font-size: 12px; color: var(--text-muted); flex-shrink: 0;
}
.mermaid-modal-controls { display: flex; gap: 6px; align-items: center; }
.mermaid-modal-controls button {
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 6px; padding: 3px 10px; font-size: 13px;
  color: var(--text); cursor: pointer; line-height: 1.4;
}
.mermaid-modal-controls button:hover { background: var(--bg-hover); }
.mermaid-modal-controls .zoom-level {
  font-size: 11px; color: var(--text-muted); min-width: 36px; text-align: center;
}
.mermaid-modal-body {
  /* flex-centering keeps every diagram centred; overflow:auto scrolls when zoomed in */
  overflow: auto; padding: 20px; flex: 1;
  display: flex; justify-content: center; align-items: flex-start;
}
.mermaid-modal-body .mermaid-zoom-inner {
  /* pixel-sized by JS (nw*zoom × nh*zoom) — shrinks and grows for real scrollbars */
  flex-shrink: 0;
}
.mermaid-modal-body .mermaid-zoom-inner svg {
  /* pixel size set by JS; viewBox handles aspect-ratio scaling */
  display: block;
  transition: width 0.12s ease, height 0.12s ease;
}
.mermaid-modal-close {
  background: none; border: none; font-size: 18px; line-height: 1;
  color: var(--text-muted); cursor: pointer; padding: 2px 6px; border-radius: 4px;
}
.mermaid-modal-close:hover { background: var(--bg-hover); color: var(--text); }

/* === Highlight.js ==========================================================*/
.hljs { color: var(--hl); background: transparent; }
.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_ { color: var(--hl-kw); }
.hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_ { color: var(--hl-fn); }
.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-variable,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id { color: var(--hl-lit); }
.hljs-regexp,.hljs-string,.hljs-meta .hljs-string { color: var(--hl-str); }
.hljs-built_in,.hljs-symbol { color: var(--hl-bi); }
.hljs-comment,.hljs-code,.hljs-formula { color: var(--hl-cm); font-style: italic; }
.hljs-name,.hljs-quote,.hljs-selector-tag,.hljs-selector-pseudo { color: var(--hl-tag); }
.hljs-subst { color: var(--hl); }
.hljs-section { color: var(--hl-lit); font-weight: bold; }
.hljs-bullet { color: var(--hl-bi); }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
.hljs-addition { color: var(--hl-add-fg); background: var(--hl-add-bg); }
.hljs-deletion { color: var(--hl-del-fg); background: var(--hl-del-bg); }

/* === Back to top ===========================================================*/
#top-btn {
  position: fixed; bottom: 24px; right: 20px; width: 34px; height: 34px; border-radius: 50%;
  border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); cursor: pointer;
  display: flex; align-items: center; justify-content: center; opacity: 0; transform: translateY(10px);
  transition: opacity 0.2s, transform 0.2s, background 0.15s; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}
#top-btn.show { opacity: 1; transform: translateY(0); }
#top-btn:hover { background: var(--accent-bg); color: var(--accent); border-color: var(--accent); }

/* === Focus mode ============================================================*/
body.focus-mode #sidebar { width: 0; min-width: 0; opacity: 0; overflow: hidden; }
body.focus-mode .markdown-body { max-width: 720px; font-size: 16.5px; line-height: 1.85; }

/* === Scrollbar =============================================================*/
* { scrollbar-width: thin; scrollbar-color: var(--sb-thumb) var(--sb-track); }
#sidebar *, #toc-body { scrollbar-color: var(--sb-thumb) var(--sb-track-panel); }
#edit-area, #scroller, #split-preview, #fmt-toolbar, .qo-results, .sp-card,
.mermaid, .markdown-body table, pre { scrollbar-gutter: stable; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--sb-track); }
::-webkit-scrollbar-thumb { background: var(--sb-thumb); border: 2px solid var(--sb-track); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: var(--sb-thumb-hv); }
#sidebar ::-webkit-scrollbar-track,
#toc-body::-webkit-scrollbar-track { background: var(--sb-track-panel); }
#sidebar ::-webkit-scrollbar-thumb,
#toc-body::-webkit-scrollbar-thumb { border-color: var(--sb-track-panel); }
#edit-area::-webkit-scrollbar-track { background: var(--sb-track); }
pre::-webkit-scrollbar-track { background: var(--sb-track-code); }
pre::-webkit-scrollbar-thumb { border-color: var(--sb-track-code); }
pre::-webkit-scrollbar { height: 8px; }

/* === Theme Picker ===========================================================*/
.theme-picker-wrap { position: relative; }
#theme-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 500;
  background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.22); padding: 6px; min-width: 154px;
  display: none; flex-direction: column; gap: 1px;
}
#theme-menu.open { display: flex; }
.theme-opt {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border: none; border-radius: 6px; font-size: 12.5px; font-family: inherit;
  cursor: pointer; color: var(--text-muted); background: transparent;
  text-align: left; width: 100%; transition: background 0.1s, color 0.1s;
}
.theme-opt:hover { background: var(--bg-hover); color: var(--text); }
.theme-opt.active { background: var(--accent-bg); color: var(--accent); font-weight: 600; }
.theme-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

/* === Tab Bar ================================================================*/
#tab-bar {
  position: fixed; inset: 42px 0 auto 0; height: 36px;
  display: none; align-items: center;
  background: var(--bg-panel); border-bottom: 1px solid var(--border);
  overflow-x: auto; overflow-y: hidden; z-index: 285; padding: 0 6px; gap: 2px;
}
#tab-bar::-webkit-scrollbar { height: 0; width: 0; }
body.has-tabs #tab-bar { display: flex; }
body.has-tabs #outer-layout { margin-top: 78px; height: calc(100vh - 78px); }
body.has-tabs.edit-mode #outer-layout { margin-top: 114px; height: calc(100vh - 114px); }
body.has-tabs #fmt-toolbar { top: 78px; }
.tab {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 0 6px 0 9px; height: 26px; border-radius: 5px;
  font-size: 11.5px; font-family: ui-monospace, monospace;
  color: var(--text-muted); cursor: pointer; flex-shrink: 0;
  border: 1px solid transparent; transition: background 0.1s, color 0.1s;
  white-space: nowrap; max-width: 168px; background: transparent; user-select: none;
}
.tab:hover { background: var(--bg-hover); color: var(--text); }
.tab.active { background: var(--accent-bg); color: var(--accent); border-color: var(--accent-border); }
.tab-ai { font-size: 9px; opacity: 0.8; }
.tab-name { overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
.tab-close {
  border: none; background: transparent; cursor: pointer; color: var(--text-faint);
  font-size: 13px; line-height: 1; padding: 0; width: 16px; height: 16px;
  display: flex; align-items: center; justify-content: center; border-radius: 3px;
  flex-shrink: 0; transition: background 0.1s, color 0.1s; margin-left: 2px;
}
.tab-close:hover { background: var(--bg-hover); color: var(--text); }

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
  const scriptNonce = document.currentScript?.nonce || '';

  let currentMarkdown = (typeof __MD__ !== 'undefined') ? __MD__ : '';
  let filesCache  = (typeof __FILES__ !== 'undefined') ? [...__FILES__] : [];
  let filesLoading = (typeof __FILES_LOADING__ !== 'undefined') ? __FILES_LOADING__ : false;
  let currentUri = (typeof __CURRENT_URI__ !== 'undefined') ? __CURRENT_URI__ : '';
  let editMode    = false;
  let wordWrap    = true;
  let isDirty     = false;   // true when there are unsaved changes on disk
  let editTimer, saveTimer;
  const collapsedFolders = new Set();
  let fileFilter = '';       // live search query for the Notebooks panel

  // ── Custom undo / redo history ─────────────────────────────────────────────
  // document.execCommand('undo') is deprecated and unreliable in VS Code's webview.
  // We maintain our own stack of { value, ss (selStart), se (selEnd) } snapshots.
  const HIST_MAX = 100;
  const histStack = [];
  let histIdx  = -1;
  let histBusy = false;   // prevents re-entrancy while we're restoring a snap
  let histSnapTimer = null;

  function qs(s, c)  { return (c || document).querySelector(s); }
  function qsa(s, c) { return [...(c || document).querySelectorAll(s)]; }
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function autoEditKey(uri) { return 'markr-autoedit-dismissed:' + (uri || currentUri || ''); }
  function isAutoEditDismissed(uri) {
    try { return sessionStorage.getItem(autoEditKey(uri)) === '1'; } catch { return false; }
  }
  function setAutoEditDismissed(uri, dismissed) {
    try {
      const key = autoEditKey(uri);
      if (dismissed) sessionStorage.setItem(key, '1');
      else sessionStorage.removeItem(key);
    } catch {}
  }

  // ── Live stats ─────────────────────────────────────────────────────────────
  function countWords(text) {
    return text
      .replace(/\`\`\`[\s\S]*?\`\`\`/g, ' ')
      .replace(/\`[^\`]+\`/g, ' ')
      .replace(/^\s*#{1,6}\s/gm, '')
      .replace(/!?\\[([^\\]]*)\\]\\([^)]*\\)/g, '$1')
      .replace(/[*_~>|\\\\]/g, ' ')
      .split(/\\s+/).filter(w => w.trim().length > 0).length;
  }
  function updateStats(text) {
    const words  = countWords(text);
    const chars  = text.length;
    const mins   = Math.max(1, Math.ceil(words / 200));
    const tokens = Math.round(chars / 4);
    const tokStr = tokens < 1000 ? tokens + ' tok' : '~' + (tokens/1000).toFixed(1) + 'K tok';
    const wEl = qs('#stat-words'), tEl = qs('#stat-time'), cEl = qs('#stat-tok');
    if (wEl) wEl.textContent = words.toLocaleString();
    if (tEl) tEl.textContent = mins;
    if (cEl) { cEl.textContent = tokStr; cEl.title = chars.toLocaleString() + ' characters'; }
  }

  // ── Save indicator ─────────────────────────────────────────────────────────
  function showSaving() {
    const el = qs('#save-status');
    if (el) { el.textContent = '· saving…'; el.className = 'save-status saving'; }
  }
  function showSaved() {
    const el = qs('#save-status');
    if (!el) return;
    el.textContent = '✓ saved';
    el.className = 'save-status saved';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { el.className = 'save-status'; }, 2500);
    markClean(); // file is now on disk — clear the dirty indicator
  }

  // ── Dirty / save tracking ──────────────────────────────────────────────────
  function markDirty() {
    isDirty = true;
    const btn = qs('#btn-save-file');
    if (!btn) return;
    btn.classList.add('dirty');
    btn.innerHTML = '● Save';
    btn.title = 'Unsaved changes — click to save (⌘S / Ctrl+S)';
  }
  function markClean() {
    isDirty = false;
    const btn = qs('#btn-save-file');
    if (!btn) return;
    btn.classList.remove('dirty');
    btn.innerHTML = 'Save';
    btn.title = 'Save (⌘S / Ctrl+S)';
  }
  function saveFile() {
    if (!isDirty) return;
    showSaving();
    clearTimeout(editTimer);
    const ta = qs('#edit-area');
    const content = ta ? ta.value : currentMarkdown;
    vsc.postMessage({ type: 'saveFile', content, uri: activeTabUri });
  }

  // ── Diff chip — shows what was removed/added after undo/redo ──────────────
  function showDiffChip(oldVal, newVal) {
    // Find the changed region via longest common prefix + suffix
    let i = 0;
    while (i < oldVal.length && i < newVal.length && oldVal[i] === newVal[i]) i++;
    let j = 0;
    const maxJ = Math.min(oldVal.length - i, newVal.length - i);
    while (j < maxJ && oldVal[oldVal.length - 1 - j] === newVal[newVal.length - 1 - j]) j++;
    const removed = oldVal.slice(i, oldVal.length - (j || 0));
    const added   = newVal.slice(i, newVal.length - (j || 0));
    const el = qs('#diff-chip'); if (!el) return;
    let html = '';
    if (removed) {
      const txt = removed.replace(/\\n/g, '↵').replace(/\\t/g, '→');
      html += '<span class="dc-del">−' + escHtml(txt.length > 35 ? txt.slice(0, 35) + '…' : txt) + '</span>';
    }
    if (added) {
      const txt = added.replace(/\\n/g, '↵').replace(/\\t/g, '→');
      html += '<span class="dc-add">+' + escHtml(txt.length > 35 ? txt.slice(0, 35) + '…' : txt) + '</span>';
    }
    if (!html) return;
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.classList.remove('show'); }, 3000);
  }

  // Capture a snapshot. Called before programmatic edits (format, etc.) and
  // on a 600 ms debounce during regular typing so rapid keystrokes are grouped.
  function snapHistory() {
    if (histBusy) return;
    const ta = qs('#edit-area'); if (!ta) return;
    const snap = { value: ta.value, ss: ta.selectionStart, se: ta.selectionEnd };
    // Trim the redo branch whenever a new edit comes in
    histStack.splice(histIdx + 1);
    const last = histStack[histIdx];
    if (last && last.value === snap.value) return; // nothing changed
    histStack.push(snap);
    if (histStack.length > HIST_MAX) { histStack.shift(); } else { histIdx++; }
  }
  function scheduleSnap() {
    clearTimeout(histSnapTimer);
    histSnapTimer = setTimeout(snapHistory, 600);
  }

  function applyHistSnap(snap, prevSnap) {
    const ta = qs('#edit-area'); if (!ta || !snap) return;
    histBusy = true;
    ta.value = snap.value;
    ta.setSelectionRange(snap.ss, snap.se);
    ta.focus();
    histBusy = false;
    currentMarkdown = snap.value;
    updateStats(snap.value);
    showSaving();
    if (prevSnap) showDiffChip(prevSnap.value, snap.value);
    clearTimeout(editTimer);
    editTimer = setTimeout(() => vsc.postMessage({ type: 'edit', content: snap.value, uri: activeTabUri }), 120);
    updateToolbarState();
  }

  function histUndo() {
    if (histIdx <= 0) return;
    const prev = histStack[histIdx];
    histIdx--;
    applyHistSnap(histStack[histIdx], prev);
  }
  function histRedo() {
    if (histIdx >= histStack.length - 1) return;
    const prev = histStack[histIdx];
    histIdx++;
    applyHistSnap(histStack[histIdx], prev);
  }
  function resetHistory() {
    histStack.length = 0; histIdx = -1; histBusy = false;
    clearTimeout(histSnapTimer);
  }

  // ── File list ──────────────────────────────────────────────────────────────
  function renderFileList(files) {
    const container = qs('#files-list');
    if (!container) return;

    // ── Loading state: animated skeleton rows ──────────────────────────────
    if (filesLoading) {
      container.innerHTML =
        '<div class="file-skeleton">' +
        '<div class="sk-row"></div><div class="sk-row"></div><div class="sk-row"></div>' +
        '<div class="sk-row"></div><div class="sk-row"></div><div class="sk-row"></div>' +
        '</div>' +
        '<div class="sk-scanning"><div class="sk-spinner"></div>Scanning workspace…</div>';
      return;
    }

    // ── Filter: apply search query ─────────────────────────────────────────
    let displayFiles = files || [];
    if (fileFilter) {
      const q = fileFilter.toLowerCase();
      displayFiles = displayFiles.filter(f =>
        f.label.toLowerCase().includes(q) || (f.relPath || '').toLowerCase().includes(q)
      );
    }

    if (!displayFiles.length) {
      container.innerHTML = fileFilter
        ? '<div class="files-empty">No files matching <em>' + escHtml(fileFilter) + '</em></div>'
        : '<div class="files-empty">No .md files in workspace</div>';
      return;
    }

    const aiFiles    = displayFiles.filter(f => f.isAiConfig);
    const otherFiles = displayFiles.filter(f => !f.isAiConfig);
    let html = '';
    if (aiFiles.length) {
      html += '<div class="sb-ai-label">✦ AI Docs</div>';
      aiFiles.forEach(f => { html += fileItemHtml(f); });
    }

    if (fileFilter) {
      // Flat list when filtering — skip folder tree grouping
      if (otherFiles.length) {
        if (aiFiles.length) html += '<div class="sb-ai-label" style="margin-top:4px;color:var(--text-faint)">Other</div>';
        otherFiles.forEach(f => { html += fileItemHtml(f, 0); });
      }
    } else {
      // Normal grouped folder-tree view
      const tree = buildFileTree(otherFiles);
      if (tree.files.length) {
        if (aiFiles.length) html += '<div class="sb-ai-label" style="margin-top:4px;color:var(--text-faint)">Other</div>';
        tree.files.forEach(f => { html += fileItemHtml(f, 0); });
      }
      html += renderTree(tree, 0);
    }

    container.innerHTML = html;

    // Attach click listeners (same for filtered and normal modes)
    qsa('.file-dir', container).forEach(el => {
      el.addEventListener('click', () => {
        const dir = el.getAttribute('data-dir');
        if (!dir) return;
        if (collapsedFolders.has(dir)) collapsedFolders.delete(dir);
        else collapsedFolders.add(dir);
        renderFileList(filesCache);
      });
    });
    qsa('.file-item', container).forEach(el => {
      el.addEventListener('click', () => {
        const uri = el.getAttribute('data-uri');
        if (!uri) return;
        if (editMode) flushEdit();
        // If already loaded in a tab, switch instantly — no extension round-trip
        if (tabs.find(t => t.uri === uri)) { switchToTab(uri); return; }
        vsc.postMessage({ type: 'openFile', uri });
      });
    });
  }
  function buildFileTree(files) {
    const root = { name: '', path: '', files: [], dirs: {} };
    files.forEach(f => {
      let node = root;
      (f.dir || '').split('/').filter(Boolean).forEach(part => {
        const path = node.path ? node.path + '/' + part : part;
        if (!node.dirs[part]) node.dirs[part] = { name: part, path, files: [], dirs: {} };
        node = node.dirs[part];
      });
      node.files.push(f);
    });
    return root;
  }
  function treeCount(node) {
    return node.files.length + Object.keys(node.dirs).reduce((sum, key) => sum + treeCount(node.dirs[key]), 0);
  }
  function renderTree(node, depth) {
    return Object.keys(node.dirs).sort().map(name => {
      const child = node.dirs[name];
      const collapsed = collapsedFolders.has(child.path);
      let html = '<button class="file-dir' + (collapsed ? ' collapsed' : '') + '" data-dir="' + escHtml(child.path) + '" style="--depth:' + depth + '">'
        + '<span class="folder-chevron">▾</span><span class="folder-name">' + escHtml(child.name) + '</span>'
        + '<span class="folder-count">' + treeCount(child) + '</span></button>';
      if (!collapsed) {
        child.files.sort((a, b) => a.label.localeCompare(b.label)).forEach(f => { html += fileItemHtml(f, depth + 1); });
        html += renderTree(child, depth + 1);
      }
      return html;
    }).join('');
  }
  // Fast active-indicator update — no DOM rebuild, just toggle a class
  function updateFileListActive(uri) {
    filesCache.forEach(f => { f.active = f.uri === uri; });
    qsa('.file-item', qs('#files-list')).forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-uri') === uri);
    });
  }

  function fileItemHtml(f, depth = 0) {
    const icon = f.isAiConfig
      ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>'
      : '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h8l4 4v8H2V2z" opacity=".4"/><path d="M10 2v4h4"/></svg>';
    return '<div class="file-item' + (f.active ? ' active' : '') + (f.isAiConfig ? ' ai' : '')
      + '" data-uri="' + escHtml(f.uri) + '" title="' + escHtml(f.relPath) + '" style="--depth:' + depth + '">'
      + icon + '<span class="file-name">' + escHtml(f.label) + '</span>'
      + (f.aiKind ? '<span class="file-ai-kind">' + escHtml(f.aiKind) + '</span>' : '') + '</div>';
  }

  // ── TOC ────────────────────────────────────────────────────────────────────
  function buildTOC() {
    const hs = qsa('.markdown-body h1,h2,h3,h4,h5,h6');
    const body = qs('#toc-body');
    if (!body) return;
    const sidebar = qs('#sidebar');
    const section = qs('#sec-toc');
    if (!hs.length) {
      if (section) section.style.display = 'none';
      sidebar?.classList.add('no-toc');
      return;
    }
    if (section) section.style.display = '';
    sidebar?.classList.remove('no-toc');
    body.innerHTML = '';
    hs.forEach(h => {
      const li = document.createElement('li');
      li.className = 'toc-item h' + h.tagName[1];
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = (h.textContent || '').replace(/#\\s*$/, '').trim();
      a.addEventListener('click', e => {
        e.preventDefault();
        if (editMode) { scrollEditorToId(h.id); }
        else { h.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      });
      li.appendChild(a);
      body.appendChild(li);
    });
  }
  function scrollEditorToId(id) {
    const ta = qs('#edit-area'); if (!ta) return;
    const lines = ta.value.split('\\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^#{1,6}\\s+(.+)/); if (!m) continue;
      const slug = m[1].toLowerCase().replace(/<[^>]+>/g,'').replace(/[^\\w\\s-]/g,'').replace(/[\\s_]+/g,'-').replace(/^-+|-+$/g,'');
      if (slug !== id) continue;
      const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 24;
      ta.scrollTop = Math.max(0, (i - 3) * lineH);
      const pos = lines.slice(0, i).reduce((a, l) => a + l.length + 1, 0);
      ta.focus(); ta.setSelectionRange(pos, pos + lines[i].length);
      return;
    }
  }

  // ── Scroll spy ─────────────────────────────────────────────────────────────
  function setupScrollSpy() {
    const scroller = qs('#scroller'); if (!scroller) return;
    const hs = qsa('.markdown-body h1,h2,h3,h4,h5,h6'); if (!hs.length) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const link = qs('#toc-body a[href="#' + entry.target.id + '"]'); if (!link) return;
        if (entry.isIntersecting) {
          qsa('#toc-body a').forEach(a => a.classList.remove('active'));
          link.classList.add('active'); link.scrollIntoView({ block: 'nearest' });
        }
      });
    }, { root: scroller, rootMargin: '-10% 0% -70% 0%', threshold: 0 });
    hs.forEach(h => obs.observe(h));
  }

  // ── Scroll sync editor→preview ─────────────────────────────────────────────
  // Use a 50 ms debounce instead of rAF — rAF fires before the downstream scroll
  // event, which causes the two panes to fight each other on every tick.
  let splitScrollSyncing = false;
  let splitScrollTimer = null;
  function setSplitScrollBusy() {
    splitScrollSyncing = true;
    if (splitScrollTimer) clearTimeout(splitScrollTimer);
    splitScrollTimer = setTimeout(() => { splitScrollSyncing = false; }, 50);
  }
  qs('#edit-area')?.addEventListener('scroll', () => {
    if (splitScrollSyncing) return;
    const ta = qs('#edit-area'), sp = qs('#split-preview'); if (!ta || !sp) return;
    const max = ta.scrollHeight - ta.clientHeight; if (max <= 0) return;
    setSplitScrollBusy();
    sp.scrollTop = (ta.scrollTop / max) * (sp.scrollHeight - sp.clientHeight);
  });
  qs('#split-preview')?.addEventListener('scroll', () => {
    if (splitScrollSyncing) return;
    const ta = qs('#edit-area'), sp = qs('#split-preview'); if (!ta || !sp) return;
    const max = sp.scrollHeight - sp.clientHeight; if (max <= 0) return;
    setSplitScrollBusy();
    ta.scrollTop = (sp.scrollTop / max) * (ta.scrollHeight - ta.clientHeight);
  });

  // ── Split resize / preview focus ───────────────────────────────────────────
  (function setupSplitResize() {
    const main = qs('#main');
    const resizer = qs('#split-resizer');
    if (!main || !resizer) return;
    const saved = (() => { try { return localStorage.getItem('markr-edit-pane-width'); } catch { return null; } })();
    if (saved) document.documentElement.style.setProperty('--edit-pane-width', saved);
    resizer.addEventListener('mousedown', e => {
      e.preventDefault();
      document.body.classList.add('resizing-split');
      const onMove = ev => {
        const rect = main.getBoundingClientRect();
        const pct = Math.min(75, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100));
        const value = pct.toFixed(1) + '%';
        document.documentElement.style.setProperty('--edit-pane-width', value);
        try { localStorage.setItem('markr-edit-pane-width', value); } catch {}
      };
      const onUp = () => {
        document.body.classList.remove('resizing-split');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    resizer.addEventListener('dblclick', () => {
      document.documentElement.style.setProperty('--edit-pane-width', '50%');
      try { localStorage.setItem('markr-edit-pane-width', '50%'); } catch {}
    });
  })();

  // ── Copy buttons ───────────────────────────────────────────────────────────
  // SVG icons reused for copy buttons
  const COPY_ICON  = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const CHECK_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const IMG_ICON   = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';

  function makeCopyBtn(label) {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.innerHTML = COPY_ICON + ' ' + label;
    return btn;
  }
  function makeImgBtn() {
    const btn = document.createElement('button');
    btn.className = 'img-copy-btn';
    btn.title = 'Copy as PNG image — paste into Figma, Slack, anywhere';
    btn.innerHTML = IMG_ICON + ' Image';
    return btn;
  }
  function flashCopyBtn(btn, label) {
    btn.innerHTML = CHECK_ICON + ' Copied!';
    btn.classList.add('done');
    setTimeout(() => { btn.innerHTML = COPY_ICON + ' ' + label; btn.classList.remove('done'); }, 2200);
  }
  function flashImgBtn(btn) {
    btn.innerHTML = CHECK_ICON + ' Copied!';
    btn.classList.add('done');
    setTimeout(() => { btn.innerHTML = IMG_ICON + ' Image'; btn.classList.remove('done'); }, 2200);
  }

  // Convert an HTML table to tab-separated text (paste into spreadsheets)
  function tableToTsv(table) {
    return [...table.querySelectorAll('tr')].map(row =>
      [...row.querySelectorAll('th,td')].map(cell => cell.textContent?.trim().replace(/\t/g, ' ') || '').join('\\t')
    ).join('\\n');
  }

  // ── Element → PNG ─────────────────────────────────────────────────────────
  // Renders any HTML element to a retina-quality PNG using SVG foreignObject.
  // All CSS variables are resolved to real colour values before embedding so
  // the image looks identical to the Markr preview in every theme.
  // NOTE: uses string concatenation throughout — no backtick template literals
  // because this function lives inside the outer SCRIPT backtick template literal.
  async function elementToImageBlob(el) {
    var pad  = 20;
    var rect = el.getBoundingClientRect();
    var w    = Math.ceil(rect.width)  + pad * 2;
    var h    = Math.ceil(rect.height) + pad * 2;
    var scale = 2;

    var cs  = getComputedStyle(document.documentElement);
    var get = function(v) { return cs.getPropertyValue(v).trim(); };
    var bg          = get('--bg')           || '#ffffff';
    var border      = get('--border')       || '#e5e7eb';
    var borderFaint = get('--border-faint') || '#f0eeec';
    var text        = get('--text')         || '#1a1614';
    var textMuted   = get('--text-muted')   || '#6b7280';
    var bgSubtle    = get('--bg-subtle')    || '#f9f9f9';
    var accent      = get('--accent')       || '#f97316';
    var codeBg      = get('--code-bg')      || bg;
    var isTable = el.tagName === 'TABLE';
    var isPre   = el.tagName === 'PRE';
    var ff = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    var mono = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

    // Build self-contained CSS — no CSS variables (foreignObject can't resolve them)
    var css = '* { box-sizing: border-box; }'
      + 'html, body { margin: 0; padding: 0; background: ' + bg + '; }'
      + 'body { padding: ' + pad + 'px; font-family: ' + ff + '; font-size: 14px; line-height: 1.6; color: ' + text + '; }'
      + (isTable
          ? 'table { border-spacing: 0; border-collapse: collapse; border-radius: 6px; border: 1px solid ' + border + '; overflow: hidden; }'
          + 'th { font-weight: 600; padding: 8px 14px; border-bottom: 2px solid ' + border + '; text-align: left; background: ' + bgSubtle + '; color: ' + text + '; white-space: nowrap; }'
          + 'td { padding: 7px 14px; border-bottom: 1px solid ' + borderFaint + '; color: ' + text + '; }'
          + 'tr:last-child td { border-bottom: none; }'
          + 'tr:nth-child(2n) td { background: ' + bgSubtle + '; }'
          : '')
      + (isPre
          ? 'pre { margin: 0; padding: 18px; border-radius: 8px; background: ' + codeBg + '; border: 1px solid ' + borderFaint + '; }'
          + 'code { font-family: ' + mono + '; font-size: 13px; line-height: 1.7; color: ' + text + '; white-space: pre-wrap; }'
          : '')
      + 'blockquote { margin: 0; padding: 10px 16px; color: ' + textMuted + '; border-left: 3px solid ' + accent + '; background: rgba(249,115,22,0.06); border-radius: 0 6px 6px 0; }'
      + 'strong { font-weight: 600; } em { font-style: italic; }'
      + 'code { font-family: ' + mono + '; font-size: 12px; background: ' + codeBg + '; padding: 1px 4px; border-radius: 3px; border: 1px solid ' + borderFaint + '; }'
      + 'p { margin: 0 0 8px; } p:last-child { margin-bottom: 0; }';

    // For code blocks: use plain text (hljs classes won't resolve inside foreignObject)
    var bodyContent = isPre
      ? '<pre><code>' + escHtml(el.querySelector('code') ? el.querySelector('code').textContent || '' : el.textContent || '') + '</code></pre>'
      : el.outerHTML;

    var svgStr = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">'
      + '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">'
      + '<html xmlns="http://www.w3.org/1999/xhtml">'
      + '<head><meta charset="utf-8"/><style>' + css + '</style></head>'
      + '<body>' + bodyContent + '</body>'
      + '</html></foreignObject></svg>';

    var svgB64  = btoa(unescape(encodeURIComponent(svgStr)));
    var dataUrl = 'data:image/svg+xml;base64,' + svgB64;
    var canvas  = document.createElement('canvas');
    canvas.width  = w * scale;
    canvas.height = h * scale;
    var ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    return new Promise(function(resolve, reject) {
      var img = new Image();
      img.onload = function() {
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(b) { b ? resolve(b) : reject(new Error('toBlob failed')); }, 'image/png');
      };
      img.onerror = function() { reject(new Error('SVG foreignObject render failed')); };
      img.src = dataUrl;
    });
  }

  async function copyElementAsImage(btn, el) {
    const origHtml = btn.innerHTML;
    btn.innerHTML  = '…'; btn.disabled = true;
    try {
      const blob = await elementToImageBlob(el);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      flashImgBtn(btn);
    } catch {
      // Clipboard API blocked — download PNG instead
      try {
        const blob = await elementToImageBlob(el);
        const a    = document.createElement('a');
        a.download = 'markr-export.png';
        a.href = URL.createObjectURL(blob);
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        btn.innerHTML = CHECK_ICON + ' Saved';
        btn.classList.add('done');
        setTimeout(() => { btn.innerHTML = origHtml; btn.classList.remove('done'); btn.disabled = false; }, 2200);
        return;
      } catch { btn.innerHTML = origHtml; }
    }
    btn.disabled = false;
  }

  function addCopyButtons() {
    // ── Code block: [Copy] [📷 Image] ───────────────────────────────────────
    qsa('pre').forEach(pre => {
      if (pre.querySelector('.copy-btn, .el-btn-group')) return; // already added
      const group = document.createElement('div');
      group.className = 'el-btn-group';

      const copyBtn = makeCopyBtn('Copy');
      copyBtn.addEventListener('click', () => {
        const code = pre.querySelector('code');
        navigator.clipboard.writeText(code ? code.textContent || '' : '').then(() => flashCopyBtn(copyBtn, 'Copy'));
      });

      const imgBtn = makeImgBtn();
      imgBtn.addEventListener('click', () => copyElementAsImage(imgBtn, pre));

      group.appendChild(copyBtn);
      group.appendChild(imgBtn);
      pre.appendChild(group);
    });

    // ── Table: wrap + [Copy table] [📷 Image] ───────────────────────────────
    qsa('.markdown-body table').forEach(table => {
      if (table.closest('.table-wrap')) return; // already wrapped
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      table.parentNode?.insertBefore(wrap, table);
      wrap.appendChild(table);

      const group = document.createElement('div');
      group.className = 'el-btn-group';

      const copyBtn = makeCopyBtn('Copy table');
      copyBtn.addEventListener('click', async () => {
        const html = table.outerHTML;
        const tsv  = tableToTsv(table);
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html':  new Blob([html], { type: 'text/html' }),
              'text/plain': new Blob([tsv],  { type: 'text/plain' }),
            })
          ]);
        } catch {
          await navigator.clipboard.writeText(tsv);
        }
        flashCopyBtn(copyBtn, 'Copy table');
      });

      const imgBtn = makeImgBtn();
      imgBtn.addEventListener('click', () => copyElementAsImage(imgBtn, table));

      group.appendChild(copyBtn);
      group.appendChild(imgBtn);
      wrap.appendChild(group);
    });
  }

  function setupHeadingAnchors() {
    qsa('.h-anchor').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        navigator.clipboard.writeText(window.location.href.split('#')[0] + a.getAttribute('href'));
        const orig = a.textContent; a.textContent = '✓';
        setTimeout(() => { a.textContent = orig; }, 1500);
      });
    });
  }

  function setupMermaid() {
    function looksLikeMermaid(text) {
      return /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic)\\b/.test(String(text || '').trim());
    }
    const blocks = qsa('pre code').filter(block =>
      block.classList.contains('language-mermaid') || looksLikeMermaid(block.textContent)
    );
    if (!blocks.length) return;
    blocks.forEach(block => block.classList.add('markr-mermaid-source'));
    const script = document.createElement('script'); script.type = 'module';
    if (scriptNonce) script.nonce = scriptNonce;
    script.textContent = [
      "import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';",
      "const mode = document.documentElement.getAttribute('data-m') || 'light';",
      // Theme config per Markr theme — clean modern palette for light themes
      "const themeConfigs = {",
      "  light: { theme: 'base', themeVariables: {",
      "    primaryColor: '#fff7ed', primaryBorderColor: '#f97316', primaryTextColor: '#1a1614',",
      "    background: '#ffffff', mainBkg: '#fff7ed', nodeBorder: '#f97316',",
      "    clusterBkg: '#fef3c7', titleColor: '#1a1614', edgeLabelBackground: '#ffffff',",
      "    lineColor: '#9ca3af', textColor: '#1a1614',",
      "    sectionBkgColor: '#fff7ed', altSectionBkgColor: '#fffbf5', gridColor: '#e5e7eb',",
      "    doneTaskBkgColor: '#22c55e', doneTaskBorderColor: '#16a34a',",
      "    activeTaskBkgColor: '#f97316', activeTaskBorderColor: '#ea580c',",
      "    taskBorderColor: '#d1d5db', taskBkgColor: '#f3f4f6',",
      "    taskTextColor: '#1a1614', taskTextLightColor: '#6b7280', taskTextOutsideColor: '#374151',",
      "    critBkgColor: '#ef4444', critBorderColor: '#dc2626',",
      "  }},",
      "  notion: { theme: 'base', themeVariables: {",
      "    primaryColor: '#f6f5f4', primaryBorderColor: '#37352f', primaryTextColor: '#37352f',",
      "    background: '#ffffff', mainBkg: '#f6f5f4', nodeBorder: '#37352f',",
      "    clusterBkg: '#f6f5f4', titleColor: '#37352f', edgeLabelBackground: '#ffffff',",
      "    lineColor: '#9b9a97', textColor: '#37352f',",
      "    sectionBkgColor: '#f6f5f4', altSectionBkgColor: '#ffffff', gridColor: '#e9e9e7',",
      "    doneTaskBkgColor: '#2ecc71', doneTaskBorderColor: '#27ae60',",
      "    activeTaskBkgColor: '#2383e2', activeTaskBorderColor: '#1a6db5',",
      "    taskBorderColor: '#e9e9e7', taskBkgColor: '#f6f5f4',",
      "    taskTextColor: '#37352f', taskTextLightColor: '#6b6b6b', taskTextOutsideColor: '#37352f',",
      "    critBkgColor: '#e03e3e', critBorderColor: '#c0392b',",
      "  }},",
      "  dark:   { theme: 'dark' },",
      "  linear: { theme: 'dark', themeVariables: { primaryColor: '#1a1b2e', primaryBorderColor: '#5e6ad2', lineColor: '#5e6ad2' } },",
      "};",
      "const cfg = themeConfigs[mode] || themeConfigs.light;",
      "mermaid.initialize({ startOnLoad: false, ...cfg, securityLevel: 'loose' });",
      "document.querySelectorAll('pre code.markr-mermaid-source').forEach(async block => {",
      "  const pre = block.parentElement; if (!pre) return;",
      "  const wrap = document.createElement('div'); wrap.className = 'mermaid-wrap';",
      "  const btnGroup = document.createElement('div'); btnGroup.className = 'mermaid-btn-group';",
      "  const copyBtn = document.createElement('button'); copyBtn.className = 'mermaid-copy-btn';",
      "  copyBtn.title = 'Copy as PNG image'; copyBtn.textContent = '\\uD83D\\uDDBC Copy image';",
      "  const zoomBtn = document.createElement('button'); zoomBtn.className = 'mermaid-zoom-btn';",
      "  zoomBtn.title = 'Expand diagram'; zoomBtn.textContent = '\\u2922 Expand';",
      "  const div = document.createElement('div'); div.className = 'mermaid';",
      "  div.textContent = block.textContent || '';",
      "  div.dataset.mermaidSrc = block.textContent || '';  // persisted source for theme re-renders",
      "  btnGroup.appendChild(copyBtn); btnGroup.appendChild(zoomBtn);",
      "  wrap.appendChild(btnGroup); wrap.appendChild(div); pre.replaceWith(wrap);",
      "  // Copy button: fire a custom event so the main SCRIPT handles canvas/clipboard logic",
      "  copyBtn.addEventListener('click', e => {",
      "    e.stopPropagation();",
      "    const svg = div.querySelector('svg'); if (!svg) return;",
      "    document.dispatchEvent(new CustomEvent('markr-copy-diagram', { detail: { svg, btn: copyBtn } }));",
      "  });",
      "  // click diagram or expand button → open modal",
      "  function openModal() {",
      "    const svg = div.querySelector('svg'); if (!svg) return;",
      "    const modal = document.getElementById('mermaid-modal');",
      "    const inner = document.getElementById('mermaid-zoom-inner');",
      "    if (!modal || !inner) return;",
      "    // Capture natural rendered dimensions BEFORE copying (SVG is live in the DOM)",
      "    const rect = svg.getBoundingClientRect();",
      "    const nw = Math.round(rect.width)  || parseFloat(svg.getAttribute('width'))  || 800;",
      "    const nh = Math.round(rect.height) || parseFloat(svg.getAttribute('height')) || 400;",
      "    inner.innerHTML = svg.outerHTML;",
      "    inner.dataset.nw = nw;",
      "    inner.dataset.nh = nh;",
      "    // Ensure the copied SVG has a viewBox so pixel-based zoom scales correctly.",
      "    // Gantt charts often lack a viewBox; without it width/height changes don't scale content.",
      "    const s = inner.querySelector('svg');",
      "    if (s) {",
      "      if (!s.getAttribute('viewBox')) s.setAttribute('viewBox', '0 0 ' + nw + ' ' + nh);",
      "      s.style.width  = nw + 'px';",
      "      s.style.height = nh + 'px';",
      "    }",
      "    document.getElementById('mermaid-zoom-level').textContent = '100%';",
      "    modal.classList.add('open');",
      "    // Reset scroll so the diagram starts at the top-left on every open",
      "    const body = modal.querySelector('.mermaid-modal-body');",
      "    if (body) { body.scrollTop = 0; body.scrollLeft = 0; }",
      "  }",
      "  div.addEventListener('click', openModal);",
      "  zoomBtn.addEventListener('click', openModal);",
      "});",
      "try { await mermaid.run(); } catch(e) { console.warn('Mermaid:', e); }",
      "// Re-render all diagrams instantly when the Markr theme changes",
      "document.addEventListener('markr-theme-change', async (e) => {",
      "  const newMode = e.detail.mode;",
      "  const newCfg = themeConfigs[newMode] || themeConfigs.light;",
      "  mermaid.initialize({ startOnLoad: false, ...newCfg, securityLevel: 'loose' });",
      "  // Reset every .mermaid div back to its original source so mermaid.run() re-renders it",
      "  document.querySelectorAll('.mermaid').forEach(div => {",
      "    const src = div.dataset.mermaidSrc;",
      "    if (!src) return;",
      "    div.innerHTML = '';",
      "    div.textContent = src;",
      "    div.removeAttribute('data-processed');",
      "  });",
      "  try { await mermaid.run(); } catch(e) { console.warn('Mermaid re-render:', e); }",
      "});",
    ].join('\\n');
    document.head.appendChild(script);
  }

  // ── Format toolbar ─────────────────────────────────────────────────────────
  function applyFormat(action) {
    snapHistory();
    const ta = qs('#edit-area'); if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd, val = ta.value, sel = val.slice(start, end);

    // Inline toggle: wrap selection/placeholder, or remove if already wrapped
    function toggleInline(marker, ph) {
      const mlen = marker.length;
      // Case 1: characters immediately outside the selection ARE this marker → unwrap
      if (start >= mlen && val.slice(start - mlen, start) === marker && val.slice(end, end + mlen) === marker) {
        const nv = val.slice(0, start - mlen) + sel + val.slice(end + mlen);
        ta.value = nv;
        ta.setSelectionRange(start - mlen, end - mlen);
        ta.focus(); triggerEdit(); updateToolbarState(); return;
      }
      // Case 2: no selection — cursor is inside a marker pair on this line → remove the pair
      if (!sel) {
        const ls = val.lastIndexOf('\\n', start - 1) + 1;
        const lePos = val.indexOf('\\n', start);
        const le = lePos === -1 ? val.length : lePos;
        const line = val.slice(ls, le), curPos = start - ls;
        const positions = [];
        let idx = 0;
        while (true) { const f = line.indexOf(marker, idx); if (f === -1) break; positions.push(f); idx = f + mlen; }
        for (let i = 0; i + 1 < positions.length; i += 2) {
          const openEnd = positions[i] + mlen, closeStart = positions[i + 1];
          if (curPos >= openEnd && curPos <= closeStart) {
            const absOpen = ls + positions[i], absClose = ls + positions[i + 1];
            // Remove close marker first (higher index), then open
            let nv = val.slice(0, absClose) + val.slice(absClose + mlen);
            nv = nv.slice(0, absOpen) + nv.slice(absOpen + mlen);
            ta.value = nv;
            ta.setSelectionRange(start - mlen, start - mlen);
            ta.focus(); triggerEdit(); updateToolbarState(); return;
          }
        }
      }
      // Case 3: default — wrap selection (or insert placeholder)
      const inner = sel || ph || '';
      ta.setRangeText(marker + inner + marker, start, end, 'preserve');
      ta.setSelectionRange(start + mlen, start + mlen + inner.length);
      ta.focus(); triggerEdit(); updateToolbarState();
    }

    // Line-prefix toggle: applies/removes prefix across all selected lines
    function setLinePrefix(prefix) {
      const fls = val.lastIndexOf('\\n', start - 1) + 1;
      // Don't include a trailing line if selection ends exactly at a newline
      const adjEnd = (end > fls && val[end - 1] === '\\n') ? end - 1 : end;
      const lePos = val.indexOf('\\n', adjEnd);
      const endPos = lePos === -1 ? val.length : lePos;
      const lines = val.slice(fls, endPos).split('\\n');
      // Toggle: remove prefix if ALL lines already have it, otherwise apply
      const allHave = lines.every(l => l.startsWith(prefix));
      const newLines = lines.map(l => {
        const stripped = l
          .replace(/^#{1,6}\\s/, '')
          .replace(/^>\\s?/, '')
          .replace(/^[-*]\\s\\[[ x]\\]\\s/, '')
          .replace(/^[-*]\\s/, '')
          .replace(/^\\d+\\.\\s/, '');
        return allHave ? stripped : prefix + stripped;
      });
      const newBlock = newLines.join('\\n');
      ta.setRangeText(newBlock, fls, endPos, 'preserve');
      // Place cursor at end of first (modified) line
      const ncp = fls + newLines[0].length;
      ta.setSelectionRange(ncp, ncp);
      ta.focus(); triggerEdit(); updateToolbarState();
    }

    // Indent/outdent all selected lines by 2 spaces
    function indentLines(dir) {
      const fls = val.lastIndexOf('\\n', start - 1) + 1;
      const adjEnd = (end > fls && val[end - 1] === '\\n') ? end - 1 : end;
      const lePos = val.indexOf('\\n', adjEnd);
      const endPos = lePos === -1 ? val.length : lePos;
      const lines = val.slice(fls, endPos).split('\\n');
      const newLines = lines.map(l =>
        dir > 0 ? '  ' + l : (l.startsWith('  ') ? l.slice(2) : l.startsWith(' ') ? l.slice(1) : l)
      );
      const newBlock = newLines.join('\\n');
      ta.setRangeText(newBlock, fls, endPos, 'preserve');
      ta.setSelectionRange(fls, fls + newBlock.length);
      ta.focus(); triggerEdit();
    }

    switch (action) {
      case 'bold':      return toggleInline('**', 'bold text');
      case 'italic':    return toggleInline('*', 'italic text');
      case 'strike':    return toggleInline('~~', 'strikethrough');
      case 'code':      return toggleInline('\`', 'code');
      case 'codeblock': {
        const ins = '\\n\`\`\`\\n' + (sel || 'code here') + '\\n\`\`\`\\n';
        ta.setRangeText(ins, start, end, 'preserve');
        ta.setSelectionRange(start + 5, start + 5 + (sel || 'code here').length);
        ta.focus(); triggerEdit(); break;
      }
      case 'link': {
        const inner = sel || 'link text';
        ta.setRangeText('[' + inner + '](url)', start, end, 'preserve');
        ta.setSelectionRange(start + 1, start + 1 + inner.length);
        ta.focus(); triggerEdit(); break;
      }
      case 'image': {
        const inner = sel || 'alt text';
        ta.setRangeText('![' + inner + '](url)', start, end, 'preserve');
        ta.setSelectionRange(start + 2, start + 2 + inner.length);
        ta.focus(); triggerEdit(); break;
      }
      case 'quote':   return setLinePrefix('> ');
      case 'h1':      return setLinePrefix('# ');
      case 'h2':      return setLinePrefix('## ');
      case 'h3':      return setLinePrefix('### ');
      case 'h4':      return setLinePrefix('#### ');
      case 'ul':      return setLinePrefix('- ');
      case 'ol':      return setLinePrefix('1. ');
      case 'task':    return setLinePrefix('- [ ] ');
      case 'indent':  return indentLines(1);
      case 'outdent': return indentLines(-1);
      case 'hr': {
        const ins = '\\n\\n---\\n\\n';
        ta.setRangeText(ins, start, end, 'preserve');
        ta.setSelectionRange(start + ins.length, start + ins.length);
        ta.focus(); triggerEdit(); break;
      }
      case 'table': {
        const tbl = '\\n| Column 1 | Column 2 | Column 3 |\\n|----------|----------|----------|\\n| Cell     | Cell     | Cell     |\\n';
        ta.setRangeText(tbl, start, end, 'preserve');
        ta.setSelectionRange(start + tbl.length, start + tbl.length);
        ta.focus(); triggerEdit(); break;
      }
    }
  }

  // ── Format state detection (active button highlighting) ─────────────────────
  function getFormatState(ta) {
    const val = ta.value, pos = ta.selectionStart;
    const ls = val.lastIndexOf('\\n', pos - 1) + 1;
    const lePos = val.indexOf('\\n', pos);
    const le = lePos === -1 ? val.length : lePos;
    const line = val.slice(ls, le), linePos = pos - ls;
    const before = line.slice(0, linePos);
    // Count occurrences of a string within text
    function countIn(str, text) {
      let count = 0, idx = 0;
      while (true) { const f = text.indexOf(str, idx); if (f === -1) break; count++; idx = f + str.length; }
      return count;
    }
    const boldCount     = countIn('**', before);
    const strikeCount   = countIn('~~', before);
    const codeCount     = countIn('\`', before);
    const asteriskCount = countIn('*', before);
    // Each ** contributes 2 to the * count — subtract them to isolate italic *
    const italicCount   = asteriskCount - 2 * boldCount;
    return {
      bold:   boldCount   % 2 === 1,
      italic: italicCount % 2 === 1,
      strike: strikeCount % 2 === 1,
      code:   codeCount   % 2 === 1,
      h1:     line.startsWith('# ')   && !line.startsWith('## '),
      h2:     line.startsWith('## ')  && !line.startsWith('### '),
      h3:     line.startsWith('### ') && !line.startsWith('#### '),
      h4:     line.startsWith('#### '),
      quote:  line.startsWith('> '),
      ul:     (line.startsWith('- ') || line.startsWith('* ')) && !line.startsWith('- [') && !line.startsWith('* ['),
      ol:     /^\\d+\\.\\s/.test(line),
      task:   line.startsWith('- [') || line.startsWith('* ['),
    };
  }

  function updateToolbarState() {
    const ta = qs('#edit-area');
    if (!ta || !editMode) return;
    const s = getFormatState(ta);
    ['bold','italic','strike','code','h1','h2','h3','h4','quote','ul','ol','task'].forEach(a => {
      const btn = qs('[data-action="' + a + '"]');
      if (btn) btn.classList.toggle('on', !!s[a]);
    });
  }

  qsa('.fmt-btn').forEach(btn => { btn.addEventListener('click', () => { const a = btn.getAttribute('data-action'); if (a) applyFormat(a); }); });

  // Undo / Redo — use custom stack (execCommand is unreliable in VS Code webviews)
  qs('#btn-undo')?.addEventListener('click', () => histUndo());
  qs('#btn-redo')?.addEventListener('click', () => histRedo());

  // Word wrap toggle
  qs('#btn-wrap')?.addEventListener('click', () => {
    wordWrap = !wordWrap;
    const ta = qs('#edit-area');
    if (ta) ta.style.whiteSpace = wordWrap ? 'pre-wrap' : 'pre';
    qs('#btn-wrap')?.classList.toggle('on', wordWrap);
  });

  // Toolbar active state — update whenever the cursor moves or selection changes
  qs('#edit-area')?.addEventListener('keyup',   updateToolbarState);
  qs('#edit-area')?.addEventListener('mouseup',  updateToolbarState);
  qs('#edit-area')?.addEventListener('click',    updateToolbarState);

  // ── Smart editor ───────────────────────────────────────────────────────────
  function triggerEdit() {
    const ta = qs('#edit-area'); if (!ta) return;
    const content = ta.value;
    currentMarkdown = content;
    updateStats(content);
    markDirty(); // mark unsaved — actual disk write only happens on explicit Save
    clearTimeout(editTimer);
    // Still send to extension so the split-preview re-renders in real time
    editTimer = setTimeout(() => vsc.postMessage({ type: 'edit', content, uri: activeTabUri }), 250);
  }
  function flushEdit() {
    const ta = qs('#edit-area'); if (!ta) return;
    clearTimeout(editTimer);
    currentMarkdown = ta.value;
    vsc.postMessage({ type: 'edit', content: currentMarkdown, uri: activeTabUri });
  }

  qs('#edit-area')?.addEventListener('input', () => { triggerEdit(); scheduleSnap(); });

  qs('#edit-area')?.addEventListener('keydown', e => {
    const ta = e.target, start = ta.selectionStart, end = ta.selectionEnd, val = ta.value, mod = e.metaKey || e.ctrlKey;
    // Undo / redo — must be checked first so our stack wins over VS Code's global handler
    if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); histUndo(); return; }
    if (mod && ((e.shiftKey && e.key === 'z') || e.key === 'y')) { e.preventDefault(); histRedo(); return; }
    // Save
    if (mod && e.key === 's') { e.preventDefault(); saveFile(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      // Detect if the current line is a list item — if so, indent/outdent the whole line
      const tls = val.lastIndexOf('\\n', start - 1) + 1;
      const tlePos = val.indexOf('\\n', tls);
      const tle = tlePos === -1 ? val.length : tlePos;
      const tfl = val.slice(tls, tle);
      // Skip leading spaces to find the actual list marker
      let tmi = 0; while (tmi < tfl.length && tfl[tmi] === ' ') tmi++;
      const isListLine = tfl.length > tmi && (
        tfl.slice(tmi, tmi + 2) === '- ' ||
        tfl.slice(tmi, tmi + 2) === '* ' ||
        tfl.slice(tmi, tmi + 3) === '- [' ||
        tfl.slice(tmi, tmi + 3) === '* [' ||
        (tfl[tmi] >= '0' && tfl[tmi] <= '9' && tfl.indexOf('. ', tmi) > tmi)
      );
      if (isListLine) {
        if (e.shiftKey) {
          // Outdent: remove up to 2 leading spaces from line
          const outdented = tfl.startsWith('  ') ? tfl.slice(2) : (tfl.startsWith(' ') ? tfl.slice(1) : tfl);
          const removed = tfl.length - outdented.length;
          ta.setRangeText(outdented, tls, tle, 'preserve');
          const ncp = Math.max(tls, start - removed);
          ta.setSelectionRange(ncp, ncp);
        } else {
          // Indent: add 2 spaces at line start
          ta.setRangeText('  ' + tfl, tls, tle, 'preserve');
          ta.setSelectionRange(start + 2, start + 2);
        }
      } else if (!e.shiftKey) {
        // Default Tab: insert 2 spaces at cursor
        ta.setRangeText('  ', start, end, 'preserve');
        ta.setSelectionRange(start + 2, start + 2);
      }
      triggerEdit(); return;
    }
    if (mod && e.key === 'b') { e.preventDefault(); applyFormat('bold'); return; }
    if (mod && e.key === 'i') { e.preventDefault(); applyFormat('italic'); return; }
    if (mod && e.key === 'k') { e.preventDefault(); applyFormat('link'); return; }
    if (mod && e.key === '\`') { e.preventDefault(); applyFormat('code'); return; }
    if (mod && e.shiftKey && e.key === '1') { e.preventDefault(); applyFormat('h1'); return; }
    if (mod && e.shiftKey && e.key === '2') { e.preventDefault(); applyFormat('h2'); return; }
    if (mod && e.shiftKey && e.key === '3') { e.preventDefault(); applyFormat('h3'); return; }
    if (e.key === 'Enter') {
      const ls = val.lastIndexOf('\\n', start - 1) + 1, line = val.slice(ls, start);
      const taskM = line.match(/^(\\s*)([-*])\\s\\[[ x]\\]\\s/);
      const bullM = line.match(/^(\\s*)([-*])\\s/);
      const numM  = line.match(/^(\\s*)(\\d+)\\.\\s/);
      const match = taskM || bullM || numM;
      if (match) {
        const content = line.slice(match[0].length);
        if (!content.trim()) {
          e.preventDefault();
          ta.setRangeText('\\n', ls, start, 'preserve');
          ta.setSelectionRange(ls + 1, ls + 1); triggerEdit(); return;
        }
        e.preventDefault();
        let insert = '';
        if (taskM)      insert = '\\n' + taskM[1] + taskM[2] + ' [ ] ';
        else if (bullM) insert = '\\n' + bullM[1] + bullM[2] + ' ';
        else if (numM)  insert = '\\n' + numM[1] + (parseInt(numM[2]) + 1) + '. ';
        ta.setRangeText(insert, start, end, 'preserve');
        ta.setSelectionRange(start + insert.length, start + insert.length); triggerEdit();
      }
    }
  });

  // ── Image paste ────────────────────────────────────────────────────────────
  qs('#edit-area')?.addEventListener('paste', e => {
    const items = [...(e.clipboardData?.items || [])];
    const img   = items.find(item => item.type.startsWith('image/'));
    if (!img) return;
    e.preventDefault();
    const file = img.getAsFile(); if (!file) return;
    const ext  = file.type.split('/')[1] || 'png';
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.toString().split(',')[1];
      vsc.postMessage({ type: 'pasteImage', base64: b64, ext });
    };
    reader.readAsDataURL(file);
  });

  // ── Quick Open (Cmd+K) ─────────────────────────────────────────────────────
  let qoSelected = -1;
  function openQuickOpen() {
    qs('#quick-open')?.classList.add('open');
    const inp = qs('#qo-input');
    if (inp) { inp.value = ''; inp.focus(); }
    qoSelected = -1; renderQoResults('');
  }
  function closeQuickOpen() { qs('#quick-open')?.classList.remove('open'); }
  function fuzzyScore(text, query) {
    const t = text.toLowerCase(), q = query.toLowerCase();
    if (!q) return 1;
    let qi = 0, score = 0, last = -1;
    for (let i = 0; i < t.length && qi < q.length; i++) {
      if (t[i] === q[qi]) { score += last === i - 1 ? 2 : 1; last = i; qi++; }
    }
    return qi === q.length ? score : 0;
  }
  function renderQoResults(query) {
    const container = qs('#qo-results'); if (!container) return;
    const scored = filesCache
      .map(f => ({ f, score: fuzzyScore(f.relPath, query) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || (a.f.isAiConfig ? -1 : 1))
      .slice(0, 12);
    if (!scored.length) { container.innerHTML = '<div class="qo-empty">No files found</div>'; return; }
    container.innerHTML = scored.map((x, i) =>
      '<div class="qo-item' + (x.f.isAiConfig ? ' ai' : '') + (i === qoSelected ? ' selected' : '')
      + '" data-uri="' + escHtml(x.f.uri) + '">'
      + '<span class="qo-name">' + escHtml(x.f.label) + '</span>'
      + '<span class="qo-path">' + escHtml(x.f.aiKind || x.f.dir || '') + '</span>'
      + '</div>'
    ).join('');
    qsa('.qo-item', container).forEach(el => {
      el.addEventListener('click', () => {
        const uri = el.getAttribute('data-uri');
        if (uri) { if (editMode) flushEdit(); vsc.postMessage({ type: 'openFile', uri }); closeQuickOpen(); }
      });
    });
  }
  qs('#qo-input')?.addEventListener('input', e => { qoSelected = -1; renderQoResults(e.target.value); });
  qs('#qo-input')?.addEventListener('keydown', e => {
    const items = qsa('.qo-item', qs('#qo-results'));
    if (e.key === 'ArrowDown') { e.preventDefault(); qoSelected = Math.min(qoSelected + 1, items.length - 1); renderQoResults(qs('#qo-input').value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); qoSelected = Math.max(qoSelected - 1, 0); renderQoResults(qs('#qo-input').value); }
    else if (e.key === 'Enter') { const sel = items[qoSelected] || items[0]; const uri = sel?.getAttribute('data-uri'); if (uri) { if (editMode) flushEdit(); vsc.postMessage({ type: 'openFile', uri }); closeQuickOpen(); } }
  });
  qs('#qo-backdrop')?.addEventListener('click', closeQuickOpen);

  // ── Keyboard Shortcuts Panel (??) ──────────────────────────────────────────
  function openShortcuts()  { qs('#shortcuts-panel')?.classList.add('open'); }
  function closeShortcuts() { qs('#shortcuts-panel')?.classList.remove('open'); }
  qs('#sp-backdrop')?.addEventListener('click', closeShortcuts);
  qs('#sp-close')?.addEventListener('click', closeShortcuts);

  // ── Global keyboard ────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    const inEditor = document.activeElement === qs('#edit-area');
    const inQo     = document.activeElement === qs('#qo-input');
    if (e.key === 'Escape') {
      if (qs('#quick-open.open'))     { closeQuickOpen();  return; }
      if (qs('#shortcuts-panel.open')) { closeShortcuts(); return; }
      if (editMode) { exitEditMode(); return; }
    }
    // Cmd+S / Ctrl+S — explicit save (catches the shortcut when focus is outside the textarea)
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && editMode) { e.preventDefault(); saveFile(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k' && !inEditor) { e.preventDefault(); openQuickOpen(); return; }
    if (e.key === '?' && !inEditor && !inQo) { e.preventDefault(); openShortcuts(); return; }
  });

  // ── External links ─────────────────────────────────────────────────────────
  document.addEventListener('click', e => {
    const link = e.target.closest('a[href]'); if (!link) return;
    const href = link.getAttribute('href');
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      e.preventDefault(); vsc.postMessage({ type: 'openLink', href });
    }
  });

  // ── Toolbar buttons ────────────────────────────────────────────────────────
  // Clipboard markdown for save-as flow
  let clipboardMarkdown = '';
  let isClipboardMode = false;  // true while clipboard overlay is active
  let prevEditModeBeforeClipboard = false; // remember whether user was in edit mode before clipboard
  qs('#btn-paste-preview')?.addEventListener('click', () => vsc.postMessage({ type: 'pastePreview' }));
  qs('#btn-save-file')?.addEventListener('click', () => saveFile());
  qs('#btn-save-clipboard')?.addEventListener('click', () => {
    // Use currentMarkdown so we save any edits the user has typed since pasting
    const md = (currentMarkdown || clipboardMarkdown).trim() ? (currentMarkdown || clipboardMarkdown) : clipboardMarkdown;
    if (md.trim()) vsc.postMessage({ type: 'saveClipboardAs', markdown: md });
  });
  qs('#btn-dismiss-clipboard')?.addEventListener('click', () => {
    const banner = qs('#clipboard-banner');
    if (banner) banner.classList.remove('open');
    isClipboardMode = false;
    clipboardMarkdown = '';
    // Tell extension: clipboard mode is over — edits to the textarea belong to the real file again
    vsc.postMessage({ type: 'dismissClipboard' });
    // Exit split-edit mode WITHOUT flushing (don't write clipboard content to the original file)
    if (editMode) exitEditMode(false, false, false);
    // Restore the active tab's file so the user is back to what they had open
    const prevTab = tabs.find(t => t.uri === activeTabUri);
    if (prevTab) {
      currentMarkdown = prevTab.markdown;
      const body = qs('#scroller .markdown-body'); if (body) body.innerHTML = prevTab.html;
      const spBody = qs('#split-preview .markdown-body'); if (spBody) spBody.innerHTML = prevTab.html;
      const fnEl = qs('.fname'); if (fnEl) fnEl.textContent = prevTab.filename;
      const aiBadge = qs('.ai-badge');
      if (aiBadge) {
        aiBadge.textContent = prevTab.aiKind ? '✦ ' + prevTab.aiKind : '✦ AI';
        aiBadge.style.display = prevTab.isAiConfig ? '' : 'none';
      }
      updateStats(currentMarkdown);
      buildTOC(); addCopyButtons(); setupHeadingAnchors();
      if (qs('#scroller .language-mermaid')) setupMermaid();
      // Restore previous edit state: re-enter edit mode if the previous file had it active
      if (prevTab.isAiConfig && !isAutoEditDismissed(prevTab.uri)) {
        if (!editMode) enterEditMode();
      } else if (prevEditModeBeforeClipboard) {
        if (!editMode) enterEditMode();
      }
    }
    prevEditModeBeforeClipboard = false;
  });
  qs('#btn-copy-md')?.addEventListener('click', () => vsc.postMessage({ type: 'copyMarkdown' }));
  qs('#btn-source')?.addEventListener('click', () => {
    vsc.postMessage({ type: 'openInEditor', uri: activeTabUri });
  });

  qs('#btn-copy-html')?.addEventListener('click', () => {
    const html = qs('.markdown-body')?.innerHTML || '';
    navigator.clipboard.writeText(html);
    const btn = qs('#btn-copy-html'); if (!btn) return;
    const prev = btn.innerHTML; btn.textContent = '✓';
    setTimeout(() => { btn.innerHTML = prev; }, 2000);
  });

  qs('#btn-export')?.addEventListener('click', () => vsc.postMessage({ type: 'exportHtml' }));
  qs('#btn-pdf')?.addEventListener('click',    () => vsc.postMessage({ type: 'exportPdf' }));
  qs('#btn-print')?.addEventListener('click',  () => vsc.postMessage({ type: 'print' }));

  // ── Theme picker ───────────────────────────────────────────────────────────
  function applyTheme(t) {
    document.documentElement.setAttribute('data-m', t);
    try { localStorage.setItem('markr-theme', t); } catch {}
    qsa('.theme-opt').forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-theme') === t));
    qs('#theme-menu')?.classList.remove('open');
    // Re-render Mermaid diagrams with the new theme's colour palette immediately
    document.dispatchEvent(new CustomEvent('markr-theme-change', { detail: { mode: t } }));
  }
  qs('#btn-theme')?.addEventListener('click', e => {
    e.stopPropagation();
    qs('#theme-menu')?.classList.toggle('open');
    const cur = document.documentElement.getAttribute('data-m');
    qsa('.theme-opt').forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-theme') === cur));
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.theme-picker-wrap')) qs('#theme-menu')?.classList.remove('open');
  });
  qsa('.theme-opt').forEach(btn => btn.addEventListener('click', () => {
    const t = btn.getAttribute('data-theme'); if (t) applyTheme(t);
  }));
  (function() {
    try { const s = localStorage.getItem('markr-theme'); if (s) applyTheme(s); } catch {}
  })();

  let sidebarOpen = true;
  qs('#btn-sidebar')?.addEventListener('click', () => {
    // If focus mode is active the sidebar is hidden by CSS, not by .hidden.
    // Clicking the sidebar icon should exit focus mode and restore the sidebar.
    if (focusMode) {
      focusMode = false;
      document.body.classList.remove('focus-mode');
      qs('#btn-focus')?.classList.remove('on');
      sidebarOpen = true;
      qs('#sidebar')?.classList.remove('hidden');
      qs('#btn-sidebar')?.classList.add('on');
      return;
    }
    sidebarOpen = !sidebarOpen;
    qs('#sidebar')?.classList.toggle('hidden', !sidebarOpen);
    qs('#btn-sidebar')?.classList.toggle('on', sidebarOpen);
  });

  qsa('.sb-section').forEach(sec => {
    sec.querySelector('.sb-header')?.addEventListener('click', e => {
      if (e.target.closest('.sb-action')) return;
      sec.classList.toggle('collapsed');
    });
  });

  qs('#btn-new-file')?.addEventListener('click', e => { e.stopPropagation(); vsc.postMessage({ type: 'newFile' }); });

  // ── Notebook file search / filter ─────────────────────────────────────────
  let filterDebounce;
  qs('#file-search')?.addEventListener('input', e => {
    clearTimeout(filterDebounce);
    fileFilter = e.target.value.trim();
    qs('#file-search-clear')?.classList.toggle('visible', fileFilter.length > 0);
    filterDebounce = setTimeout(() => renderFileList(filesCache), 120);
  });
  qs('#file-search-clear')?.addEventListener('click', () => {
    fileFilter = '';
    const inp = qs('#file-search');
    if (inp) { inp.value = ''; inp.focus(); }
    qs('#file-search-clear')?.classList.remove('visible');
    renderFileList(filesCache);
  });
  // Pressing Escape inside the search box clears and closes it
  qs('#file-search')?.addEventListener('keydown', e => {
    if (e.key === 'Escape') { qs('#file-search-clear')?.click(); e.stopPropagation(); }
  });

  let focusMode = false;
  qs('#btn-focus')?.addEventListener('click', () => {
    focusMode = !focusMode;
    document.body.classList.toggle('focus-mode', focusMode);
    qs('#btn-focus')?.classList.toggle('on', focusMode);
  });

  // ── Edit toggle ────────────────────────────────────────────────────────────
  function enterEditMode() {
    editMode = true;
    document.body.classList.add('edit-mode');
    const ea = qs('#edit-area');
    if (ea) { ea.value = currentMarkdown; ea.focus(); }
    const btn = qs('#btn-edit'); if (btn) btn.textContent = '← Preview';
    vsc.postMessage({ type: 'modeChange', mode: 'edit' });
    updateStats(currentMarkdown);
    // Initialise a fresh undo stack with the current document as the baseline
    resetHistory();
    snapHistory();
    updateToolbarState();
  }
  function exitEditMode(rememberAutoEdit = true, notify = true, flush = true) {
    if (editMode && flush) flushEdit();
    if (rememberAutoEdit) setAutoEditDismissed(currentUri, true);
    editMode = false;
    document.body.classList.remove('edit-mode');
    const btn = qs('#btn-edit'); if (btn) btn.textContent = editMode ? '← Preview' : 'Edit';
    const si = qs('#save-status'); if (si) si.className = 'save-status';
    if (notify) vsc.postMessage({ type: 'modeChange', mode: 'preview' });
  }
  qs('#btn-edit')?.addEventListener('click', () => {
    if (editMode) {
      // In clipboard mode: don't mark the underlying real file as "auto-edit dismissed"
      exitEditMode(!isClipboardMode);
    } else {
      enterEditMode();
    }
  });
  qs('#split-preview')?.addEventListener('click', e => {
    if (!editMode) return;
    if (e.target.closest('a,button,pre,code,input,textarea,select')) return;
    exitEditMode(true);
  });
  if (typeof __AUTOEDIT__ !== 'undefined' && __AUTOEDIT__ && !isAutoEditDismissed(currentUri)) { setTimeout(enterEditMode, 50); }

  // ── Back to top ────────────────────────────────────────────────────────────
  const topBtn   = qs('#top-btn');
  const scroller = qs('#scroller');
  scroller?.addEventListener('scroll', () => { topBtn?.classList.toggle('show', (scroller.scrollTop || 0) > 300); });
  topBtn?.addEventListener('click', () => scroller?.scrollTo({ top: 0, behavior: 'smooth' }));

  // ── Mermaid zoom modal ──────────────────────────────────────────────────────
  // Width-based zoom: the inner div grows/shrinks; overflow: auto on the body
  // gives real scrollbars so you can pan the diagram at any zoom level.
  let mermaidZoom = 1;
  function setMermaidZoom(z) {
    mermaidZoom = Math.min(4, Math.max(0.25, z));
    const inner = qs('#mermaid-zoom-inner');
    if (inner) {
      const nw = parseFloat(inner.dataset.nw || '0');
      const nh = parseFloat(inner.dataset.nh || '0');
      const svg = inner.querySelector('svg');
      if (svg && nw && nh) {
        // Scale the SVG by setting explicit pixel dimensions.
        // The SVG's viewBox handles proportional scaling of all content.
        // The inner (flex-shrink:0) expands/contracts so overflow:auto
        // on the modal body gives real scrollbars at any zoom level.
        svg.style.width  = Math.round(nw * mermaidZoom) + 'px';
        svg.style.height = Math.round(nh * mermaidZoom) + 'px';
      }
    }
    const lbl = qs('#mermaid-zoom-level');
    if (lbl) lbl.textContent = Math.round(mermaidZoom * 100) + '%';
  }
  function closeMermaidModal() {
    qs('#mermaid-modal')?.classList.remove('open');
    mermaidZoom = 1;
    // Reset SVG to natural size
    const inner = qs('#mermaid-zoom-inner');
    if (inner) {
      const nw = parseFloat(inner.dataset.nw || '0');
      const nh = parseFloat(inner.dataset.nh || '0');
      const svg = inner.querySelector('svg');
      if (svg && nw && nh) { svg.style.width = nw + 'px'; svg.style.height = nh + 'px'; }
    }
  }
  qs('#mermaid-modal-close')?.addEventListener('click',    closeMermaidModal);
  qs('#mermaid-modal-backdrop')?.addEventListener('click', closeMermaidModal);
  qs('#mermaid-zoom-in')?.addEventListener('click',    () => setMermaidZoom(mermaidZoom + 0.25));
  qs('#mermaid-zoom-out')?.addEventListener('click',   () => setMermaidZoom(mermaidZoom - 0.25));
  qs('#mermaid-zoom-reset')?.addEventListener('click', () => setMermaidZoom(1));
  // Scroll-wheel zoom inside the modal body only (prevent page scroll while interacting)
  qs('.mermaid-modal-body')?.addEventListener('wheel', e => {
    if (!qs('#mermaid-modal')?.classList.contains('open')) return;
    if (!(e.metaKey || e.ctrlKey)) return; // only zoom on Ctrl+scroll / pinch-to-zoom
    e.preventDefault();
    setMermaidZoom(mermaidZoom + (e.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
  // ESC to close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMermaidModal();
  });

  // ── Mermaid: Copy diagram as PNG ───────────────────────────────────────────
  // Renders the SVG into a 2× canvas (retina quality) and copies to clipboard.
  // Falls back to PNG download if the Clipboard API is unavailable.
  async function svgToPngBlob(svg) {
    const rect = svg.getBoundingClientRect();
    const nw = Math.max(Math.round(rect.width)  || parseInt(svg.getAttribute('width')  || '0'), 1) || 800;
    const nh = Math.max(Math.round(rect.height) || parseInt(svg.getAttribute('height') || '0'), 1) || 400;
    const scale = 2; // 2× for retina sharpness
    const canvas = document.createElement('canvas');
    canvas.width  = nw * scale;
    canvas.height = nh * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    // Fill background matching current Markr theme
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, nw, nh);
    // Clone + normalise the SVG so it has explicit width/height/viewBox
    const clone = svg.cloneNode(true);
    clone.setAttribute('width',  nw);
    clone.setAttribute('height', nh);
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', '0 0 ' + nw + ' ' + nh);
    // Use base64 data URL — most reliable in VS Code webview sandbox
    const svgStr    = new XMLSerializer().serializeToString(clone);
    const svgB64    = btoa(unescape(encodeURIComponent(svgStr)));
    const dataUrl   = 'data:image/svg+xml;base64,' + svgB64;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, nw, nh);
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
      };
      img.onerror = () => reject(new Error('SVG image load failed'));
      img.src = dataUrl;
    });
  }

  async function copyDiagramImage(btn, svg) {
    const orig = btn.textContent;
    btn.textContent = '…';
    btn.disabled = true;
    try {
      const blob = await svgToPngBlob(svg);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      btn.textContent = '✓ Copied!';
    } catch {
      // Clipboard write blocked (e.g. permissions) → fall back to PNG download
      try {
        const blob = await svgToPngBlob(svg);
        const a = document.createElement('a');
        a.download = 'diagram.png';
        a.href = URL.createObjectURL(blob);
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        btn.textContent = '⬇ Saved';
      } catch {
        btn.textContent = orig;
        btn.disabled = false;
        return;
      }
    }
    btn.disabled = false;
    setTimeout(() => { btn.textContent = orig; }, 2200);
  }

  // Inline copy buttons fire this custom event from inside the Mermaid ES module
  document.addEventListener('markr-copy-diagram', e => {
    copyDiagramImage(e.detail.btn, e.detail.svg);
  });

  // Modal "Copy image" button copies the SVG currently shown in the zoom viewer
  qs('#mermaid-copy-img')?.addEventListener('click', () => {
    const svg = qs('#mermaid-zoom-inner svg');
    const btn = qs('#mermaid-copy-img');
    if (svg && btn) copyDiagramImage(btn, svg);
  });

  // ── Rich copy: intercept Cmd+C in the preview to include text/html ───────
  // When the user selects content in the markdown preview and copies, we write
  // both text/html and text/plain to the clipboard. Slack, Google Chat, Notion,
  // Linear, GitHub, Google Docs all pick up text/html and preserve tables,
  // bold, lists, code blocks, etc. Plain text is the fallback for everything else.
  let richCopyToastTimer;
  function showRichToast(msg) {
    const toast = qs('#rich-copy-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(richCopyToastTimer);
    richCopyToastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
  }

  document.addEventListener('copy', e => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    // Only enhance copy when the selection originates inside a markdown-body preview
    // (not inside the textarea editor — that should copy plain text as-is)
    const anchor = sel.anchorNode;
    const bodies = qsa('.markdown-body');
    const inPreview = bodies.some(b => b.contains(anchor));
    if (!inPreview) return;
    // Clone the selected DOM fragment and serialise as HTML
    const range = sel.getRangeAt(0);
    const frag  = range.cloneContents();
    const div   = document.createElement('div');
    div.appendChild(frag);
    try {
      e.clipboardData?.setData('text/html',  div.innerHTML);
      e.clipboardData?.setData('text/plain', sel.toString());
      e.preventDefault();
      // Only show toast when the selection is non-trivial (contains a block element)
      if (div.querySelector('table,pre,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,strong,em,code')) {
        showRichToast('✓ Copied with formatting — paste into Slack, Docs, Notion…');
      }
    } catch {}
  });

  // ── Messages from extension ────────────────────────────────────────────────
  window.addEventListener('message', ev => {
    const msg = ev.data;
    if (msg.type === 'fileLoaded') {
      // ── Clipboard preview: pure overlay — never modify tabs, activeTabUri or currentUri ──
      if (msg.isClipboard) {
        prevEditModeBeforeClipboard = editMode; // remember so dismiss can restore
        isClipboardMode = true;
        clipboardMarkdown = msg.markdown;
        currentMarkdown   = msg.markdown;

        // Update title & badge (no AI badge for clipboard)
        const cbFn = qs('.fname'); if (cbFn) cbFn.textContent = '📋 Clipboard';
        const cbBadge = qs('.ai-badge'); if (cbBadge) cbBadge.style.display = 'none';
        updateStats(msg.markdown);

        // Show the banner
        const banner = qs('#clipboard-banner'); if (banner) banner.classList.add('open');

        resetHistory(); markClean();

        // Enter split-edit mode so the user can paste / edit markdown and see it rendered live.
        // exitEditMode is intentionally NOT called — we want the textarea to be visible.
        if (!editMode) enterEditMode();
        const ea = qs('#edit-area');
        if (ea) { ea.value = msg.markdown; ea.focus(); }

        // Seed the split-preview with the already-rendered HTML from the extension
        const cbSpBody = qs('#split-preview .markdown-body');
        if (cbSpBody) cbSpBody.innerHTML = msg.html;
        // Set up helpers on the split-preview content (copy buttons, anchors, Mermaid diagrams)
        addCopyButtons(); setupHeadingAnchors();
        if (qs('#split-preview .language-mermaid')) setupMermaid();

        return; // ← do NOT touch tabs / activeTabUri — no layout shift, no tab bar change
      }

      // ── Normal file loaded ──────────────────────────────────────────────────
      // Close clipboard banner if it was open (user opened a real file)
      isClipboardMode = false;
      prevEditModeBeforeClipboard = false;
      const cbBannerNormal = qs('#clipboard-banner');
      if (cbBannerNormal) cbBannerNormal.classList.remove('open');
      clipboardMarkdown = '';

      let tab = tabs.find(t => t.uri === msg.uri);
      if (!tab) {
        tab = { uri: msg.uri, filename: msg.filename, html: msg.html, markdown: msg.markdown, isAiConfig: msg.isAiConfig, aiKind: msg.aiKind || '', scrollTop: 0 };
        tabs.push(tab);
      } else {
        tab.html = msg.html;
        tab.markdown = msg.markdown;
        tab.isAiConfig = msg.isAiConfig;
        tab.aiKind = msg.aiKind || '';
      }
      activeTabUri = msg.uri;
      currentUri = msg.uri;
      const body = qs('#scroller .markdown-body'); if (body) body.innerHTML = msg.html;
      const spBody = qs('#split-preview .markdown-body'); if (spBody) spBody.innerHTML = msg.html;
      currentMarkdown = msg.markdown;
      const fnEl = qs('.fname'); if (fnEl) fnEl.textContent = msg.filename;
      const aiBadge = qs('.ai-badge');
      if (aiBadge) {
        aiBadge.textContent = msg.aiKind ? '✦ ' + msg.aiKind : '✦ AI';
        aiBadge.style.display = msg.isAiConfig ? '' : 'none';
      }
      updateStats(msg.markdown);
      // Reset undo/redo history and dirty state whenever a new file is loaded
      resetHistory();
      markClean();
      // Always sync the textarea content when switching files while already in edit mode.
      // enterEditMode() only fires when !editMode, so without this the old content stays in
      // the editor when switching between two AI-config files (both trigger edit mode).
      if (editMode) { const ea = qs('#edit-area'); if (ea) { ea.value = currentMarkdown; updateToolbarState(); } }
      if (msg.isAiConfig && !isAutoEditDismissed(msg.uri)) { if (!editMode) enterEditMode(); }
      else { if (editMode) exitEditMode(false, false, false); }
      qs('#scroller').scrollTop = 0;
      buildTOC(); addCopyButtons(); setupHeadingAnchors();
      if (qs('#scroller .language-mermaid')) setupMermaid();
      renderTabBar();
      updateFileListActive(msg.uri);
    }
    if (msg.type === 'scrollToHeading') {
      const el = document.getElementById(msg.id); if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.style.transition = 'background 0.3s'; el.style.background = 'var(--accent-bg)';
      setTimeout(() => { el.style.background = ''; }, 1400);
    }
    if (msg.type === 'updateSplitPreview') {
      // Preserve split-preview scroll position across the innerHTML swap so
      // the preview doesn't jump to the top on every keystroke.
      const spEl = qs('#split-preview');
      const prevSpST = spEl ? spEl.scrollTop : 0;
      const sp = qs('#split-preview .markdown-body');
      if (sp) sp.innerHTML = msg.html;
      if (spEl) spEl.scrollTop = prevSpST;
      // Always set up helpers on the split-preview (visible in both edit and preview mode)
      addCopyButtons(); setupHeadingAnchors();
      if (qs('#split-preview .language-mermaid')) setupMermaid();
      if (!editMode) {
        // Also update the main scroller when in pure preview mode
        const body = qs('#scroller .markdown-body');
        if (body) body.innerHTML = msg.html;
        buildTOC();
        if (qs('#scroller .language-mermaid')) setupMermaid();
      }
    }
    if (msg.type === 'saved') { showSaved(); }
    if (msg.type === 'updateFiles') {
      filesLoading = false;
      filesCache = msg.files || [];
      renderFileList(filesCache);
    }
    if (msg.type === 'imagePasted') {
      const ta = qs('#edit-area'); if (!ta) return;
      const start  = ta.selectionStart;
      const insert = '![](' + msg.path + ')';
      ta.setRangeText(insert, start, start, 'preserve');
      ta.setSelectionRange(start + 2, start + 2);
      ta.focus(); triggerEdit();
    }
  });

  // ── Multi-tab ──────────────────────────────────────────────────────────────
  let tabs = [];
  let activeTabUri = null;

  (function initFirstTab() {
    const activeFile = filesCache.find(f => f.active);
    if (!activeFile) return;
    tabs = [{
      uri: activeFile.uri, filename: activeFile.label,
      html: qs('#scroller .markdown-body')?.innerHTML || '',
      markdown: currentMarkdown,
      isAiConfig: activeFile.isAiConfig, aiKind: activeFile.aiKind || '', scrollTop: 0,
    }];
    activeTabUri = activeFile.uri;
  })();

  function renderTabBar() {
    const bar = qs('#tab-bar'); if (!bar) return;
    document.body.classList.toggle('has-tabs', tabs.length > 1);
    if (tabs.length <= 1) { bar.innerHTML = ''; return; }
    bar.innerHTML = tabs.map(t =>
      '<div class="tab' + (t.uri === activeTabUri ? ' active' : '') + '" data-uri="' + escHtml(t.uri) + '">'
      + (t.isAiConfig ? '<span class="tab-ai">✦</span>' : '')
      + '<span class="tab-name">' + escHtml(t.filename) + '</span>'
      + '<button class="tab-close" data-uri="' + escHtml(t.uri) + '">×</button>'
      + '</div>'
    ).join('');
    qsa('.tab', bar).forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.tab-close')) return;
        switchToTab(el.getAttribute('data-uri'));
      });
    });
    qsa('.tab-close', bar).forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); closeTab(el.getAttribute('data-uri')); });
    });
  }

  function switchToTab(uri) {
    if (!uri || uri === activeTabUri) return;
    const curTab = tabs.find(t => t.uri === activeTabUri);
    if (curTab) {
      curTab.scrollTop = qs('#scroller')?.scrollTop || 0;
      if (editMode) curTab.markdown = qs('#edit-area')?.value || curTab.markdown;
    }
    const tab = tabs.find(t => t.uri === uri); if (!tab) return;
    activeTabUri = uri;
    currentUri = uri;
    const body = qs('#scroller .markdown-body');
    if (body) { body.innerHTML = tab.html; }
    const spBody = qs('#split-preview .markdown-body');
    if (spBody) spBody.innerHTML = tab.html;
    currentMarkdown = tab.markdown;
    const fnEl = qs('.fname'); if (fnEl) fnEl.textContent = tab.filename;
    const aiBadge = qs('.ai-badge');
    if (aiBadge) {
      aiBadge.textContent = tab.aiKind ? '✦ ' + tab.aiKind : '✦ AI';
      aiBadge.style.display = tab.isAiConfig ? '' : 'none';
    }
    updateStats(tab.markdown);
    if (tab.isAiConfig && !isAutoEditDismissed(uri)) { if (!editMode) enterEditMode(); }
    else { if (editMode) exitEditMode(false, false, false); }
    setTimeout(() => { if (qs('#scroller')) qs('#scroller').scrollTop = tab.scrollTop || 0; }, 40);
    buildTOC(); addCopyButtons(); setupHeadingAnchors();
    if (qs('#scroller .language-mermaid')) setupMermaid();
    renderTabBar();
    updateFileListActive(uri);
    vsc.postMessage({ type: 'setActiveDoc', uri });
  }

  function closeTab(uri) {
    const idx = tabs.findIndex(t => t.uri === uri); if (idx === -1) return;
    tabs.splice(idx, 1);
    if (activeTabUri === uri) {
      const next = tabs[idx] || tabs[idx - 1];
      if (next) switchToTab(next.uri); else activeTabUri = null;
    }
    renderTabBar();
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  if (typeof __FILES__ !== 'undefined') renderFileList(__FILES__);
  buildTOC(); setupScrollSpy(); addCopyButtons(); setupHeadingAnchors(); setupMermaid();
  renderTabBar();
  qs('#btn-sidebar')?.classList.add('on');
})();
`;

// ─── Icons ───────────────────────────────────────────────────────────────────

const ICON = {
  logo: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="-webkit-text-fill-color:initial"><rect x="1" y="1" width="14" height="14" rx="3" fill="url(#lgr)"/><path d="M4 5h8M4 8h6M4 11h7" stroke="white" stroke-width="1.5" stroke-linecap="round"/><defs><linearGradient id="lgr" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#F97316"/><stop offset="100%" stop-color="#EF4444"/></linearGradient></defs></svg>`,
  sidebar: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`,
  copyMd: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  copyHtml: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  source: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 13l-2 2 2 2"/><path d="M14 13l2 2-2 2"/></svg>`,
  print: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  focus: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`,
  arrowUp: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  chevron: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  link: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  image: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  ul: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/></svg>`,
  ol: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 7h1V4" stroke-linecap="round"/><path d="M3 11h2v1H3v1h2" stroke-linecap="round"/></svg>`,
  export: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  pdf: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/></svg>`,
  palette: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
  paste: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`,
  undo: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`,
  redo:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>`,
  indent:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="8" x2="15" y2="8"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="16" x2="15" y2="16"/><polyline points="17 8 21 12 17 16"/></svg>`,
  outdent: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="8" x2="21" y2="8"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="9" y1="16" x2="21" y2="16"/><polyline points="7 8 3 12 7 16"/></svg>`,
};

// ─── Panel ───────────────────────────────────────────────────────────────────

export class MarkdownPreviewPanel {
  public  static currentPanel: MarkdownPreviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _document: vscode.TextDocument;
  private readonly _disposables: vscode.Disposable[] = [];
  private _editMode = false;
  private _clipboardMode = false;   // true while clipboard preview is the active overlay
  private _filesCache: FileEntry[] = [];
  private _filesCacheValid = false;
  private _renderTimer: ReturnType<typeof setTimeout> | undefined;
  private _filesScanPromise: Promise<FileEntry[]> | undefined;

  public static createOrShow(document: vscode.TextDocument): void {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
    if (MarkdownPreviewPanel.currentPanel) {
      MarkdownPreviewPanel.currentPanel._panel.reveal(column);
      MarkdownPreviewPanel.currentPanel._document = document;
      MarkdownPreviewPanel.currentPanel._editMode = false;
      MarkdownPreviewPanel.currentPanel._render();
      return;
    }
    const panel = vscode.window.createWebviewPanel('markr', 'Markr', column, { enableScripts: true, retainContextWhenHidden: true });
    MarkdownPreviewPanel.currentPanel = new MarkdownPreviewPanel(panel, document);
  }

  public static update(document: vscode.TextDocument): void {
    const p = MarkdownPreviewPanel.currentPanel;
    if (!p) return;
    if (p._document.uri.toString() !== document.uri.toString()) return;
    if (p._editMode) return;
    p._scheduleRender();
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
    p._filesCacheValid = false; // force re-scan when files actually change on disk
    const files = await p._getWorkspaceFiles();
    p._panel.webview.postMessage({ type: 'updateFiles', files });
  }

  /**
   * Show clipboard content as a temporary overlay in the current (or new) panel.
   * Called both from the markr.pastePreview command and the webview toolbar button.
   * Does NOT change this._document so scroll-sync / save stay pointed at the real file.
   */
  public static async showClipboard(text: string): Promise<void> {
    if (MarkdownPreviewPanel.currentPanel) {
      MarkdownPreviewPanel.currentPanel._panel.reveal(undefined, true);
      MarkdownPreviewPanel.currentPanel._sendClipboardPreview(text);
      return;
    }
    // No panel open — create one using the clipboard text as a placeholder document.
    const doc = await vscode.workspace.openTextDocument({ content: text, language: 'markdown' });
    MarkdownPreviewPanel.createOrShow(doc);
    // After panel construction, immediately override with clipboard overlay so the
    // banner shows and the user can save to a real .md file.
    setTimeout(() => { MarkdownPreviewPanel.currentPanel?._sendClipboardPreview(text); }, 300);
  }

  /** Send clipboard preview to the webview as a temporary overlay (no tab mutation). */
  public _sendClipboardPreview(text: string): void {
    this._clipboardMode = true;
    const rawText = text;
    const { meta, body } = extractFrontmatter(rawText);
    const rendered = applyGithubAlerts(marked.parse(body) as string);
    const stats = docStats(rawText);
    this._panel.webview.postMessage({
      type: 'fileLoaded',
      uri: 'clipboard:preview',   // sentinel URI — never stored in tabs[]
      filename: 'Clipboard',
      html: (meta ? renderFrontmatter(meta) : '') + rendered,
      markdown: rawText,
      isAiConfig: false,
      isClipboard: true,
      tokStr: tokenEstimate(stats.chars),
      statsTitle: `${stats.words.toLocaleString()} words · ${stats.headings} headings · ${stats.codeBlocks} code blocks`,
      words: stats.words,
      readMins: Math.max(1, Math.ceil(stats.words / 200)),
    });
  }

  private constructor(panel: vscode.WebviewPanel, document: vscode.TextDocument) {
    this._panel = panel;
    this._document = document;
    this._render();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    vscode.window.onDidChangeActiveColorTheme(() => this._render(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(async msg => {
      if (msg.type === 'openLink') { vscode.env.openExternal(vscode.Uri.parse(msg.href)); }
      if (msg.type === 'copyMarkdown') {
        vscode.env.clipboard.writeText(this._document.getText()).then(() =>
          vscode.window.setStatusBarMessage('$(check) Markr: Markdown copied', 3000)
        );
      }
      if (msg.type === 'pastePreview') {
        const text = await vscode.env.clipboard.readText();
        if (!text.trim()) {
          vscode.window.showInformationMessage('Clipboard is empty — copy some Markdown first.');
          return;
        }
        // IMPORTANT: do NOT change this._document — clipboard is a temporary overlay.
        // The tracked document must stay the same so edits, saves, and scroll-sync
        // continue to work correctly after the user dismisses the clipboard banner.
        this._sendClipboardPreview(text);
      }
      if (msg.type === 'saveClipboardAs') {
        const defaultDir = vscode.workspace.workspaceFolders?.[0]?.uri
          ?? vscode.Uri.file(os.homedir());
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: defaultDir.with({ path: defaultDir.path + '/clipboard.md' }),
          filters: { 'Markdown files': ['md'] },
        });
        if (!saveUri) return;
        this._clipboardMode = false; // clipboard content is now a real file
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(msg.markdown, 'utf-8'));
        // Reload as a real on-disk file (banner will close because isClipboard is absent)
        const doc = await vscode.workspace.openTextDocument(saveUri);
        this._document = doc;
        const rawText = doc.getText();
        const filename = saveUri.path.split('/').pop() ?? 'untitled.md';
        const relPath = vscode.workspace.asRelativePath(saveUri);
        const aiKind = aiDocKind(filename, relPath);
        const { meta, body } = extractFrontmatter(rawText);
        const rendered = applyGithubAlerts(marked.parse(body) as string);
        const stats = docStats(rawText);
        this._filesCacheValid = false;
        this._panel.webview.postMessage({
          type: 'fileLoaded',
          uri: doc.uri.toString(),
          filename,
          html: (meta ? renderFrontmatter(meta) : '') + rendered,
          markdown: rawText,
          isAiConfig: !!aiKind,
          aiKind,
          isClipboard: false,
          tokStr: tokenEstimate(stats.chars),
          statsTitle: `${stats.words.toLocaleString()} words · ${stats.headings} headings · ${stats.codeBlocks} code blocks`,
          words: stats.words,
          readMins: Math.max(1, Math.ceil(stats.words / 200)),
        });
        // Restore Markr to the foreground — the Save dialog shifts VS Code focus
        // away from the webview. preserveFocus=true keeps keyboard in the panel.
        this._panel.reveal(this._panel.viewColumn ?? vscode.ViewColumn.Beside, true);
        vscode.window.setStatusBarMessage(`$(check) Markr: saved ${filename}`, 3000);
        this._getWorkspaceFiles().then(files => {
          this._panel.webview.postMessage({ type: 'updateFiles', files });
        });
      }
      if (msg.type === 'openInEditor') {
        const uri = msg.uri ? vscode.Uri.parse(msg.uri) : this._document.uri;
        const doc = await vscode.workspace.openTextDocument(uri);
        this._document = doc;
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: false,
          preview: false,
        });
      }
      if (msg.type === 'edit') {
        this._editMode = true;
        // Clipboard mode: just re-render, never write to the real document on disk
        if (this._clipboardMode) {
          const html = applyGithubAlerts(marked.parse(msg.content) as string);
          this._panel.webview.postMessage({ type: 'updateSplitPreview', html });
          return;
        }
        // Normal edit: live preview update only — no disk write until user explicitly saves.
        let doc = this._document;
        if (msg.uri) {
          try {
            doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(msg.uri));
          } catch {
            doc = this._document;
          }
        }
        this._document = doc;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), msg.content);
        await vscode.workspace.applyEdit(edit); // keep VS Code document in sync (shows ● dot)
        // No workspace.save() here — user must press ⌘S or click the Save button
        const html = applyGithubAlerts(marked.parse(msg.content) as string);
        this._panel.webview.postMessage({ type: 'updateSplitPreview', html });
      }
      if (msg.type === 'dismissClipboard') {
        this._clipboardMode = false;
      }
      if (msg.type === 'saveFile') {
        // Explicit save triggered by the user (⌘S or Save button).
        let doc = this._document;
        if (msg.uri) {
          try { doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(msg.uri)); } catch { doc = this._document; }
        }
        this._document = doc;
        if (typeof msg.content === 'string') {
          // Apply the latest content in case the debounce timer hasn't fired yet
          const edit = new vscode.WorkspaceEdit();
          edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), msg.content);
          await vscode.workspace.applyEdit(edit);
        }
        await vscode.workspace.save(doc.uri);
        this._panel.webview.postMessage({ type: 'saved' });
        vscode.window.setStatusBarMessage('$(check) Markr: saved', 2000);
      }
      if (msg.type === 'modeChange') {
        this._editMode = msg.mode === 'edit';
      }
      if (msg.type === 'openFile') {
        vscode.workspace.openTextDocument(vscode.Uri.parse(msg.uri)).then(doc => {
          this._document = doc;
          const rawText = doc.getText();
          const filename = doc.uri.path.split('/').pop() ?? 'untitled';
          const relPath = vscode.workspace.asRelativePath(doc.uri);
          const aiKind = aiDocKind(filename, relPath);
          const { meta, body } = extractFrontmatter(rawText);
          const rendered = applyGithubAlerts(marked.parse(body) as string);
          const stats = docStats(rawText);
          // No `files` here — webview updates active state from msg.uri (no full list re-render)
          this._panel.webview.postMessage({
            type: 'fileLoaded',
            uri: doc.uri.toString(),
            filename,
            html: (meta ? renderFrontmatter(meta) : '') + rendered,
            markdown: rawText,
            isAiConfig: !!aiKind,
            aiKind,
            tokStr: tokenEstimate(stats.chars),
            statsTitle: `${stats.words.toLocaleString()} words · ${stats.headings} headings · ${stats.codeBlocks} code blocks`,
            words: stats.words,
            readMins: Math.max(1, Math.ceil(stats.words / 200)),
          });
        });
      }
      if (msg.type === 'setActiveDoc') {
        vscode.workspace.openTextDocument(vscode.Uri.parse(msg.uri)).then(doc => {
          this._document = doc;
        });
      }
      if (msg.type === 'newFile') { vscode.commands.executeCommand('workbench.action.files.newUntitledFile'); }
      if (msg.type === 'pasteImage') { await this._handleImagePaste(msg.base64, msg.ext); }
      if (msg.type === 'exportHtml') { await this._handleExportHtml(); }
      if (msg.type === 'exportPdf')  { await this._handleExportPdf(); }
      if (msg.type === 'print')      { await this._handlePrint(); }
    }, null, this._disposables);
  }

  private _render(): void {
    if (this._renderTimer) {
      clearTimeout(this._renderTimer);
      this._renderTimer = undefined;
    }
    const rawText = this._document.getText();
    const { meta, body: mdBody } = extractFrontmatter(rawText);
    const rendered = applyGithubAlerts(marked.parse(mdBody) as string);
    const frontmatterHtml = meta ? renderFrontmatter(meta) : '';
    const stats    = docStats(rawText);
    const filename = this._document.uri.path.split('/').pop() ?? 'preview';
    this._panel.title = `Markr — ${filename}`;
    const files = this._filesCacheValid ? this._filesCache : [];
    this._panel.webview.html = this._buildPage(frontmatterHtml + rendered, filename, stats, rawText, files, !this._filesCacheValid);
    if (!this._filesCacheValid) {
      this._getWorkspaceFiles().then(files => {
        this._panel.webview.postMessage({ type: 'updateFiles', files });
      });
    }
  }

  private _scheduleRender(): void {
    if (this._renderTimer) clearTimeout(this._renderTimer);
    this._renderTimer = setTimeout(() => this._render(), 120);
  }

  private async _getWorkspaceFiles(): Promise<FileEntry[]> {
    if (!this._filesCacheValid) {
      try {
        if (this._filesScanPromise) {
          await this._filesScanPromise;
        } else {
          this._filesScanPromise = (async () => {
            const maxFiles = vscode.workspace.getConfiguration('markr').get<number>('maxWorkspaceFiles', 500);
            const uris = await vscode.workspace.findFiles(
              '**/*.md',
              '{**/node_modules/**,**/.git/**,**/.vscode/**,**/.next/**,**/out/**,**/dist/**}',
              maxFiles
            );
            this._filesCache = uris
              .sort((a, b) => vscode.workspace.asRelativePath(a).localeCompare(vscode.workspace.asRelativePath(b)))
              .map(uri => {
                const relPath = vscode.workspace.asRelativePath(uri);
                const parts   = relPath.split('/');
                const label   = parts[parts.length - 1];
                const dir     = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
                const aiKind = aiDocKind(label, relPath);
                return { label, relPath, uri: uri.toString(), active: false, dir, isAiConfig: !!aiKind, aiKind };
              });
            this._filesCacheValid = true;
            return this._filesCache;
          })();
          await this._filesScanPromise;
        }
      } catch { this._filesCache = []; }
      finally { this._filesScanPromise = undefined; }
    }
    // Update active flag in-place (no allocation)
    const currentUri = this._document.uri.toString();
    this._filesCache.forEach(f => { f.active = f.uri === currentUri; });
    return this._filesCache;
  }

  private async _handleImagePaste(base64: string, ext: string): Promise<void> {
    const docUri  = this._document.uri;
    const docDir  = docUri.with({ path: docUri.path.replace(/[^/]*$/, '') });
    const imgDir  = docDir.with({ path: docDir.path + 'images/' });
    const fname   = `paste-${Date.now()}.${ext || 'png'}`;
    const imgUri  = imgDir.with({ path: imgDir.path + fname });
    try {
      await vscode.workspace.fs.createDirectory(imgDir);
      await vscode.workspace.fs.writeFile(imgUri, Buffer.from(base64, 'base64'));
      this._panel.webview.postMessage({ type: 'imagePasted', path: `./images/${fname}` });
      vscode.window.setStatusBarMessage(`$(check) Markr: saved images/${fname}`, 3000);
    } catch (e) {
      vscode.window.showErrorMessage(`Markr: could not save image — ${String(e)}`);
    }
  }

  private async _handleExportHtml(): Promise<void> {
    const rawText  = this._document.getText();
    const { meta, body } = extractFrontmatter(rawText);
    const content  = (meta ? renderFrontmatter(meta) : '') + applyGithubAlerts(marked.parse(body) as string);
    const filename = this._document.uri.path.split('/').pop()?.replace(/\.md$/i, '.html') ?? 'export.html';
    const dir      = this._document.uri.with({ path: this._document.uri.path.replace(/[^/]*$/, '') });
    const saveUri  = await vscode.window.showSaveDialog({
      defaultUri: dir.with({ path: dir.path + filename }),
      filters: { 'HTML files': ['html'] },
    });
    if (!saveUri) return;
    await vscode.workspace.fs.writeFile(saveUri, Buffer.from(buildPdfHtml(content, filename.replace('.html', '')), 'utf-8'));
    vscode.window.showInformationMessage(`Markr: exported ${saveUri.fsPath.split('/').pop()}`);
  }

  private async _handlePrint(): Promise<void> {
    const rawText = this._document.getText();
    const { meta, body } = extractFrontmatter(rawText);
    const fullHtml = buildPdfHtml(
      (meta ? renderFrontmatter(meta) : '') + applyGithubAlerts(marked.parse(body) as string),
      this._document.uri.path.split('/').pop()?.replace(/\.md$/i, '') ?? 'document'
    );
    const tmpFile = nodePath.join(os.tmpdir(), `markr-print-${Date.now()}.html`);
    fs.writeFileSync(tmpFile, fullHtml, 'utf-8');
    vscode.env.openExternal(vscode.Uri.file(tmpFile));
    vscode.window.setStatusBarMessage('$(check) Markr: opened in browser — use Cmd+P to print', 4000);
  }

  private _findChrome(): string | null {
    const candidates = process.platform === 'win32' ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ] : process.platform === 'darwin' ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ] : [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ];
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch { /* skip */ }
    }
    return null;
  }

  private async _handleExportPdf(): Promise<void> {
    const rawText  = this._document.getText();
    const filename = this._document.uri.path.split('/').pop()?.replace(/\.md$/i, '.pdf') ?? 'export.pdf';
    const dir      = this._document.uri.with({ path: this._document.uri.path.replace(/[^/]*$/, '') });

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: dir.with({ path: dir.path + filename }),
      filters: { 'PDF files': ['pdf'] },
    });
    if (!saveUri) return;

    const { meta, body } = extractFrontmatter(rawText);
    const fullHtml = buildPdfHtml(
      (meta ? renderFrontmatter(meta) : '') + applyGithubAlerts(marked.parse(body) as string),
      filename.replace('.pdf', '')
    );

    const chromePath = this._findChrome();
    if (!chromePath) {
      // No Chrome — write HTML, open in browser, user can Cmd+P → Save as PDF
      const tmpFile = nodePath.join(os.tmpdir(), `markr-print-${Date.now()}.html`);
      fs.writeFileSync(tmpFile, fullHtml, 'utf-8');
      vscode.env.openExternal(vscode.Uri.file(tmpFile));
      vscode.window.showInformationMessage('Chrome not found — file opened in browser. Use Cmd+P → Save as PDF.');
      return;
    }

    const tmpFile = nodePath.join(os.tmpdir(), `markr-pdf-${Date.now()}.html`);
    fs.writeFileSync(tmpFile, fullHtml, 'utf-8');
    const fileUrl = `file://${tmpFile.replace(/\\/g, '/')}`;

    const statusHandle = vscode.window.setStatusBarMessage('$(loading~spin) Markr: generating PDF…', 60000);

    const tryChrome = (headlessFlag: string): Promise<boolean> =>
      new Promise(resolve => {
        const args = [
          headlessFlag,
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          `--print-to-pdf=${saveUri.fsPath}`,
          '--no-pdf-header-footer',
          fileUrl,
        ];
        const proc = cp.spawn(chromePath, args);
        proc.on('close', code => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });

    await new Promise<void>(async resolve => {
      let ok = await tryChrome('--headless=new');
      if (!ok) ok = await tryChrome('--headless');

      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      statusHandle.dispose();

      if (ok) {
        vscode.window.showInformationMessage(`Markr: PDF saved → ${saveUri.fsPath.split('/').pop()}`);
        vscode.window.setStatusBarMessage('$(check) Markr: PDF exported', 3000);
      } else {
        vscode.window.showWarningMessage('Markr: Chrome PDF failed — opening in browser for manual Save as PDF.');
        const fallback = nodePath.join(os.tmpdir(), `markr-print-${Date.now()}.html`);
        fs.writeFileSync(fallback, fullHtml, 'utf-8');
        vscode.env.openExternal(vscode.Uri.file(fallback));
      }
      resolve();
    });
  }

  private _buildPage(body: string, filename: string, stats: ReturnType<typeof docStats>, text: string, files: FileEntry[], filesLoading: boolean): string {
    const nonce      = getNonce();
    const theme      = vscode.window.activeColorTheme;
    const isDark     = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;
    const mode       = isDark ? 'dark' : 'light';
    const cfg        = vscode.workspace.getConfiguration('markr');
    const showTOC    = cfg.get<boolean>('showTOC', true);
    const mdJson     = JSON.stringify(text);
    const filesJson  = JSON.stringify(files);
    const filesLoadingJson = JSON.stringify(filesLoading);
    const currentUriJson = JSON.stringify(this._document.uri.toString());
    const relPath    = vscode.workspace.asRelativePath(this._document.uri);
    const aiKind     = aiDocKind(filename, relPath);
    const autoEdit   = !!aiKind;
    const tokStr     = tokenEstimate(stats.chars);
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

<!-- Toolbar -->
<div id="toolbar">
  <div class="tl">
    <button id="btn-sidebar" class="tb-btn on" title="Toggle sidebar">${ICON.sidebar}</button>
    <span class="logo-mark">${ICON.logo} Markr</span>
    <span class="sep-dot">·</span>
    <span class="fname" title="${filename}">${filename}</span>
    <span class="ai-badge" style="${autoEdit ? '' : 'display:none'}">✦ ${aiKind || 'AI'}</span>
  </div>
  <div class="tr">
    <span class="stats" title="${statsTitle}">
      <span id="stat-time">${readingTime(stats.words)}</span>m
      · <span id="stat-words">${stats.words.toLocaleString()}</span>w
      · <span id="stat-tok" class="${autoEdit ? 'stats-accent' : ''}" title="${stats.chars.toLocaleString()} chars">${tokStr}</span>
    </span>
    <span id="save-status" class="save-status"></span>
    <span id="diff-chip"></span>
    <div class="sep-v"></div>
    <button id="btn-edit" class="tb-btn${autoEdit ? ' accent' : ''}" title="Split edit mode">${autoEdit ? '⚡ Edit' : 'Edit'}</button>
    <button id="btn-save-file" class="tb-btn" title="Save (⌘S / Ctrl+S)">Save</button>
    <button id="btn-source" class="tb-btn" title="Open Markdown source in VS Code editor">${ICON.source} Source</button>
    <div class="sep-v"></div>
    <button id="btn-paste-preview" class="tb-btn" title="Preview Clipboard — instantly render Markdown you copied from Claude, ChatGPT, Notion, or anywhere. No file needed.">${ICON.paste} Preview Clipboard</button>
    <div class="sep-v"></div>
    <button id="btn-copy-md"   class="tb-btn" title="Copy Markdown">${ICON.copyMd} MD</button>
    <button id="btn-copy-html" class="tb-btn" title="Copy HTML">${ICON.copyHtml} HTML</button>
    <button id="btn-export"    class="tb-btn" title="Export to .html file">${ICON.export} HTML</button>
    <button id="btn-pdf"       class="tb-btn" title="Export to PDF">${ICON.pdf} PDF</button>
    <button id="btn-print"     class="tb-btn" title="Print / Save as PDF">${ICON.print}</button>
    <div class="sep-v"></div>
    <div class="theme-picker-wrap">
      <button id="btn-theme" class="tb-btn" title="Switch theme">${ICON.palette}</button>
      <div id="theme-menu">
        <button class="theme-opt" data-theme="light"><span class="theme-dot" style="background:linear-gradient(135deg,#F97316,#EF4444)"></span>Markr Light</button>
        <button class="theme-opt" data-theme="dark"><span class="theme-dot" style="background:#2a2520;border:1px solid #48443e"></span>Markr Dark</button>
        <button class="theme-opt" data-theme="notion"><span class="theme-dot" style="background:#fff;border:1px solid #e9e9e7"></span>Notion</button>
        <button class="theme-opt" data-theme="linear"><span class="theme-dot" style="background:#5e6ad2"></span>Linear</button>
      </div>
    </div>
    <div class="sep-v"></div>
    <button id="btn-focus" class="tb-btn" title="Focus mode">${ICON.focus}</button>
  </div>
</div>

<div id="tab-bar"></div>

<!-- Format Toolbar (edit mode) -->
<div id="fmt-toolbar">
  <div class="fmt-group">
    <button class="fmt-btn" id="btn-undo" title="Undo (⌘Z)">${ICON.undo}</button>
    <button class="fmt-btn" id="btn-redo" title="Redo (⌘⇧Z)">${ICON.redo}</button>
  </div>
  <div class="fmt-sep"></div>
  <div class="fmt-group">
    <button class="fmt-btn" data-action="bold"  title="Bold (⌘B)"><b>B</b></button>
    <button class="fmt-btn" data-action="italic" title="Italic (⌘I)"><i>I</i></button>
    <button class="fmt-btn" data-action="strike" title="Strikethrough"><s>S</s></button>
    <button class="fmt-btn" data-action="code"  title="Inline code (⌘\`)"><code style="font-size:12px;background:transparent">&#96;</code></button>
    <button class="fmt-btn" data-action="codeblock" title="Code block">${ICON.copyHtml}</button>
  </div>
  <div class="fmt-sep"></div>
  <div class="fmt-group">
    <button class="fmt-btn h-btn" data-action="h1" title="H1 (⌘⇧1)">H1</button>
    <button class="fmt-btn h-btn" data-action="h2" title="H2 (⌘⇧2)">H2</button>
    <button class="fmt-btn h-btn" data-action="h3" title="H3 (⌘⇧3)">H3</button>
    <button class="fmt-btn h-btn" data-action="h4" title="H4">H4</button>
  </div>
  <div class="fmt-sep"></div>
  <div class="fmt-group">
    <button class="fmt-btn" data-action="link"  title="Link (⌘K)">${ICON.link}</button>
    <button class="fmt-btn" data-action="image" title="Image">${ICON.image}</button>
    <button class="fmt-btn" data-action="quote" title="Blockquote" style="font-size:15px;font-style:italic">"</button>
  </div>
  <div class="fmt-sep"></div>
  <div class="fmt-group">
    <button class="fmt-btn" data-action="ul"   title="Bullet list">${ICON.ul}</button>
    <button class="fmt-btn" data-action="ol"   title="Numbered list">${ICON.ol}</button>
    <button class="fmt-btn" data-action="task" title="Task list" style="font-size:13px">☐</button>
    <button class="fmt-btn" data-action="table" title="Table" style="font-size:13px">⊞</button>
    <button class="fmt-btn" data-action="hr" title="Divider" style="font-size:16px;letter-spacing:-2px">——</button>
  </div>
  <div class="fmt-sep"></div>
  <div class="fmt-group">
    <button class="fmt-btn" data-action="indent"  title="Indent (Tab)">${ICON.indent}</button>
    <button class="fmt-btn" data-action="outdent" title="Outdent (⇧Tab)">${ICON.outdent}</button>
  </div>
  <div class="fmt-sep"></div>
  <div class="fmt-group">
    <button class="fmt-btn" id="btn-wrap" title="Toggle word wrap" style="font-size:11px;letter-spacing:-0.5px">Wrap</button>
  </div>
</div>

<!-- Layout -->
<div id="outer-layout">
  <div id="sidebar">
    <div class="sb-section" id="sec-files">
      <div class="sb-header">
        <span class="sb-title">Notebooks</span>
        <button class="sb-action" id="btn-new-file" title="New file">+</button>
        <span class="sb-chevron">${ICON.chevron}</span>
      </div>
      <div id="file-search-wrap">
        <svg class="file-search-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="file-search" type="text" placeholder="Filter files…" autocomplete="off" spellcheck="false">
        <button id="file-search-clear" title="Clear filter">×</button>
      </div>
      <div class="sb-body" id="files-list"></div>
    </div>
    <div class="sb-section flex-fill ${showTOC ? '' : 'collapsed'}" id="sec-toc">
      <div class="sb-header">
        <span class="sb-title">On this page</span>
        <span class="sb-chevron">${ICON.chevron}</span>
      </div>
      <div class="sb-body" id="toc-body"></div>
    </div>
  </div>
  <div id="main-col">
    <!-- Clipboard preview banner — shown when content comes from clipboard -->
    <div id="clipboard-banner">
      <span class="cb-label">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
        Paste &amp; preview — type or paste markdown on the left · not saved to disk
      </span>
      <div class="cb-actions">
        <button class="cb-save" id="btn-save-clipboard" title="Save the current content as a .md file">Save as .md</button>
        <button class="cb-dismiss" id="btn-dismiss-clipboard" title="Close clipboard preview and return to your file">Close</button>
      </div>
    </div>
    <div id="main">
      <div id="scroller"><article class="markdown-body">${body}</article></div>
      <textarea id="edit-area" spellcheck="false" autocorrect="off" autocapitalize="off" placeholder="Start writing Markdown…"></textarea>
      <div id="split-resizer" title="Drag to resize editor and preview"></div>
      <div id="split-preview"><article class="markdown-body">${body}</article></div>
    </div>
  </div>
</div>

<button id="top-btn" title="Back to top">${ICON.arrowUp}</button>
<div id="rich-copy-toast">✓ Copied with formatting</div>

<!-- Mermaid zoom modal -->
<div class="mermaid-modal" id="mermaid-modal">
  <div class="mermaid-modal-backdrop" id="mermaid-modal-backdrop"></div>
  <div class="mermaid-modal-box">
    <div class="mermaid-modal-header">
      <span>Diagram</span>
      <div class="mermaid-modal-controls">
        <button id="mermaid-zoom-out" title="Zoom out">−</button>
        <span class="zoom-level" id="mermaid-zoom-level">100%</span>
        <button id="mermaid-zoom-in"  title="Zoom in">+</button>
        <button id="mermaid-zoom-reset" title="Reset zoom">Reset</button>
        <div style="width:1px;height:16px;background:var(--border);margin:0 4px;flex-shrink:0"></div>
        <button id="mermaid-copy-img" title="Copy diagram as PNG image">🖼 Copy image</button>
        <button class="mermaid-modal-close" id="mermaid-modal-close">✕</button>
      </div>
    </div>
    <div class="mermaid-modal-body">
      <div class="mermaid-zoom-inner" id="mermaid-zoom-inner"></div>
    </div>
  </div>
</div>

<!-- Quick Open overlay (Cmd+K) -->
<div id="quick-open">
  <div class="qo-backdrop" id="qo-backdrop"></div>
  <div class="qo-panel">
    <input id="qo-input" type="text" placeholder="Search files… (↑↓ navigate, Enter open, Esc close)" autocomplete="off">
    <div class="qo-hint">⌘K to open · ? for shortcuts</div>
    <div class="qo-results" id="qo-results"></div>
  </div>
</div>

<!-- Keyboard Shortcuts overlay (?) -->
<div id="shortcuts-panel">
  <div class="sp-backdrop" id="sp-backdrop"></div>
  <div class="sp-card">
    <div class="sp-hdr">
      <h3 class="sp-title">Keyboard Shortcuts</h3>
      <button class="sp-close" id="sp-close">✕</button>
    </div>
    <div class="sp-section">
      <div class="sp-section-title">Navigation</div>
      <div class="sp-row"><span class="sp-desc">Open Markr preview</span><div class="sp-keys"><span class="sp-key">⌘⇧M</span></div></div>
      <div class="sp-row"><span class="sp-desc">Quick file search</span><div class="sp-keys"><span class="sp-key">⌘K</span></div></div>
      <div class="sp-row"><span class="sp-desc">Show shortcuts</span><div class="sp-keys"><span class="sp-key">?</span></div></div>
      <div class="sp-row"><span class="sp-desc">Close overlay / exit edit</span><div class="sp-keys"><span class="sp-key">Esc</span></div></div>
    </div>
    <div class="sp-section">
      <div class="sp-section-title">Editing</div>
      <div class="sp-row"><span class="sp-desc">Toggle split edit mode</span><div class="sp-keys"><span class="sp-key">Edit button</span></div></div>
      <div class="sp-row"><span class="sp-desc">Bold</span><div class="sp-keys"><span class="sp-key">⌘B</span></div></div>
      <div class="sp-row"><span class="sp-desc">Italic</span><div class="sp-keys"><span class="sp-key">⌘I</span></div></div>
      <div class="sp-row"><span class="sp-desc">Link</span><div class="sp-keys"><span class="sp-key">⌘K</span></div></div>
      <div class="sp-row"><span class="sp-desc">Inline code</span><div class="sp-keys"><span class="sp-key">⌘&#96;</span></div></div>
      <div class="sp-row"><span class="sp-desc">Heading 1 / 2 / 3</span><div class="sp-keys"><span class="sp-key">⌘⇧1</span><span class="sp-key">⌘⇧2</span><span class="sp-key">⌘⇧3</span></div></div>
      <div class="sp-row"><span class="sp-desc">Indent (Tab)</span><div class="sp-keys"><span class="sp-key">Tab</span></div></div>
      <div class="sp-row"><span class="sp-desc">Continue list (Enter)</span><div class="sp-keys"><span class="sp-key">↵</span></div></div>
      <div class="sp-row"><span class="sp-desc">Paste image from clipboard</span><div class="sp-keys"><span class="sp-key">⌘V</span> <span style="font-size:11px;color:var(--text-faint)">(with image)</span></div></div>
    </div>
    <div class="sp-section">
      <div class="sp-section-title">Toolbar</div>
      <div class="sp-row"><span class="sp-desc">Copy raw Markdown</span><div class="sp-keys"><span class="sp-key">MD button</span></div></div>
      <div class="sp-row"><span class="sp-desc">Copy rendered HTML</span><div class="sp-keys"><span class="sp-key">HTML button</span></div></div>
      <div class="sp-row"><span class="sp-desc">Export to .html file</span><div class="sp-keys"><span class="sp-key">↓ button</span></div></div>
      <div class="sp-row"><span class="sp-desc">Export to PDF (needs Chrome)</span><div class="sp-keys"><span class="sp-key">PDF button</span></div></div>
      <div class="sp-row"><span class="sp-desc">Print / Save as PDF</span><div class="sp-keys"><span class="sp-key">Print button</span></div></div>
      <div class="sp-row"><span class="sp-desc">Focus / reading mode</span><div class="sp-keys"><span class="sp-key">⊡ button</span></div></div>
    </div>
    <div class="sp-section">
      <div class="sp-section-title">GitHub Alerts (in any .md)</div>
      <div class="sp-row"><span class="sp-desc">Info callout</span><div class="sp-keys"><span class="sp-key">&gt; [!NOTE]</span></div></div>
      <div class="sp-row"><span class="sp-desc">Tip callout</span><div class="sp-keys"><span class="sp-key">&gt; [!TIP]</span></div></div>
      <div class="sp-row"><span class="sp-desc">Important callout</span><div class="sp-keys"><span class="sp-key">&gt; [!IMPORTANT]</span></div></div>
      <div class="sp-row"><span class="sp-desc">Warning callout</span><div class="sp-keys"><span class="sp-key">&gt; [!WARNING]</span></div></div>
      <div class="sp-row"><span class="sp-desc">Caution callout</span><div class="sp-keys"><span class="sp-key">&gt; [!CAUTION]</span></div></div>
    </div>
  </div>
</div>

<script nonce="${nonce}">
  const __MD__       = ${mdJson};
  const __FILES__    = ${filesJson};
  const __FILES_LOADING__ = ${filesLoadingJson};
  const __CURRENT_URI__ = ${currentUriJson};
  const __AUTOEDIT__ = ${autoEdit};
</script>
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
