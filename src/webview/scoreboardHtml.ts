/**
 * scoreboardHtml.ts — renders the AI Scoreboard webview (inline SVG, no chart lib).
 * Pure string builder; the panel wiring lives in contextBridge.
 */
import type { ScoreboardData } from '../scoreboard';
import type { AiTool } from '../sessionReader';

const COLORS: Record<AiTool, string> = {
  'claude-code': '#F97316', codex: '#16a34a', cursor: '#EA580C', aider: '#d97706', augment: '#B45309',
  cline: '#0ea5e9', 'roo-code': '#8b5cf6', windsurf: '#06b6d4', 'gemini-cli': '#4285F4',
};
const LABELS: Record<AiTool, string> = {
  'claude-code': 'Claude', codex: 'Codex', cursor: 'Cursor', aider: 'Aider', augment: 'Augment',
  cline: 'Cline', 'roo-code': 'Roo', windsurf: 'Windsurf', 'gemini-cli': 'Gemini',
};

function esc(v: unknown): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtTok(n: number): string {
  return n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}K` : `${(n / 1_000_000).toFixed(1)}M`;
}

/** Stacked-bar SVG for an 8-week, per-tool series. `valueFmt` labels tooltips. */
function stackedBars(
  series: ScoreboardData['sessionsByTool'],
  weekLabels: string[],
  unit: string,
): string {
  const W = 460, H = 150, padL = 8, padB = 18, barGap = 8;
  const cols = weekLabels.length;
  const barW = (W - padL * 2 - barGap * (cols - 1)) / cols;
  const totals = weekLabels.map((_, wi) => series.reduce((a, s) => a + (s.counts[wi] || 0), 0));
  const max = Math.max(1, ...totals);
  const chartH = H - padB;

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(unit)} per tool per week">`;
  for (let wi = 0; wi < cols; wi++) {
    const x = padL + wi * (barW + barGap);
    let y = chartH;
    for (const s of series) {
      const v = s.counts[wi] || 0;
      if (v <= 0) continue;
      const h = (v / max) * (chartH - 4);
      y -= h;
      svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" `
        + `fill="${COLORS[s.tool] || '#888'}"><title>${esc(LABELS[s.tool] || s.tool)}: ${v} ${esc(unit)} · ${esc(weekLabels[wi])}</title></rect>`;
    }
    svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="9" fill="var(--text-faint,#888)">${esc(weekLabels[wi])}</text>`;
  }
  svg += '</svg>';
  return svg;
}

function legend(series: ScoreboardData['sessionsByTool']): string {
  return '<div class="legend">' + series.map(s =>
    `<span class="lg"><span class="sw" style="background:${COLORS[s.tool] || '#888'}"></span>${esc(LABELS[s.tool] || s.tool)}</span>`,
  ).join('') + '</div>';
}

export function buildScoreboardHtml(data: ScoreboardData, scope: 'project' | 'all', projectName: string): string {
  const scopeProjLabel = projectName ? esc(projectName) : 'This project';
  const deadEndRows = data.deadEndRates.map(d =>
    `<tr><td>${esc(LABELS[d.tool] || d.tool)}</td><td title="from ${d.sessions} ${esc(LABELS[d.tool] || d.tool)} sessions read locally">${d.deadEnds}</td><td>${d.sessions}</td><td>${d.rate}</td></tr>`).join('');
  const medianRows = data.medians.map(m =>
    `<tr><td>${esc(LABELS[m.tool] || m.tool)}</td><td>${m.median}</td><td>${m.sessions}</td></tr>`).join('');
  const projectRows = data.topProjects.map(p =>
    `<tr><td>${esc(p.project)}</td><td>${p.sessions}</td><td title="~${fmtTok(p.tokens)} tokens read locally">${fmtTok(p.tokens)}</td></tr>`).join('');

  return /* html */`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body { font-family: var(--vscode-font-family, system-ui); color: var(--vscode-foreground); padding: 14px 18px; }
h1 { font-size: 18px; margin: 0 0 2px; }
.sub { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 14px; }
.row { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.scope-btn { padding: 3px 10px; border-radius: 5px; cursor: pointer; font-size: 12px; border: 1px solid rgba(249,115,22,.4); background: transparent; color: var(--vscode-foreground); }
.scope-btn.active { background: #F97316; color: #fff; border-color: #F97316; }
.spacer { flex: 1; }
.export { padding: 3px 12px; border-radius: 5px; cursor: pointer; font-size: 12px; border: 1px solid var(--vscode-button-border, rgba(127,127,127,.3)); background: var(--vscode-button-background, #333); color: var(--vscode-button-foreground, #fff); }
h2 { font-size: 13px; margin: 18px 0 6px; }
.card { border: 1px solid rgba(127,127,127,.2); border-radius: 8px; padding: 12px; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; font-size: 11px; color: var(--vscode-descriptionForeground); }
.lg { display: flex; align-items: center; gap: 4px; }
.sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid rgba(127,127,127,.15); }
th { color: var(--vscode-descriptionForeground); font-weight: 600; }
.heur { font-size: 10px; color: var(--vscode-descriptionForeground); margin-left: 6px; }
.empty { color: var(--vscode-descriptionForeground); padding: 30px; text-align: center; }
</style></head><body>
<h1>AI Scoreboard</h1>
<div class="sub">${data.totalSessions} sessions read locally (all time) · everything computed on your machine</div>

<div class="row">
  <button class="scope-btn ${scope === 'project' ? 'active' : ''}" id="scope-project">${scopeProjLabel}</button>
  <button class="scope-btn ${scope === 'all' ? 'active' : ''}" id="scope-all">All projects</button>
  <span class="spacer"></span>
  <button class="export" id="export">⎘ Export as Markdown</button>
</div>

${data.totalSessions === 0 ? '<div class="empty">No sessions found for this scope yet.</div>' : `
<h2>Sessions per tool · last 8 weeks only</h2>
<div class="card">${stackedBars(data.sessionsByTool, data.weekLabels, 'sessions')}${legend(data.sessionsByTool)}</div>

<h2>Tokens per tool · last 8 weeks</h2>
<div class="card">${stackedBars(data.tokensByTool, data.weekLabels, 'tokens')}${legend(data.tokensByTool)}</div>

<h2>Dead-end rate per tool <span class="heur">all time · heuristic estimate</span></h2>
<div class="card"><table><tr><th>Tool</th><th>Dead-ends</th><th>Sessions</th><th>Rate</th></tr>${deadEndRows}</table></div>

<h2>Median session length (messages) <span class="heur">all time</span></h2>
<div class="card"><table><tr><th>Tool</th><th>Median</th><th>Sessions</th></tr>${medianRows}</table></div>

<h2>Most-worked projects <span class="heur">all time</span></h2>
<div class="card"><table><tr><th>Project</th><th>Sessions</th><th>Tokens</th></tr>${projectRows}</table></div>
`}

<script>
(function(){
  var vsc = acquireVsCodeApi();
  document.getElementById('scope-project').addEventListener('click', function(){ vsc.postMessage({ type:'scope', scope:'project' }); });
  document.getElementById('scope-all').addEventListener('click', function(){ vsc.postMessage({ type:'scope', scope:'all' }); });
  document.getElementById('export').addEventListener('click', function(){ vsc.postMessage({ type:'export' }); });
}());
</script>
</body></html>`;
}
