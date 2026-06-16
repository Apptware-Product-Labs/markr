/**
 * configLab.ts — pure logic for AI Config Lab.
 *
 * No vscode, no IO — so it's fully unit-tested. The panel/runner glue lives in
 * configLabRunner.ts.
 *
 *   - evaluateChecks: deterministic must-include / must-not-include pass/fail
 *   - buildMessages:  config file → system instruction, test prompt → user msg,
 *                     with secret redaction applied to everything outbound
 *   - summarizeResult: short human summary of a run
 */
import * as crypto from 'crypto';
import { redactSecrets } from './redact';
import type { ConfigTestCase, TestStatus } from './configLabStore';

export interface CheckResult { text: string; ok: boolean; }
export interface ChecksOutcome {
  mustInclude:    CheckResult[];
  mustNotInclude: CheckResult[];
  /** true = all checks pass, false = at least one fails, null = no deterministic checks. */
  pass:           boolean | null;
}

/** Case-insensitive substring check of the model output against a test's rules. */
export function evaluateChecks(output: string, test: Pick<ConfigTestCase, 'mustInclude' | 'mustNotInclude'>): ChecksOutcome {
  const hay = (output || '').toLowerCase();
  const inc = (test.mustInclude ?? []).filter(s => s.trim());
  const exc = (test.mustNotInclude ?? []).filter(s => s.trim());

  const mustInclude    = inc.map(text => ({ text, ok: hay.includes(text.toLowerCase()) }));
  const mustNotInclude = exc.map(text => ({ text, ok: !hay.includes(text.toLowerCase()) }));

  if (!inc.length && !exc.length) {
    return { mustInclude, mustNotInclude, pass: null }; // nothing deterministic → manual
  }
  const pass = mustInclude.every(c => c.ok) && mustNotInclude.every(c => c.ok);
  return { mustInclude, mustNotInclude, pass };
}

export interface OutboundMessages {
  systemPrompt: string;
  messages:     Array<{ role: 'user' | 'assistant'; content: string }>;
  /** number of secrets redacted from the outbound payload (config + prompt). */
  redactions:   number;
}

/**
 * Build the request payload: the AI config file becomes the system/developer
 * instruction, the test prompt becomes the user message. Secrets are redacted
 * from BOTH before anything leaves the machine.
 */
export function buildMessages(
  configText: string,
  configPath: string,
  test: Pick<ConfigTestCase, 'prompt'>,
): OutboundMessages {
  const cfg    = redactSecrets(configText || '');
  const prompt = redactSecrets(test.prompt || '');

  const systemPrompt = [
    `You are the AI assistant configured by the following instruction file (${configPath}).`,
    'Follow it exactly as you would in a real coding session. Do not mention that this is a test.',
    '',
    '--- BEGIN AI CONFIG ---',
    cfg.text,
    '--- END AI CONFIG ---',
  ].join('\n');

  return {
    systemPrompt,
    messages: [{ role: 'user', content: prompt.text }],
    redactions: cfg.count + prompt.count,
  };
}

export interface TestRunResult {
  output: string;
  checks: ChecksOutcome;
}

/** Stable hash of the config text, to detect when a test's last result is stale. */
export function hashConfig(text: string): string {
  return crypto.createHash('sha1').update(text || '').digest('hex').slice(0, 16);
}

/** A test is stale if it has a prior run but the config has changed since. */
export function isStale(test: Pick<ConfigTestCase, 'lastRun'>, currentConfigHash: string): boolean {
  return !!test.lastRun && test.lastRun.configHash !== currentConfigHash;
}

/** Regression classification of a re-run vs. the previous result. */
export function regressionDelta(before: TestStatus | undefined, after: TestStatus): 'regressed' | 'fixed' | 'unchanged' | 'new' {
  if (!before) return 'new';
  if (before === 'pass' && after === 'fail') return 'regressed';
  if (before === 'fail' && after === 'pass') return 'fixed';
  return 'unchanged';
}

/** One-line status + summary for a completed run. */
export function summarizeResult(result: TestRunResult): { status: 'pass' | 'fail' | 'manual'; summary: string } {
  const { checks } = result;
  if (checks.pass === null) {
    return { status: 'manual', summary: 'No automatic checks — review the output against the expected behavior.' };
  }
  const failedInc = checks.mustInclude.filter(c => !c.ok).map(c => c.text);
  const failedExc = checks.mustNotInclude.filter(c => !c.ok).map(c => c.text);
  if (checks.pass) {
    return { status: 'pass', summary: 'All include/exclude checks passed.' };
  }
  const parts: string[] = [];
  if (failedInc.length) parts.push(`missing: ${failedInc.join(', ')}`);
  if (failedExc.length) parts.push(`should not contain: ${failedExc.join(', ')}`);
  return { status: 'fail', summary: parts.join(' · ') };
}
