/**
 * scoreboard.ts — cross-tool analytics, computed entirely from data Markr already
 * has locally (SessionInfo + memory items). No new parsing, no network.
 *
 * Pure / dependency-free so the metrics are unit-tested. The webview rendering
 * lives in webview/scoreboardHtml.ts; the panel wiring in contextBridge/extension.
 */
import type { AiTool, SessionInfo } from './sessionReader';
import { redactSecrets } from './redact';

export const SCOREBOARD_TOOLS: AiTool[] = [
  'claude-code', 'codex', 'cursor', 'augment', 'aider',
  'cline', 'roo-code', 'windsurf', 'gemini-cli',
];
const WEEKS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ToolWeekSeries { tool: AiTool; counts: number[]; }      // length WEEKS, oldest→newest
export interface DeadEndStat   { tool: AiTool; deadEnds: number; sessions: number; rate: number; }
export interface MedianStat    { tool: AiTool; median: number; sessions: number; }
export interface ProjectStat   { project: string; sessions: number; tokens: number; }

export interface ScoreboardData {
  weekLabels:    string[];                 // length WEEKS, e.g. "7w", … "now"
  sessionsByTool: ToolWeekSeries[];
  tokensByTool:   ToolWeekSeries[];
  deadEndRates:   DeadEndStat[];
  medians:        MedianStat[];
  topProjects:    ProjectStat[];
  totalSessions:  number;
}

export interface MemoryFact { kind: string; tool: AiTool; }

export type ScoreboardTheme = 'dark' | 'light' | 'notion' | 'linear';

export const SCOREBOARD_LABELS: Record<AiTool, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  aider: 'Aider',
  augment: 'Augment',
  cline: 'Cline',
  'roo-code': 'Roo',
  windsurf: 'Windsurf',
  'gemini-cli': 'Gemini',
};

export const SCOREBOARD_PALETTES: Record<ScoreboardTheme, string[]> = {
  dark:   ['#ff9f45', '#54d17a', '#63b3ff', '#f575b4', '#ab8cff', '#27c7d9', '#f4c542', '#ff7a8a', '#5bd6c5'],
  light:  ['#c95216', '#15803d', '#1d4ed8', '#be185d', '#6d28d9', '#0e7490', '#a16207', '#be123c', '#0f766e'],
  notion: ['#bf6f1c', '#47775c', '#327da0', '#ad4d7c', '#7d5ba6', '#337f8d', '#9b760c', '#a55245', '#4b8074'],
  linear: ['#8b92ff', '#50d774', '#66b8ff', '#ef85df', '#bfa8ff', '#36d1e6', '#ffd76a', '#ff83a1', '#63dccb'],
};

const EXPORT_THEME_TOKENS: Record<ScoreboardTheme, {
  bg: string; panel: string; border: string; text: string; text2: string; muted: string; faint: string; grid: string;
}> = {
  dark:   { bg: '#141210', panel: '#1b1916', border: '#2a2622', text: '#e8e3dc', text2: '#c9c1b8', muted: '#8f877d', faint: '#5b554e', grid: '#27231f' },
  light:  { bg: '#fbfaf8', panel: '#ffffff', border: '#e6ded4', text: '#1c1a17', text2: '#514b45', muted: '#83786f', faint: '#b7aea4', grid: '#eee8df' },
  notion: { bg: '#ffffff', panel: '#ffffff', border: '#e8e6e2', text: '#37352f', text2: '#55534e', muted: '#8b8782', faint: '#bbb8b1', grid: '#f0efec' },
  linear: { bg: '#0d0d10', panel: '#15151b', border: '#262633', text: '#e7e7ec', text2: '#b8b8c2', muted: '#777783', faint: '#484852', grid: '#22222d' },
};

/** Which of the last WEEKS buckets a timestamp falls in (0 = oldest, WEEKS-1 = now). -1 if outside. */
function weekBucket(ts: number, now: number): number {
  const weeksAgo = Math.floor((now - ts) / WEEK_MS);
  if (weeksAgo < 0 || weeksAgo >= WEEKS) return -1;
  return WEEKS - 1 - weeksAgo;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function computeScoreboard(
  sessions: SessionInfo[],
  facts: MemoryFact[],
  now: number,
): ScoreboardData {
  const weekLabels = Array.from({ length: WEEKS }, (_, i) => {
    const back = WEEKS - 1 - i;
    return back === 0 ? 'now' : `${back}w`;
  });

  const zero = () => Array.from({ length: WEEKS }, () => 0);
  const sessCounts: Record<string, number[]> = {};
  const tokCounts:  Record<string, number[]> = {};
  const msgsByTool: Record<string, number[]> = {};
  for (const t of SCOREBOARD_TOOLS) { sessCounts[t] = zero(); tokCounts[t] = zero(); msgsByTool[t] = []; }

  const projects = new Map<string, { sessions: number; tokens: number }>();

  for (const s of sessions) {
    const b = weekBucket(s.lastActive, now);
    if (b >= 0 && sessCounts[s.tool]) {
      sessCounts[s.tool][b] += 1;
      tokCounts[s.tool][b]  += s.tokenCount;
    }
    if (msgsByTool[s.tool]) msgsByTool[s.tool].push(s.messages.length);
    const key = s.projectSlug || s.projectPath || '(unknown)';
    const p = projects.get(key) ?? { sessions: 0, tokens: 0 };
    p.sessions += 1; p.tokens += s.tokenCount;
    projects.set(key, p);
  }

  // Dead-end rate per tool: deadEnd memory facts / sessions of that tool.
  const sessionsPerTool: Record<string, number> = {};
  for (const s of sessions) sessionsPerTool[s.tool] = (sessionsPerTool[s.tool] ?? 0) + 1;
  const deadEndCounts: Record<string, number> = {};
  for (const f of facts) if (f.kind === 'deadEnd') deadEndCounts[f.tool] = (deadEndCounts[f.tool] ?? 0) + 1;

  const present = SCOREBOARD_TOOLS.filter(t => (sessionsPerTool[t] ?? 0) > 0);

  return {
    weekLabels,
    sessionsByTool: present.map(t => ({ tool: t, counts: sessCounts[t] })),
    tokensByTool:   present.map(t => ({ tool: t, counts: tokCounts[t] })),
    deadEndRates:   present.map(t => {
      const sCount = sessionsPerTool[t] ?? 0;
      const d = deadEndCounts[t] ?? 0;
      return { tool: t, deadEnds: d, sessions: sCount, rate: sCount ? +(d / sCount).toFixed(2) : 0 };
    }),
    medians: present.map(t => ({ tool: t, median: median(msgsByTool[t]), sessions: sessionsPerTool[t] ?? 0 })),
    topProjects: [...projects.entries()]
      .map(([project, v]) => ({ project, sessions: v.sessions, tokens: v.tokens }))
      .sort((a, b) => b.sessions - a.sessions || b.tokens - a.tokens)
      .slice(0, 8),
    totalSessions: sessions.length,
  };
}

function fmtTok(n: number): string {
  return n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}K` : `${(n / 1_000_000).toFixed(1)}M`;
}

function svgEsc(v: unknown): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Self-contained stacked-bar SVG (inline fills + legend) for the Markdown export.
 *  Renders in Markr's preview; degrades to the tables below it everywhere else. */
export function scoreboardChartSvg(
  series: ToolWeekSeries[],
  weekLabels: string[],
  unit: string,
  theme: ScoreboardTheme = 'dark',
): string {
  if (!series.length) return '';
  const W = 720, H = 260, padX = 24, padTop = 42, padB = 78, gap = 14;
  const chartH = H - padTop - padB;
  const plotW = W - padX * 2;
  const cols = weekLabels.length;
  const barW = (plotW - gap * (cols - 1)) / cols;
  const totals = weekLabels.map((_, wi) => series.reduce((a, s) => a + (s.counts[wi] || 0), 0));
  const max = Math.max(1, ...totals);
  const tokens = EXPORT_THEME_TOKENS[theme] ?? EXPORT_THEME_TOKENS.dark;
  const palette = SCOREBOARD_PALETTES[theme] ?? SCOREBOARD_PALETTES.dark;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${svgEsc(unit)} per tool per week">`;
  svg += `<rect width="${W}" height="${H}" rx="12" fill="${tokens.panel}" stroke="${tokens.border}"/>`;
  svg += `<text x="${padX}" y="25" font-size="12" font-weight="700" letter-spacing="0.6" fill="${tokens.text2}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">${svgEsc(unit.toUpperCase())} PER TOOL</text>`;
  svg += `<text x="${W - padX}" y="25" text-anchor="end" font-size="11" fill="${tokens.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">last 8 weeks</text>`;
  for (let gi = 1; gi <= 3; gi++) {
    const y = padTop + chartH * (gi / 4);
    svg += `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${W - padX}" y2="${y.toFixed(1)}" stroke="${tokens.grid}" stroke-width="1"/>`;
  }
  for (let wi = 0; wi < cols; wi++) {
    const x = padX + wi * (barW + gap);
    let y = padTop + chartH;
    for (let si = 0; si < series.length; si++) {
      const v = series[si].counts[wi] || 0;
      if (v <= 0) continue;
      const h = (v / max) * (chartH - 5);
      y -= h;
      svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${palette[si % palette.length]}"/>`;
    }
    svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${(padTop + chartH + 22).toFixed(1)}" text-anchor="middle" font-size="10" fill="${tokens.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">${svgEsc(weekLabels[wi])}</text>`;
  }
  let lx = padX;
  let ly = H - 22;
  for (let si = 0; si < series.length; si++) {
    const label = SCOREBOARD_LABELS[series[si].tool] || series[si].tool;
    const next = lx + 16 + label.length * 6 + 18;
    if (next > W - padX) { lx = padX; ly += 16; }
    svg += `<rect x="${lx}" y="${ly - 8}" width="8" height="8" rx="2" fill="${palette[si % palette.length]}"/>`;
    svg += `<text x="${lx + 13}" y="${ly}" font-size="10" fill="${tokens.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">${svgEsc(label)}</text>`;
    lx += 16 + label.length * 6 + 18;
  }
  svg += `</svg>`;
  return svg;
}

/** Shareable Markdown report (theme-matched SVG charts + portable tables) — redacted before returning. */
export function scoreboardToMarkdown(data: ScoreboardData, scopeLabel: string, theme: ScoreboardTheme = 'dark'): string {
  const lines: string[] = [];
  lines.push(`# Markr AI Scoreboard — ${scopeLabel}`);
  lines.push(`> ${data.totalSessions} sessions read locally. Dead-end rate is a heuristic estimate.`);
  lines.push('');
  // Charts as self-contained SVG — render in Markr's preview; the tables below
  // carry the same data for places that strip SVG (GitHub/Slack/etc.).
  if (data.totalSessions > 0) {
    lines.push('## Sessions per tool — last 8 weeks');
    lines.push(scoreboardChartSvg(data.sessionsByTool, data.weekLabels, 'sessions', theme));
    lines.push('');
    lines.push('## Tokens per tool — last 8 weeks');
    lines.push(scoreboardChartSvg(data.tokensByTool, data.weekLabels, 'tokens', theme));
    lines.push('');
  }
  lines.push('## Sessions per tool (table · last 8 weeks)');
  lines.push(`| Tool | ${data.weekLabels.join(' | ')} | Total |`);
  lines.push(`|---|${data.weekLabels.map(() => '---').join('|')}|---|`);
  for (const s of data.sessionsByTool) {
    const total = s.counts.reduce((a, b) => a + b, 0);
    lines.push(`| ${s.tool} | ${s.counts.join(' | ')} | ${total} |`);
  }
  lines.push('');
  lines.push('## Dead-end rate per tool (heuristic estimate)');
  lines.push('| Tool | Dead-ends | Sessions | Rate |');
  lines.push('|---|---|---|---|');
  for (const d of data.deadEndRates) lines.push(`| ${d.tool} | ${d.deadEnds} | ${d.sessions} | ${d.rate} |`);
  lines.push('');
  lines.push('## Median session length (messages)');
  lines.push('| Tool | Median | Sessions |');
  lines.push('|---|---|---|');
  for (const m of data.medians) lines.push(`| ${m.tool} | ${m.median} | ${m.sessions} |`);
  lines.push('');
  lines.push('## Most-worked projects');
  lines.push('| Project | Sessions | Tokens |');
  lines.push('|---|---|---|');
  for (const p of data.topProjects) lines.push(`| ${p.project} | ${p.sessions} | ${fmtTok(p.tokens)} |`);
  lines.push('');
  return redactSecrets(lines.join('\n')).text;
}
