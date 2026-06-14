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

/** Shareable Markdown report (tables, no SVG) — redacted before returning. */
export function scoreboardToMarkdown(data: ScoreboardData, scopeLabel: string): string {
  const lines: string[] = [];
  lines.push(`# Markr AI Scoreboard — ${scopeLabel}`);
  lines.push(`> ${data.totalSessions} sessions read locally. Dead-end rate is a heuristic estimate.`);
  lines.push('');
  lines.push('## Sessions per tool (last 8 weeks)');
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
