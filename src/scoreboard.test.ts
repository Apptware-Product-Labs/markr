/**
 * scoreboard.test.ts — week bucketing, dead-end rate, medians, top projects,
 * and the Markdown export (redacted).
 */
import { describe, it, expect } from 'vitest';
import { computeScoreboard, scoreboardToMarkdown, type MemoryFact } from './scoreboard';
import type { SessionInfo } from './sessionReader';

const NOW = 1_000_000_000_000; // fixed clock
const WEEK = 7 * 24 * 60 * 60 * 1000;

function sess(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: Math.random().toString(36).slice(2), tool: 'claude-code',
    projectPath: '/proj/a', projectSlug: 'a', filePath: '/x.jsonl',
    messages: [], startedAt: NOW, lastActive: NOW, title: 't',
    tokenCount: 1000, isActive: false, ...over,
  };
}
function msgs(n: number) { return Array.from({ length: n }, () => ({ role: 'user' as const, text: 'x' })); }

describe('computeScoreboard', () => {
  it('buckets sessions into the correct week (now = last bucket)', () => {
    const sessions = [
      sess({ lastActive: NOW }),                 // now → bucket 7
      sess({ lastActive: NOW - 2 * WEEK }),      // 2w ago → bucket 5
      sess({ lastActive: NOW - 20 * WEEK }),     // outside 8w → dropped from chart
    ];
    const data = computeScoreboard(sessions, [], NOW);
    const claude = data.sessionsByTool.find(s => s.tool === 'claude-code')!;
    expect(claude.counts).toHaveLength(8);
    expect(claude.counts[7]).toBe(1);   // now
    expect(claude.counts[5]).toBe(1);   // 2 weeks ago
    expect(claude.counts.reduce((a, b) => a + b, 0)).toBe(2); // the 20w-old one excluded
    expect(data.totalSessions).toBe(3); // total still counts all
  });

  it('computes dead-end rate per tool as deadEnd facts / sessions', () => {
    const sessions = [sess({ tool: 'cursor' }), sess({ tool: 'cursor' }), sess({ tool: 'cursor' }), sess({ tool: 'cursor' })];
    const facts: MemoryFact[] = [
      { kind: 'deadEnd', tool: 'cursor' }, { kind: 'deadEnd', tool: 'cursor' },
      { kind: 'decision', tool: 'cursor' },
    ];
    const data = computeScoreboard(sessions, facts, NOW);
    const cur = data.deadEndRates.find(d => d.tool === 'cursor')!;
    expect(cur.deadEnds).toBe(2);
    expect(cur.sessions).toBe(4);
    expect(cur.rate).toBe(0.5);
  });

  it('computes median session length', () => {
    const sessions = [sess({ messages: msgs(2) }), sess({ messages: msgs(10) }), sess({ messages: msgs(4) })];
    const data = computeScoreboard(sessions, [], NOW);
    expect(data.medians.find(m => m.tool === 'claude-code')!.median).toBe(4);
  });

  it('ranks most-worked projects by sessions then tokens', () => {
    const sessions = [
      sess({ projectSlug: 'alpha', tokenCount: 100 }),
      sess({ projectSlug: 'alpha', tokenCount: 100 }),
      sess({ projectSlug: 'beta', tokenCount: 5000 }),
    ];
    const data = computeScoreboard(sessions, [], NOW);
    expect(data.topProjects[0].project).toBe('alpha');
    expect(data.topProjects[0].sessions).toBe(2);
  });

  it('only includes tools that actually have sessions', () => {
    const data = computeScoreboard([sess({ tool: 'augment' })], [], NOW);
    expect(data.sessionsByTool.map(s => s.tool)).toEqual(['augment']);
  });
});

describe('scoreboardToMarkdown', () => {
  it('produces tables and redacts secrets', () => {
    const sessions = [sess({ projectSlug: 'sk-ant-api03-LEAKEDsecret1234567890abc', tokenCount: 100 })];
    const md = scoreboardToMarkdown(computeScoreboard(sessions, [], NOW), 'All projects');
    expect(md).toContain('# Markr AI Scoreboard');
    expect(md).toContain('Most-worked projects');
    expect(md).toContain('<svg');                 // chart kept as inline SVG
    expect(md).toContain('| Project |');          // and the portable table below
    expect(md).toContain('[REDACTED:anthropic-key]');
    expect(md).not.toContain('LEAKEDsecret1234567890');
  });

  it('exports chart SVG using the selected scorecard theme palette', () => {
    const sessions = [sess({ tool: 'codex', tokenCount: 100 }), sess({ tool: 'claude-code', tokenCount: 200 })];
    const md = scoreboardToMarkdown(computeScoreboard(sessions, [], NOW), 'All projects', 'linear');
    expect(md).toContain('fill="#15151b"'); // Linear chart panel background
    expect(md).toContain('fill="#8b92ff"'); // Linear first tool colour
    expect(md).toContain('fill="#50d774"'); // Linear second tool colour
  });
});
