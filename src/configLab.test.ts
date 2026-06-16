/**
 * configLab.test.ts — checks, prompt construction, redaction, summary.
 */
import { describe, it, expect } from 'vitest';
import { evaluateChecks, buildMessages, summarizeResult, hashConfig, isStale, regressionDelta } from './configLab';

describe('evaluateChecks', () => {
  it('must-include passes when all present (case-insensitive)', () => {
    const r = evaluateChecks('You should run `npm test` first.', { mustInclude: ['npm test'] });
    expect(r.mustInclude[0].ok).toBe(true);
    expect(r.pass).toBe(true);
  });

  it('must-include fails when missing', () => {
    const r = evaluateChecks('Run the build.', { mustInclude: ['npm test'] });
    expect(r.mustInclude[0].ok).toBe(false);
    expect(r.pass).toBe(false);
  });

  it('must-not-include passes when absent, fails when present', () => {
    expect(evaluateChecks('use npm', { mustNotInclude: ['yarn'] }).pass).toBe(true);
    expect(evaluateChecks('use yarn add', { mustNotInclude: ['yarn'] }).pass).toBe(false);
  });

  it('combines include + exclude', () => {
    const r = evaluateChecks('run npm test, not yarn', { mustInclude: ['npm test'], mustNotInclude: ['pnpm'] });
    expect(r.pass).toBe(true);
  });

  it('returns pass=null when there are no deterministic checks', () => {
    expect(evaluateChecks('anything', {}).pass).toBe(null);
  });
});

describe('buildMessages', () => {
  it('puts the config text in the system prompt and the test prompt as the user message', () => {
    const out = buildMessages('# Rules\nAlways use pnpm.', 'AGENTS.md', { prompt: 'install a dep' });
    expect(out.systemPrompt).toContain('AGENTS.md');
    expect(out.systemPrompt).toContain('Always use pnpm.');
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toEqual({ role: 'user', content: 'install a dep' });
  });

  it('redacts secrets in the config AND the prompt before sending', () => {
    const cfg = 'Deploy key: ' + 'sk-' + 'abcdefghijklmnopqrstuvwx';
    const out = buildMessages(cfg, 'CLAUDE.md', { prompt: 'use ' + 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
    expect(out.systemPrompt).toContain('[REDACTED:openai-key]');
    expect(out.systemPrompt).not.toContain('abcdefghijklmnopqrstuvwx');
    expect(out.messages[0].content).toContain('[REDACTED:github-token]');
    expect(out.redactions).toBe(2);
  });
});

describe('summarizeResult', () => {
  it('reports pass', () => {
    const s = summarizeResult({ output: 'npm test', checks: evaluateChecks('npm test', { mustInclude: ['npm test'] }) });
    expect(s.status).toBe('pass');
  });
  it('reports fail with what was missing', () => {
    const s = summarizeResult({ output: 'nope', checks: evaluateChecks('nope', { mustInclude: ['npm test'] }) });
    expect(s.status).toBe('fail');
    expect(s.summary).toContain('npm test');
  });
  it('reports manual when no checks', () => {
    const s = summarizeResult({ output: 'x', checks: evaluateChecks('x', {}) });
    expect(s.status).toBe('manual');
  });
});

describe('regression-on-edit helpers', () => {
  it('hashConfig is deterministic and changes with content', () => {
    expect(hashConfig('a')).toBe(hashConfig('a'));
    expect(hashConfig('a')).not.toBe(hashConfig('b'));
  });

  it('isStale: false with no prior run, false on same hash, true after config change', () => {
    expect(isStale({ lastRun: undefined }, 'h1')).toBe(false);
    expect(isStale({ lastRun: { status: 'pass', at: 0, configHash: 'h1' } }, 'h1')).toBe(false);
    expect(isStale({ lastRun: { status: 'pass', at: 0, configHash: 'h1' } }, 'h2')).toBe(true);
  });

  it('regressionDelta classifies transitions', () => {
    expect(regressionDelta(undefined, 'pass')).toBe('new');
    expect(regressionDelta('pass', 'fail')).toBe('regressed');
    expect(regressionDelta('fail', 'pass')).toBe('fixed');
    expect(regressionDelta('pass', 'pass')).toBe('unchanged');
  });
});
