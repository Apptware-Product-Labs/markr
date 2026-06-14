/**
 * scoreboardHtml.ts — renders the AI Scoreboard webview (inline SVG, no chart lib).
 * Theme-aware (Markr Dark/Light/Notion/Linear) with a per-theme chart palette,
 * a theme picker, and JS hover tooltips. Pure string builder.
 */
import {
  SCOREBOARD_LABELS, SCOREBOARD_PALETTES,
  type ScoreboardData, type ScoreboardTheme,
} from '../scoreboard';
import type { AiTool } from '../sessionReader';

// Markr theme tokens (mirrors preview.ts) — only the vars the Scoreboard uses.
const THEME_TOKENS = `
[data-m="dark"]{--bg:#141210;--panel:#1b1916;--subtle:#211e1a;--elev:#201d19;--border:#2a2622;--grid:#27231f;--text:#e8e3dc;--text2:#c9c1b8;--muted:#8f877d;--faint:#5b554e;--accent:#FB923C;}
[data-m="light"]{--bg:#fbfaf8;--panel:#fff;--subtle:#f5f2ec;--elev:#fff;--border:#e6ded4;--grid:#eee8df;--text:#1c1a17;--text2:#514b45;--muted:#83786f;--faint:#b7aea4;--accent:#EA580C;}
[data-m="notion"]{--bg:#fff;--panel:#fff;--subtle:#f7f6f3;--elev:#fff;--border:#e8e6e2;--grid:#f0efec;--text:#37352f;--text2:#55534e;--muted:#8b8782;--faint:#bbb8b1;--accent:#37352f;}
[data-m="linear"]{--bg:#0d0d10;--panel:#15151b;--subtle:#1a1a22;--elev:#181820;--border:#262633;--grid:#22222d;--text:#e7e7ec;--text2:#b8b8c2;--muted:#777783;--faint:#484852;--accent:#8b92ff;}
`;

function paletteCss(): string {
  let css = '';
  (Object.keys(SCOREBOARD_PALETTES) as ScoreboardTheme[]).forEach(t => {
    SCOREBOARD_PALETTES[t].forEach((c, i) => { css += `[data-m="${t}"] .pal-${i}{--c:${c};}`; });
  });
  return css;
}

function esc(v: unknown): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtTok(n: number): string {
  return n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}K` : `${(n / 1_000_000).toFixed(1)}M`;
}

/** Stacked-bar SVG; segments use `.pal-N` (theme palette) + a data-tip for hover. */
function stackedBars(series: ScoreboardData['sessionsByTool'], weekLabels: string[], unit: string): string {
  const W = 560, H = 152, padT = 12, padB = 24, barGap = 12;
  const cols = weekLabels.length;
  const barW = (W - barGap * (cols - 1)) / cols;
  const totals = weekLabels.map((_, wi) => series.reduce((a, s) => a + (s.counts[wi] || 0), 0));
  const max = Math.max(1, ...totals);
  const chartH = H - padT - padB;

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" role="img" aria-label="${esc(unit)} per tool per week">`;
  for (let gi = 1; gi <= 3; gi++) {
    const y = padT + chartH * (gi / 4);
    svg += `<line class="grid" x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}"></line>`;
  }
  for (let wi = 0; wi < cols; wi++) {
    const x = wi * (barW + barGap);
    let y = padT + chartH;
    for (let si = 0; si < series.length; si++) {
      const s = series[si];
      const v = s.counts[wi] || 0;
      if (v <= 0) continue;
      const h = (v / max) * (chartH - 4);
      y -= h;
      const tip = `${SCOREBOARD_LABELS[s.tool] || s.tool}: ${v} ${unit} · ${weekLabels[wi]}`;
      svg += `<rect class="bar pal-${si}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" data-tip="${esc(tip)}"></rect>`;
    }
    svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="9" fill="var(--muted)">${esc(weekLabels[wi])}</text>`;
  }
  svg += '</svg>';
  return svg;
}

function legend(series: ScoreboardData['sessionsByTool']): string {
  return '<div class="legend">' + series.map((s, i) =>
    `<span class="lg"><span class="sw pal-${i}"></span>${esc(SCOREBOARD_LABELS[s.tool] || s.tool)}</span>`,
  ).join('') + '</div>';
}

const THEME_OPTS: Array<{ v: ScoreboardTheme; label: string }> = [
  { v: 'dark', label: 'Markr Dark' }, { v: 'light', label: 'Markr Light' },
  { v: 'notion', label: 'Notion' }, { v: 'linear', label: 'Linear' },
];

export function buildScoreboardHtml(
  data: ScoreboardData, scope: 'project' | 'all', projectName: string, theme: ScoreboardTheme = 'dark',
): string {
  const scopeProjLabel = projectName ? esc(projectName) : 'This project';
  const deadEndRows = data.deadEndRates.map(d =>
    `<tr><td>${esc(SCOREBOARD_LABELS[d.tool] || d.tool)}</td><td title="from ${d.sessions} sessions read locally">${d.deadEnds}</td><td>${d.sessions}</td><td>${d.rate}</td></tr>`).join('');
  const medianRows = data.medians.map(m =>
    `<tr><td>${esc(SCOREBOARD_LABELS[m.tool] || m.tool)}</td><td>${m.median}</td><td>${m.sessions}</td></tr>`).join('');
  const projectRows = data.topProjects.map(p =>
    `<tr><td>${esc(p.project)}</td><td>${p.sessions}</td><td title="~${fmtTok(p.tokens)} tokens read locally">${fmtTok(p.tokens)}</td></tr>`).join('');
  const themeOptions = THEME_OPTS.map(o =>
    `<option value="${o.v}"${o.v === theme ? ' selected' : ''}>${o.label}</option>`).join('');

  return /* html */`<!DOCTYPE html><html lang="en" data-m="${theme}"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
${THEME_TOKENS}
${paletteCss()}
* { box-sizing: border-box; }
body { font-family: var(--vscode-font-family, -apple-system, system-ui, sans-serif); color: var(--text);
  background: var(--bg); padding: 20px 24px 36px; margin: 0; -webkit-font-smoothing: antialiased; }
.head { display: flex; align-items: baseline; gap: 10px; }
h1 { font-size: 15px; font-weight: 650; letter-spacing: -.01em; margin: 0; }
.sub { color: var(--muted); font-size: 11px; }
.row { display: flex; align-items: center; gap: 8px; margin: 14px 0 18px; flex-wrap: wrap; }
.seg { display: inline-flex; background: var(--subtle); border: 1px solid var(--border); border-radius: 8px; padding: 2px; }
.scope-btn { padding: 3px 12px; border-radius: 6px; cursor: pointer; font-size: 11.5px; border: none;
  background: transparent; color: var(--muted); transition: all .12s; }
.scope-btn:hover { color: var(--text); }
.scope-btn.active { background: var(--panel); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.spacer { flex: 1; }
.theme-sel, .export { background: var(--subtle); color: var(--text2); border: 1px solid var(--border);
  border-radius: 7px; padding: 4px 9px; font-size: 11.5px; cursor: pointer; }
.theme-sel:hover, .export:hover { color: var(--text); border-color: var(--muted); }
.chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
.section { margin-bottom: 18px; }
.section-h { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.section-t { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--text2); }
.heur { font-size: 10px; color: var(--muted); font-weight: 400; text-transform: none; letter-spacing: 0; }
.chart-panel { background: var(--elev); border: 1px solid var(--border); border-radius: 8px; padding: 12px 12px 10px; }
.chart-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.chart-title { color: var(--text2); font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }
.chart-note { color: var(--muted); font-size: 10px; white-space: nowrap; }
.chart { height: 154px; margin-top: 2px; }
.grid { stroke: var(--grid); stroke-width: 1; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 10px; font-size: 10.5px; color: var(--muted); }
.lg { display: flex; align-items: center; gap: 5px; }
.sw { width: 9px; height: 9px; border-radius: 2.5px; display: inline-block; background: var(--c, #888); }
.bar { fill: var(--c, #888); transition: opacity .1s; cursor: default; }
.bar:hover { opacity: .8; }
table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
th, td { text-align: left; padding: 5px 4px; border-bottom: 1px solid var(--border); color: var(--text); font-variant-numeric: tabular-nums; }
th { color: var(--muted); font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
th:not(:first-child), td:not(:first-child) { text-align: right; }
tr:last-child td { border-bottom: none; }
.table-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.table-panel { background: transparent; border-top: 1px solid var(--border); padding-top: 12px; min-width: 0; }
.empty { color: var(--muted); padding: 36px; text-align: center; font-size: 12px; }
#tip { position: fixed; pointer-events: none; z-index: 10; display: none;
  background: var(--text); color: var(--bg); font-size: 11px; padding: 4px 8px;
  border-radius: 6px; white-space: nowrap; box-shadow: 0 3px 10px rgba(0,0,0,.28); }
@media (max-width: 820px) {
  .chart-grid, .table-grid { grid-template-columns: 1fr; }
}
</style></head><body>
<div id="tip"></div>
<div class="head"><h1>AI Scoreboard</h1><span class="sub">${data.totalSessions} sessions · local-only</span></div>

<div class="row">
  <div class="seg">
    <button class="scope-btn ${scope === 'project' ? 'active' : ''}" id="scope-project">${scopeProjLabel}</button>
    <button class="scope-btn ${scope === 'all' ? 'active' : ''}" id="scope-all">All projects</button>
  </div>
  <span class="spacer"></span>
  <select class="theme-sel" id="theme" title="Theme">${themeOptions}</select>
  <button class="export" id="export">⎘ Export</button>
</div>

${data.totalSessions === 0 ? '<div class="empty">No sessions found for this scope yet.</div>' : `
<div class="chart-grid">
  <div class="chart-panel">
    <div class="chart-top"><span class="chart-title">Sessions per tool</span><span class="chart-note">last 8 weeks</span></div>
    <div class="chart">${stackedBars(data.sessionsByTool, data.weekLabels, 'sessions')}</div>
    ${legend(data.sessionsByTool)}
  </div>

  <div class="chart-panel">
    <div class="chart-top"><span class="chart-title">Tokens per tool</span><span class="chart-note">last 8 weeks</span></div>
    <div class="chart">${stackedBars(data.tokensByTool, data.weekLabels, 'tokens')}</div>
    ${legend(data.tokensByTool)}
  </div>
</div>

<div class="table-grid">
<div class="table-panel">
  <div class="section-h"><span class="section-t">Dead-end rate</span><span class="heur">heuristic</span></div>
  <table><tr><th>Tool</th><th>Dead-ends</th><th>Sessions</th><th>Rate</th></tr>${deadEndRows}</table>
</div>

<div class="table-panel">
  <div class="section-h"><span class="section-t">Median session length</span><span class="heur">messages · all time</span></div>
  <table><tr><th>Tool</th><th>Median</th><th>Sessions</th></tr>${medianRows}</table>
</div>

<div class="table-panel">
  <div class="section-h"><span class="section-t">Most-worked projects</span><span class="heur">all time</span></div>
  <table><tr><th>Project</th><th>Sessions</th><th>Tokens</th></tr>${projectRows}</table>
</div>
</div>
`}

<script>
(function(){
  var vsc = acquireVsCodeApi();
  document.getElementById('scope-project').addEventListener('click', function(){ vsc.postMessage({ type:'scope', scope:'project' }); });
  document.getElementById('scope-all').addEventListener('click', function(){ vsc.postMessage({ type:'scope', scope:'all' }); });
  document.getElementById('export').addEventListener('click', function(){ vsc.postMessage({ type:'export' }); });

  var sel = document.getElementById('theme');
  sel.addEventListener('change', function(){
    document.documentElement.setAttribute('data-m', sel.value);  // instant recolor via CSS vars
    vsc.postMessage({ type:'theme', theme: sel.value });
  });

  var tip = document.getElementById('tip');
  document.querySelectorAll('.bar').forEach(function(bar){
    bar.addEventListener('mousemove', function(e){
      tip.textContent = bar.getAttribute('data-tip') || '';
      tip.style.display = 'block';
      tip.style.left = (e.clientX + 12) + 'px';
      tip.style.top  = (e.clientY + 12) + 'px';
    });
    bar.addEventListener('mouseleave', function(){ tip.style.display = 'none'; });
  });
}());
</script>
</body></html>`;
}
