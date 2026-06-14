/**
 * configSuggester.test.ts — repetition clustering, imperative rewrite,
 * target-file precedence, dead-rule detection.
 */
import { describe, it, expect } from 'vitest';
import {
  tokenSet, jaccard, clusterConstraints, toRuleText, pickTargetFile,
  buildAddSuggestions, splitConfigSections, sectionKeywords, detectDeadRules,
} from './configSuggester';
import type { MemoryItem } from './memoryStore';

function item(text: string, over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: Math.random().toString(36).slice(2), kind: 'constraint', text,
    tool: 'claude-code', sessionId: 's1', firstSeen: 0, lastSeen: 0,
    occurrences: 2, status: 'active',
    evidence: [{ sessionId: 's1', tool: 'claude-code', ts: 0, quote: text }],
    ...over,
  };
}

describe('jaccard / clustering', () => {
  it('jaccard of identical sets is 1, disjoint is 0', () => {
    expect(jaccard(tokenSet('use pnpm always'), tokenSet('use pnpm always'))).toBe(1);
    expect(jaccard(tokenSet('apples bananas'), tokenSet('rockets planets'))).toBe(0);
  });

  it('clusters near-duplicate constraints together', () => {
    const items = [
      item('Always use pnpm, not npm'),
      item('Use pnpm instead of npm please'),
      item('Never commit secrets to the repository'),
    ];
    const clusters = clusterConstraints(items);
    // The two pnpm constraints cluster; the secrets one is separate.
    const sizes = clusters.map(c => c.length).sort();
    expect(sizes).toEqual([1, 2]);
  });
});

describe('toRuleText (imperative rewrite)', () => {
  it('strips politeness prefixes and capitalizes', () => {
    expect(toRuleText('please always use pnpm, not npm.')).toBe('Always use pnpm, not npm');
    expect(toRuleText('Make sure every new function has a unit test')).toBe('Every new function has a unit test');
    expect(toRuleText('can you keep the bundle under 2MB?')).toBe('Keep the bundle under 2MB');
  });
});

describe('pickTargetFile (precedence)', () => {
  it('prefers CLAUDE.md > AGENTS.md > .cursorrules', () => {
    expect(pickTargetFile(['.cursorrules', 'AGENTS.md', 'CLAUDE.md'])).toBe('CLAUDE.md');
    expect(pickTargetFile(['.cursorrules', 'AGENTS.md'])).toBe('AGENTS.md');
    expect(pickTargetFile(['.cursorrules'])).toBe('.cursorrules');
  });
  it('falls back to CLAUDE.md when none exist', () => {
    expect(pickTargetFile([])).toBe('CLAUDE.md');
  });
});

describe('buildAddSuggestions', () => {
  it('suggests a rule from a cluster seen across ≥2 sessions', () => {
    const items = [
      item('Always use pnpm, not npm', {
        sessionId: 's1', occurrences: 3,
        evidence: [
          { sessionId: 's1', tool: 'claude-code', ts: 1, quote: 'Always use pnpm, not npm' },
          { sessionId: 's2', tool: 'cursor', ts: 2, quote: 'use pnpm instead of npm' },
        ],
      }),
    ];
    const sug = buildAddSuggestions(items, 'CLAUDE.md');
    expect(sug).toHaveLength(1);
    expect(sug[0].ruleText).toBe('Always use pnpm, not npm');
    expect(sug[0].targetFile).toBe('CLAUDE.md');
    expect(sug[0].estimatedTokens).toBeGreaterThan(0);
    expect(sug[0].evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('skips constraints seen in only one session', () => {
    const items = [item('Use tabs not spaces', { occurrences: 5, evidence: [{ sessionId: 's1', tool: 'claude-code', ts: 0, quote: 'use tabs' }] })];
    expect(buildAddSuggestions(items, 'CLAUDE.md')).toHaveLength(0);
  });
});

describe('dead-rule detection', () => {
  const config = [
    '# Project',
    'Intro text.',
    '## Legacy Widgets',
    'Run the kubernetes cluster script with helmfile against the staging environment.',
    '## Styling',
    'Use the tailwind utility classes and the radix primitives.',
  ].join('\n');

  it('splits sections and extracts keywords', () => {
    const sections = splitConfigSections(config);
    expect(sections.map(s => s.heading)).toContain('Legacy Widgets');
    const kw = sectionKeywords(sections.find(s => s.heading === 'Legacy Widgets')!);
    expect(kw).toContain('kubernetes');
    expect(kw).toContain('helmfile');
  });

  it('flags a section whose keywords never appear in recent transcripts', () => {
    const sections = splitConfigSections(config);
    // 10 transcripts all about styling — Legacy Widgets keywords never appear.
    const transcripts = Array.from({ length: 10 }, (_, i) => `session ${i}: tweaked tailwind classes and radix primitives`);
    const dead = detectDeadRules(sections, transcripts);
    expect(dead.some(d => d.sectionHeading === 'Legacy Widgets')).toBe(true);
    expect(dead.some(d => d.sectionHeading === 'Styling')).toBe(false);
  });

  it('does nothing with too few transcripts', () => {
    const sections = splitConfigSections(config);
    expect(detectDeadRules(sections, ['only one session'], 'generic', 10)).toHaveLength(0);
  });

  it('never flags a guardrail section (Security) for removal', () => {
    const cfg = [
      '## Security',
      'Never commit secrets. Rotate credentials. Report incidents.',
      '## Misc',
      'Some forgotten kubernetes helmfile thing nobody touches.',
    ].join('\n');
    const sections = splitConfigSections(cfg);
    const transcripts = Array.from({ length: 12 }, () => 'unrelated styling work');
    const dead = detectDeadRules(sections, transcripts);
    expect(dead.some(d => d.sectionHeading === 'Security')).toBe(false);  // protected
    expect(dead.some(d => d.sectionHeading === 'Misc')).toBe(true);
    // Non-destructive framing
    expect(dead.find(d => d.sectionHeading === 'Misc')!.ruleText).toMatch(/review|stale/i);
  });
});

describe('stable suggestion ids', () => {
  it('id is stable when the cluster representative text changes', () => {
    const a = buildAddSuggestions([
      item('Always use pnpm, not npm', { occurrences: 2, evidence: [
        { sessionId: 's1', tool: 'claude-code', ts: 1, quote: 'Always use pnpm, not npm' },
        { sessionId: 's2', tool: 'cursor', ts: 2, quote: 'use pnpm not npm' },
      ] }),
    ], 'CLAUDE.md');
    // Same cluster tokens, different representative wording → same id.
    const b = buildAddSuggestions([
      item('Use pnpm not npm always', { occurrences: 9, evidence: [
        { sessionId: 's1', tool: 'claude-code', ts: 1, quote: 'Use pnpm not npm always' },
        { sessionId: 's2', tool: 'cursor', ts: 2, quote: 'pnpm always not npm' },
      ] }),
    ], 'CLAUDE.md');
    expect(a[0].id).toBe(b[0].id);
  });
});
