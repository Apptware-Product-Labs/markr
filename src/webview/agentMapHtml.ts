/**
 * agentMapHtml.ts — AI Agent Map webview: an interactive, pan/zoom *canvas* that
 * maps how a `.claude/` multi-agent repo is wired:
 *
 *   • A node graph — Capabilities → Agents → Schemas — on a zoomable/pannable
 *     canvas (scroll to zoom, drag to pan, fit/reset buttons), tier-colored, with
 *     hover-highlight of a node's connections and click-to-open the file.
 *   • Columns are dynamic: a repo with only `agents/` (no capabilities.yml, no
 *     schemas/) still renders a clean map — empty columns are dropped.
 *   • A roster below — each agent led by its plain-English description.
 *   • Needs attention — only real errors/warnings.
 *
 * Pure string builder; server-rendered with escaping. Themed with Markr's own
 * palette (Dark / Light / Notion / Linear) via a picker — independent of VS Code.
 */
import type { AgentIssue } from '../agentMap';
import { MARKR_THEME_TOKENS, themeOptionsHtml, type MarkrTheme } from './markrTheme';

export interface AgentView {
  file: string; name?: string; description?: string; model?: string;
  tools?: string[]; schemaRefs: string[];
  tier?: string;       // tier of the capability that runs it, if any
  wired: boolean;      // referenced by a capability
}
export interface CapabilityView {
  id?: string; agent?: string; tier?: string; enabled?: boolean;
  agentExists: boolean; description?: string;   // the agent's description
}

export interface AgentMapView {
  rootLabel: string;
  summary:   { errors: number; warnings: number; infos: number };
  issues:    AgentIssue[];
  agents:    AgentView[];
  capabilities: CapabilityView[];
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function trunc(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

const TIER_ORDER = ['blocking', 'parallel', 'background'];
const TIER_META: Record<string, { label: string; note: string; cls: string; col: string }> = {
  blocking:   { label: 'Blocking',   note: 'must pass before merge', cls: 'red',  col: 'var(--c-red)' },
  parallel:   { label: 'Parallel',   note: 'run together',           cls: 'blue', col: 'var(--c-blue)' },
  background: { label: 'Background', note: 'non-blocking',           cls: 'mut',  col: 'var(--muted)' },
  other:      { label: 'Other',      note: '',                       cls: 'mut',  col: 'var(--muted)' },
};
const tierCol = (t?: string) => (t && TIER_META[t] ? TIER_META[t].col : 'var(--accent)');

const SEV_ICON: Record<string, string> = { error: '✗', warning: '⚠', info: 'ℹ' };

function oneLine(d?: string): string {
  if (!d) return '';
  const s = d.split(/(?<=[.!?])\s/)[0].trim();
  return s.length > 150 ? s.slice(0, 147) + '…' : s;
}

/**
 * The interactive wiring canvas. Columns are dynamic: Capabilities and Schemas
 * only appear when present, so an agents-only repo still gets a clean map.
 * Returns { svg, height } — the panel wraps it with zoom controls.
 */
function graphSvg(d: AgentMapView): { body: string; empty: boolean } {
  const tierRank = (t?: string) => { const i = TIER_ORDER.indexOf(t || ''); return i < 0 ? 9 : i; };
  const caps = [...d.capabilities].sort((a, b) => tierRank(a.tier) - tierRank(b.tier));
  const nameOf = (a: AgentView) => a.name || a.file.replace(/\.md$/, '');
  const agentByName = new Map(d.agents.map(a => [nameOf(a), a]));

  // Agents ordered to follow the capabilities that run them (fewer crossings),
  // then any remaining/support agents.
  const agentOrder: string[] = []; const seenA = new Set<string>();
  for (const c of caps) if (c.agent && agentByName.has(c.agent) && !seenA.has(c.agent)) { agentOrder.push(c.agent); seenA.add(c.agent); }
  for (const a of d.agents) { const n = nameOf(a); if (!seenA.has(n)) { agentOrder.push(n); seenA.add(n); } }

  // Schemas referenced by agents, in first-seen order.
  const schemaOrder: string[] = []; const seenS = new Set<string>();
  for (const n of agentOrder) for (const s of (agentByName.get(n)?.schemaRefs || [])) if (!seenS.has(s)) { schemaOrder.push(s); seenS.add(s); }

  if (!agentOrder.length && !caps.length) return { body: '', empty: true };

  // Dynamic columns — drop any that are empty.
  type Col = 'cap' | 'agent' | 'schema';
  const present: Col[] = [];
  if (caps.length) present.push('cap');
  present.push('agent');
  if (schemaOrder.length) present.push('schema');

  const colW = 200, colGap = 84, padX = 16, padTop = 36, padBot = 16, nodeH = 32, rowH = 46;
  const contentW = padX * 2 + present.length * colW + (present.length - 1) * colGap;
  const counts = { cap: caps.length, agent: agentOrder.length, schema: schemaOrder.length };
  const rows = Math.max(counts.cap, counts.agent, counts.schema, 1);
  const contentH = padTop + rows * rowH + padBot;
  // Center the content inside a minimum viewport so sparse graphs (e.g. a single
  // AGENTS column) don't balloon when the viewBox scales up to fill the canvas.
  const W = Math.max(contentW, 720), H = Math.max(contentH, 320);
  const ox = (W - contentW) / 2, oy = (H - contentH) / 2;
  const xOf: Record<string, number> = {};
  present.forEach((c, i) => { xOf[c] = ox + padX + i * (colW + colGap); });
  const yOf = (i: number, count: number) => oy + padTop + (i + (rows - count) / 2) * rowH;
  const mid = (y: number) => y + nodeH / 2;

  const capIdx = new Map(caps.map((c, i) => [c.id || `?${i}`, i]));
  const agIdx  = new Map(agentOrder.map((n, i) => [n, i]));
  const scIdx  = new Map(schemaOrder.map((s, i) => [s, i]));

  const edgePath = (x1: number, y1: number, x2: number, y2: number, a: string, b: string, col: string, dashed: boolean) => {
    const dx = (x2 - x1) * 0.5;
    return `<path class="edge${dashed ? ' planned' : ''}" data-a="${a}" data-b="${b}" d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}" style="stroke:${col}"/>`;
  };

  let edges = '';
  if (xOf.cap !== undefined) caps.forEach(c => {
    if (!c.agent || !agentByName.has(c.agent)) return;
    const ci = capIdx.get(c.id || '')!, ai = agIdx.get(c.agent)!;
    const planned = c.enabled === false || !c.agentExists;
    edges += edgePath(xOf.cap + colW, mid(yOf(ci, counts.cap)), xOf.agent, mid(yOf(ai, counts.agent)),
      `c:${c.id}`, `a:${c.agent}`, tierCol(c.tier), planned);
  });
  if (xOf.schema !== undefined) agentOrder.forEach(n => {
    const a = agentByName.get(n); if (!a) return;
    const ai = agIdx.get(n)!;
    for (const s of a.schemaRefs) {
      edges += edgePath(xOf.agent + colW, mid(yOf(ai, counts.agent)), xOf.schema, mid(yOf(scIdx.get(s)!, counts.schema)),
        `a:${n}`, `s:${s}`, 'var(--c-green)', false);
    }
  });

  const node = (x: number, y: number, label: string, sub: string, id: string, file: string, accent: string, planned: boolean) =>
    `<g class="gnode${planned ? ' planned' : ''}" data-id="${id}" data-file="${esc(file)}" transform="translate(${x} ${y})">
      <rect class="box" x="0" y="0" width="${colW}" height="${nodeH}" rx="9"/>
      <rect class="accent" x="0" y="0" width="3.5" height="${nodeH}" rx="2" style="fill:${accent}"/>
      <text class="nlabel" x="13" y="${sub ? 13 : 17}">${esc(trunc(label, 26))}</text>
      ${sub ? `<text class="nsub" x="13" y="24">${esc(sub)}</text>` : ''}
    </g>`;

  let nodes = '';
  if (xOf.cap !== undefined) caps.forEach((c, i) => {
    const planned = c.enabled === false || !c.agentExists;
    nodes += node(xOf.cap, yOf(i, counts.cap), c.id || '—', planned ? 'planned' : (c.tier || ''),
      `c:${c.id}`, 'capabilities.yml', tierCol(c.tier), planned);
  });
  agentOrder.forEach((n, i) => {
    const a = agentByName.get(n)!;
    nodes += node(xOf.agent, yOf(i, counts.agent), n, a.model ? trunc(a.model, 22) : '',
      `a:${n}`, `agents/${a.file}`, a.tier ? tierCol(a.tier) : 'var(--accent)', false);
  });
  if (xOf.schema !== undefined) schemaOrder.forEach((s, i) => {
    nodes += node(xOf.schema, yOf(i, counts.schema), s.replace(/\.schema\.json$/, ''), 'schema',
      `s:${s}`, `schemas/${s}`, 'var(--c-green)', false);
  });

  const COL_LABEL: Record<string, string> = { cap: 'CAPABILITIES', agent: 'AGENTS', schema: 'SCHEMAS' };
  const heads = present.map(c => `<text class="col-h" x="${xOf[c]}" y="${oy + 20}">${COL_LABEL[c]}</text>`).join('');

  // The SVG fills the canvas; everything pans/zooms inside #vp. A scaled dot-grid
  // gives the platform feel. data-w/h let the script fit the graph to the viewport.
  const body = `<svg id="map-svg" data-w="${W}" data-h="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Agent wiring map">
    <defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="1.4" cy="1.4" r="1.4" fill="var(--faint)" opacity="0.5"/></pattern></defs>
    <g id="vp">
      <rect class="grid-bg" x="${-W}" y="${-H}" width="${W * 3}" height="${H * 3}" fill="url(#dots)"/>
      ${heads}
      ${edges}
      ${nodes}
    </g>
  </svg>`;
  return { body, empty: false };
}

function legendBar(): string {
  const sw = (c: string, label: string) => `<span class="lg"><span class="lg-sw" style="background:${c}"></span>${label}</span>`;
  return `<div class="legend">
    ${sw('var(--c-red)', 'Blocking')}${sw('var(--c-blue)', 'Parallel')}${sw('var(--muted)', 'Background')}
    ${sw('var(--c-green)', '→ schema (output contract)')}
    <span class="lg"><span class="lg-dash"></span>planned</span>
    <span class="lg hint">scroll to zoom · drag to pan · click a node to open</span>
  </div>`;
}

function agentCard(a: AgentView): string {
  const tier = a.tier && TIER_META[a.tier] ? TIER_META[a.tier] : undefined;
  const toolCount = a.tools?.length || 0;
  const mcp = (a.tools || []).filter(t => /^mcp__/.test(t)).length;
  const toolNote = toolCount
    ? `<span class="meta-chip" title="${esc((a.tools || []).join(', '))}">${toolCount} tool${toolCount === 1 ? '' : 's'}${mcp ? ` · ${mcp} MCP` : ''}</span>`
    : '';
  const schemaNote = a.schemaRefs.length
    ? `<span class="meta-chip mono" title="structured output contract">↳ ${a.schemaRefs.map(esc).join(', ')}</span>`
    : '';
  return `<div class="card" data-file="agents/${esc(a.file)}">
    <div class="card-h">
      <span class="aname">${esc(a.name || a.file.replace(/\.md$/, ''))}</span>
      ${tier ? `<span class="tier-badge ${tier.cls}" title="${esc(tier.note)}">${esc(tier.label)}</span>` : ''}
      ${a.model ? `<span class="model" title="model">${esc(a.model)}</span>` : ''}
    </div>
    ${a.description
      ? `<div class="adesc">${esc(a.description)}</div>`
      : '<div class="adesc muted">No description in frontmatter.</div>'}
    ${(toolNote || schemaNote) ? `<div class="card-meta">${schemaNote}${toolNote}</div>` : ''}
  </div>`;
}

export function buildAgentMapHtml(d: AgentMapView, theme: MarkrTheme = 'dark'): string {
  const active  = d.capabilities.filter(c => c.enabled !== false && c.agentExists).length;
  const planned = d.capabilities.length - active;

  const tierRank = (a: AgentView) => {
    const i = TIER_ORDER.indexOf(a.tier || '');
    return a.wired ? (i < 0 ? TIER_ORDER.length : i) : TIER_ORDER.length + 1;
  };
  const roster = [...d.agents].sort((x, y) =>
    tierRank(x) - tierRank(y) || (x.name || x.file).localeCompare(y.name || y.file));

  const problems = d.issues.filter(i => i.severity === 'error' || i.severity === 'warning');
  const problemsSection = problems.length
    ? `<h2>Needs attention</h2>${problems.map(i =>
        `<div class="issue ${i.severity}" ${i.file ? `data-file="agents/${esc(i.file)}"` : ''}>
           <span class="sev">${SEV_ICON[i.severity] || ''}</span>
           <span class="imsg">${esc(i.message)}</span>
           ${i.file ? `<span class="ifile">${esc(i.file)}</span>` : ''}
         </div>`).join('')}`
    : '';

  const graph = graphSvg(d);
  const canvas = graph.empty
    ? '<div class="empty">Nothing to map — no agents or capabilities found in this .claude/ project.</div>'
    : `<div class="canvas" id="canvas">
        <div class="zoombar">
          <button id="z-out" title="Zoom out">−</button>
          <button id="z-fit" title="Fit to view">⤢</button>
          <button id="z-in" title="Zoom in">+</button>
        </div>
        ${graph.body}
      </div>${legendBar()}`;

  return /* html */`<!DOCTYPE html><html lang="en" data-m="${theme}"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  ${MARKR_THEME_TOKENS}
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family, system-ui); color: var(--text);
    background: var(--bg); padding: 18px 22px 48px; margin: 0; font-size: 13px;
    line-height: 1.5; -webkit-font-smoothing: antialiased; }
  .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  h1 { font-size: 17px; margin: 0 0 2px; letter-spacing: -.01em; }
  .lead { color: var(--muted); font-size: 12.5px; margin: 0; }
  .sub { color: var(--muted); font-size: 12px; margin: 8px 0 16px; }
  .mono { font-family: var(--vscode-editor-font-family, monospace); }
  .stat { font-weight: 600; color: var(--text); }
  .ok-chip { color: var(--c-green); }
  .theme-sel { background: var(--subtle); color: var(--text2); border: 1px solid var(--border);
    border-radius: 7px; padding: 4px 9px; font-size: 11.5px; cursor: pointer; flex: none; }
  .theme-sel:hover { color: var(--text); border-color: var(--muted); }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--muted); margin: 26px 0 10px; font-weight: 700; }

  /* Interactive canvas */
  .canvas { position: relative; height: 540px; border: 1px solid var(--border); border-radius: 12px;
    background: var(--subtle); overflow: hidden; touch-action: none; cursor: grab; }
  .canvas.grabbing { cursor: grabbing; }
  #map-svg { width: 100%; height: 100%; display: block; }
  .zoombar { position: absolute; top: 10px; right: 10px; display: flex; gap: 4px; z-index: 2; }
  .zoombar button { width: 28px; height: 28px; border-radius: 7px; cursor: pointer; font-size: 15px; line-height: 1;
    background: var(--panel); color: var(--text); border: 1px solid var(--border);
    display: grid; place-items: center; }
  .zoombar button:hover { border-color: var(--accent); color: var(--accent); }
  .col-h { fill: var(--muted); font-size: 9.5px; font-weight: 700; letter-spacing: .08em;
    font-family: var(--vscode-font-family, system-ui); }
  .grid-bg { pointer-events: none; }
  .edge { fill: none; stroke-width: 1.6; opacity: .55; transition: opacity .1s, stroke-width .1s; }
  .edge.planned { stroke-dasharray: 4 3; opacity: .4; }
  .edge.hot { opacity: 1; stroke-width: 2.6; }
  .edge.dim { opacity: .1; }
  .gnode { cursor: pointer; }
  .gnode .box { fill: var(--panel); stroke: var(--border); stroke-width: 1; transition: stroke .1s; }
  .gnode:hover .box, .gnode.hot .box { stroke: var(--accent); stroke-width: 1.5; }
  .gnode.dim { opacity: .3; }
  .gnode.planned .box { stroke-dasharray: 4 3; }
  .nlabel { fill: var(--text); font-size: 11.5px; font-weight: 600; dominant-baseline: middle;
    font-family: var(--vscode-font-family, system-ui); }
  .nsub { fill: var(--muted); font-size: 9px; font-family: var(--vscode-editor-font-family, monospace); }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 2px 0; font-size: 10.5px; color: var(--muted); align-items: center; }
  .lg { display: flex; align-items: center; gap: 5px; }
  .lg.hint { margin-left: auto; font-style: italic; opacity: .8; }
  .lg-sw { width: 18px; height: 3px; border-radius: 2px; display: inline-block; }
  .lg-dash { width: 18px; height: 0; border-top: 2px dashed var(--muted); display: inline-block; }

  /* Tier badges (roster) */
  .tier-badge { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
    padding: 2px 7px; border-radius: 999px; white-space: nowrap; }
  .tier-badge.red  { color: var(--c-red);  background: color-mix(in srgb, var(--c-red) 16%, transparent); }
  .tier-badge.blue { color: var(--c-blue); background: color-mix(in srgb, var(--c-blue) 16%, transparent); }
  .tier-badge.mut  { color: var(--muted);  background: color-mix(in srgb, var(--text) 11%, transparent); }

  /* Agent roster */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .card { border: 1px solid var(--border); border-radius: 11px; padding: 13px 14px; cursor: pointer;
    background: var(--panel); transition: border-color .12s, background .12s; }
  .card:hover { border-color: var(--accent); background: color-mix(in srgb, var(--text) 5%, var(--panel)); }
  .card-h { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
  .aname { font-weight: 650; font-size: 13.5px; flex: 1; min-width: 0; }
  .model { font-size: 10px; padding: 1px 7px; border-radius: 999px;
    background: color-mix(in srgb, var(--text) 10%, transparent); color: var(--muted);
    font-family: var(--vscode-editor-font-family, monospace); }
  .adesc { font-size: 12.5px; color: var(--text);
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .adesc.muted { color: var(--muted); font-style: italic; }
  .card-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .meta-chip { font-size: 10px; padding: 2px 7px; border-radius: 6px;
    background: color-mix(in srgb, var(--text) 8%, transparent); color: var(--muted); }
  .meta-chip.mono { font-family: var(--vscode-editor-font-family, monospace); }

  /* Problems */
  .issue { display: flex; align-items: baseline; gap: 8px; padding: 8px 10px; border-radius: 8px;
    margin-bottom: 6px; border-left: 3px solid transparent; background: var(--subtle); }
  .issue[data-file] { cursor: pointer; }
  .issue.error { border-left-color: var(--c-red); }
  .issue.warning { border-left-color: var(--c-amber); }
  .sev { font-weight: 700; }
  .imsg { flex: 1; }
  .ifile { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; color: var(--muted); }
  .empty { color: var(--muted); padding: 30px; text-align: center; border: 1px dashed var(--border); border-radius: 12px; }
</style></head><body>
  <div class="topbar">
    <div>
      <h1>AI Agent Map</h1>
      <p class="lead">How this repo's agents are wired — and what each one does.</p>
    </div>
    <select class="theme-sel" id="theme" title="Theme">${themeOptionsHtml(theme)}</select>
  </div>
  <div class="sub"><span class="mono">${esc(d.rootLabel)}</span>
    · <span class="stat">${d.agents.length}</span> agents
    · <span class="stat">${d.capabilities.length}</span> capabilities
    ${d.capabilities.length ? `· <span class="stat">${active}</span> active` : ''}${planned ? ` · ${planned} planned` : ''}
    ${problems.length === 0 ? '· <span class="ok-chip">✓ consistent</span>' : ''}
  </div>

  <h2>Wiring map</h2>
  ${canvas}

  <h2>Agents</h2>
  ${roster.length ? `<div class="cards">${roster.map(agentCard).join('')}</div>` : '<div class="empty">No agent files found in .claude/agents/.</div>'}

  ${problemsSection}

<script>
  (function () {
    var vsc = acquireVsCodeApi();
    var panSuppress = false;  // set during a drag so it doesn't fire a node-open click

    // ── Click-to-open (nodes, roster cards, issue rows) ──────────────────────
    document.querySelectorAll('[data-file]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (panSuppress) return;
        vsc.postMessage({ type: 'open', file: el.getAttribute('data-file') });
      });
    });

    // ── Pan / zoom canvas ────────────────────────────────────────────────────
    var svg = document.getElementById('map-svg');
    var vp = document.getElementById('vp');
    var canvas = document.getElementById('canvas');
    if (svg && vp && canvas) {
      var t = { k: 1, x: 0, y: 0 };
      function apply() { vp.setAttribute('transform', 'translate(' + t.x + ' ' + t.y + ') scale(' + t.k + ')'); }
      function userPt(clientX, clientY) {
        var p = svg.createSVGPoint(); p.x = clientX; p.y = clientY;
        return p.matrixTransform(svg.getScreenCTM().inverse());
      }
      function zoomAt(clientX, clientY, factor) {
        var u = userPt(clientX, clientY);
        var nk = Math.min(4, Math.max(0.25, t.k * factor)); factor = nk / t.k;
        t.x = u.x - (u.x - t.x) * factor; t.y = u.y - (u.y - t.y) * factor; t.k = nk; apply();
      }
      function center() { var r = canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

      canvas.addEventListener('wheel', function (e) {
        e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
      }, { passive: false });

      // NB: no setPointerCapture — capturing the pointer would redirect the
      // follow-up click to the canvas, so node clicks would never open a file.
      // We listen on window instead so a drag still tracks outside the canvas.
      var dragging = false, lx = 0, ly = 0, moved = 0;
      canvas.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; panSuppress = false;
        canvas.classList.add('grabbing');
      });
      window.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var ctm = svg.getScreenCTM(); if (!ctm) return;
        var dx = (e.clientX - lx) / ctm.a, dy = (e.clientY - ly) / ctm.d;
        moved += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly);
        if (moved > 4) panSuppress = true;
        t.x += dx; t.y += dy; lx = e.clientX; ly = e.clientY; apply();
      });
      function endDrag() { if (!dragging) return; dragging = false; canvas.classList.remove('grabbing'); }
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);

      document.getElementById('z-in').addEventListener('click', function () { var c = center(); zoomAt(c.x, c.y, 1.25); });
      document.getElementById('z-out').addEventListener('click', function () { var c = center(); zoomAt(c.x, c.y, 0.8); });
      document.getElementById('z-fit').addEventListener('click', function () { t.k = 1; t.x = 0; t.y = 0; apply(); });
    }

    // ── Hover a node → highlight its connections ─────────────────────────────
    var edges = Array.prototype.slice.call(document.querySelectorAll('.edge'));
    var gnodes = Array.prototype.slice.call(document.querySelectorAll('.gnode'));
    function highlight(id) {
      var nb = {};
      edges.forEach(function (e) {
        var a = e.getAttribute('data-a'), b = e.getAttribute('data-b');
        var on = a === id || b === id;
        e.classList.toggle('hot', on); e.classList.toggle('dim', !on);
        if (a === id) nb[b] = 1; if (b === id) nb[a] = 1;
      });
      gnodes.forEach(function (n) {
        var nid = n.getAttribute('data-id'); var on = nid === id || nb[nid];
        n.classList.toggle('hot', on); n.classList.toggle('dim', !on);
      });
    }
    function clearHi() { edges.concat(gnodes).forEach(function (x) { x.classList.remove('hot', 'dim'); }); }
    gnodes.forEach(function (n) {
      n.addEventListener('mouseenter', function () { highlight(n.getAttribute('data-id')); });
      n.addEventListener('mouseleave', clearHi);
    });

    var sel = document.getElementById('theme');
    if (sel) sel.addEventListener('change', function () {
      document.documentElement.setAttribute('data-m', sel.value);
      vsc.setState({ theme: sel.value });
      vsc.postMessage({ type: 'setTheme', theme: sel.value });
    });
  }());
</script>
</body></html>`;
}
