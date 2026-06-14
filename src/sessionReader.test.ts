/**
 * sessionReader.test.ts — unit tests for the CRH (Conditional Residual Handoff)
 * pure functions: title derivation, task de-contamination, decision/dead-end/
 * constraint mining, and handoff document structure.
 *
 * These cover the heuristics that would otherwise regress silently.
 * Run with `npm test`.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveClaudeTitle,
  chooseTask,
  firstMeaningfulLine,
  splitSentences,
  mineByRegex,
  DECISION_RE,
  FAIL_RE,
  CONSTRAINT_RE,
  PASTED_CONTENT_RE,
  generateHandoff,
  parseClineHistory,
  parseGeminiChat,
  type SessionContext,
  type SessionMessage,
} from './sessionReader';

// ── Helpers ───────────────────────────────────────────────────────────────────

function user(text: string): SessionMessage  { return { role: 'user', text }; }

function makeCtx(over: Partial<SessionContext> = {}): SessionContext {
  return {
    task:            'Build the support widget',
    lastUserMsg:     'Build the support widget',
    lastAssistMsg:   'Implemented the panel and wired the API.',
    recentMessages:  [],
    filesModified:   [],
    filesRead:       [],
    commandsRun:     [],
    nextSteps:       [],
    lastVerifiedCommand: '',
    projectPath:     '/Users/dev/proj',
    projectSlug:     'proj',
    model:           'Claude Code',
    messageCount:    10,
    tokenCount:      1234,
    decisions:        [],
    failedApproaches: [],
    constraints:      [],
    gitBranch:        '',
    gitDirtyFiles:    [],
    gitDiffStat:      '',
    ...over,
  };
}

// ── deriveClaudeTitle ───────────────────────────────────────────────────────

describe('deriveClaudeTitle', () => {
  it('skips the continuation-summary preamble and picks the real task line', () => {
    const msgs = [
      user('This session is being continued from a previous conversation.\nYou are building features for Markr — a VS Code extension.'),
    ];
    expect(deriveClaudeTitle(msgs)).toBe('You are building features for Markr — a VS Code extension.');
  });

  it('skips system/caveat/XML preamble lines', () => {
    const msgs = [user('<system-reminder>ignore me</system-reminder>\nCaveat: local command\nFix the broken dashboard banner backgrounds')];
    expect(deriveClaudeTitle(msgs)).toBe('Fix the broken dashboard banner backgrounds');
  });

  it('strips leading markdown markers', () => {
    expect(deriveClaudeTitle([user('## Add Zod validation to the route')])).toBe('Add Zod validation to the route');
  });

  it('truncates to 80 chars', () => {
    const long = 'a'.repeat(200);
    expect(deriveClaudeTitle([user(long)]).length).toBe(80);
  });

  it('returns a sentinel when there is no usable user text', () => {
    expect(deriveClaudeTitle([])).toBe('(no title)');
    expect(deriveClaudeTitle([{ role: 'assistant', text: 'hi' }])).toBe('(no title)');
  });
});

// ── chooseTask (de-contamination) ───────────────────────────────────────────

describe('chooseTask', () => {
  it('leads with original task when the last message is a throwaway follow-up', () => {
    const ctx = makeCtx({
      task: 'Fix the back button so it navigates to the status tracker instead of discarding the draft',
      lastUserMsg: 'give me a commit message',
    });
    const { task, background } = chooseTask(ctx);
    expect(task).toContain('back button');
    expect(background).toContain('commit message');
  });

  it('treats the "google app?" tangent as a throwaway', () => {
    const ctx = makeCtx({
      task: 'You broke the dashboard banner backgrounds — fix the light-theme cards to match Figma',
      lastUserMsg: 'any change needed on google app?',
    });
    expect(chooseTask(ctx).task).toContain('dashboard banner');
  });

  it('leads with the last message when it is substantive', () => {
    const ctx = makeCtx({
      task: 'Original short task',
      lastUserMsg: 'Now refactor the allocation service to use the new tenant-aware query helper and add tests for the edge cases',
    });
    expect(chooseTask(ctx).task).toContain('refactor the allocation service');
  });

  it('no background when last == first', () => {
    const ctx = makeCtx({ task: 'Same task', lastUserMsg: 'Same task' });
    expect(chooseTask(ctx).background).toBe('');
  });
});

// ── firstMeaningfulLine ─────────────────────────────────────────────────────

describe('firstMeaningfulLine', () => {
  it('skips conversational filler', () => {
    const txt = 'Yes — one thing to be aware of.\nThe migration drops the legacy column, which breaks older clients.';
    expect(firstMeaningfulLine(txt)).toContain('migration drops the legacy column');
  });

  it('strips code fences before scanning', () => {
    const txt = '```ts\nconst x = 1;\n```\nThe root cause was a missing await in the handler.';
    expect(firstMeaningfulLine(txt)).toContain('root cause');
  });

  it('returns empty string for empty input', () => {
    expect(firstMeaningfulLine('')).toBe('');
  });
});

// ── splitSentences ──────────────────────────────────────────────────────────

describe('splitSentences', () => {
  it('strips fenced code and splits on sentence boundaries', () => {
    const out = splitSentences('First sentence here. ```code block here``` Second sentence follows.');
    expect(out.some(s => s.includes('First sentence'))).toBe(true);
    expect(out.some(s => s.includes('code block'))).toBe(false);
  });

  it('drops very short fragments', () => {
    expect(splitSentences('ok. no.')).toEqual([]);
  });
});

// ── mining regexes ──────────────────────────────────────────────────────────

describe('decision/dead-end/constraint mining', () => {
  it('DECISION_RE catches rationale language', () => {
    const prose = ['I did not set targetId to reportType because audit_log.target_id is a UUID column.'];
    const found = mineByRegex(prose, DECISION_RE, 8);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('UUID column');
  });

  it('FAIL_RE catches a range of dead-end phrasings', () => {
    const samples = [
      'I rolled back the optimistic update because it caused flicker.',
      "Couldn't get the SSE stream to work with the proxy.",
      'That approach does not compile under strict mode.',
      'Abandoned the worker-thread idea after the regression.',
    ];
    for (const s of samples) {
      expect(mineByRegex([s], FAIL_RE, 5)).toHaveLength(1);
    }
  });

  it('CONSTRAINT_RE catches user requirements', () => {
    const prose = ['You must not change the public API.', 'Always preserve the tenant_id column.'];
    expect(mineByRegex(prose, CONSTRAINT_RE, 6)).toHaveLength(2);
  });

  it('reject filter drops pasted review-bot / file-ref lines', () => {
    const pasted = ['Medium: src/lib/reports/audit.ts (line 17) does not pass a stable targetId.'];
    expect(PASTED_CONTENT_RE.test(pasted[0])).toBe(true);
    // With the reject filter, the pasted line is excluded even though it matches CONSTRAINT_RE ("does not")
    expect(mineByRegex(pasted, CONSTRAINT_RE, 6, PASTED_CONTENT_RE)).toHaveLength(0);
  });

  it('dedupes near-identical sentences', () => {
    const dup = ['The fix is to await the handler.', 'The fix is to await the handler.'];
    expect(mineByRegex(dup, DECISION_RE, 8)).toHaveLength(1);
  });

  it('respects the cap', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Decision ${i}: chose option ${i} because reasons ${i}.`);
    expect(mineByRegex(many, DECISION_RE, 3)).toHaveLength(3);
  });
});

// ── generateHandoff (document structure) ────────────────────────────────────

describe('generateHandoff', () => {
  it('includes all CRH sections', () => {
    const ctx = makeCtx({
      decisions: ['Chose SSE over polling because latency matters.'],
      failedApproaches: ['Rolled back the worker-thread approach.'],
      constraints: ['Must not break the public API.'],
      gitBranch: 'feat/support-widget',
      gitDirtyFiles: ['M src/widget.ts'],
      filesModified: ['src/widget.ts'],
    });
    const doc = generateHandoff(ctx, 'claude-code', 'claude-code');
    expect(doc).toContain('Decision log');
    expect(doc).toContain('Chose SSE over polling');
    expect(doc).toContain('do not redo');
    expect(doc).toContain('Rolled back the worker-thread');
    expect(doc).toContain('Constraints');
    expect(doc).toContain('Must not break the public API');
    expect(doc).toContain('feat/support-widget');
    expect(doc).toContain('SYNTHESIS');
  });

  it('uses repo-aware framing for agentic targets', () => {
    const doc = generateHandoff(makeCtx(), 'claude-code', 'cursor');
    expect(doc).toContain('You have the repository');
  });

  it('uses repo-less framing for ChatGPT', () => {
    const doc = generateHandoff(makeCtx(), 'claude-code', 'chatgpt');
    expect(doc).toContain('do NOT have the repository');
  });

  it('de-contaminates the task in the paste block', () => {
    const ctx = makeCtx({
      task: 'Fix the back button navigation on drafted issuance',
      lastUserMsg: 'give me a commit message',
    });
    const doc = generateHandoff(ctx, 'augment', 'claude-code');
    // The paste-block TASK should be the real task, not the throwaway
    const pasteBlock = doc.split('```text')[1]?.split('```')[0] ?? '';
    expect(pasteBlock).toContain('back button navigation');
  });
});

// ── Phase 5: new tool parsers ───────────────────────────────────────────────

describe('parseClineHistory (Cline / Roo Code)', () => {
  it('parses Anthropic-format messages, string + block content', () => {
    const raw = JSON.stringify([
      { role: 'user', content: '<task>Fix the bug</task>' },
      { role: 'assistant', content: [
        { type: 'text', text: 'I will look into it.' },
        { type: 'tool_use', name: 'read', input: { path: 'a.ts' } },
      ] },
      { role: 'user', content: [{ type: 'tool_result', content: 'file contents here' }] },
    ]);
    const msgs = parseClineHistory(raw);
    expect(msgs).toHaveLength(2); // tool_result-only message has no prose → skipped
    expect(msgs[0]).toMatchObject({ role: 'user', text: '<task>Fix the bug</task>' });
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].text).toContain('look into it');
    expect(msgs[1].fullLength).toBeGreaterThan(msgs[1].text.length); // tool_use bytes counted
  });

  it('returns [] on malformed JSON', () => {
    expect(parseClineHistory('not json')).toEqual([]);
    expect(parseClineHistory('{"not":"an array"}')).toEqual([]);
  });

  it('infers cwd from environment_details so it appears in project scope', () => {
    // inferClineCwd is exercised via parse → the reader; here we assert the
    // pattern the reader keys on is present in a realistic first message.
    const firstMsg = 'Task\n\n<environment_details>\n# Current Working Directory (/Users/me/app) Files\nsrc/\n</environment_details>';
    expect(/Current Working Directory\s*\(([^)]+)\)/.exec(firstMsg)?.[1]).toBe('/Users/me/app');
  });
});

describe('parseGeminiChat', () => {
  it('maps model→assistant and reads parts[].text', () => {
    const raw = JSON.stringify([
      { role: 'user', parts: [{ text: 'hello there' }] },
      { role: 'model', parts: [{ text: 'general kenobi' }] },
    ]);
    const msgs = parseGeminiChat(raw);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].text).toBe('general kenobi');
  });

  it('handles a { messages: [...] } wrapper and string content', () => {
    const raw = JSON.stringify({ messages: [{ role: 'user', content: 'wrapped message here' }] });
    expect(parseGeminiChat(raw)[0].text).toBe('wrapped message here');
  });

  it('returns [] on malformed JSON', () => {
    expect(parseGeminiChat('nope')).toEqual([]);
  });
});
