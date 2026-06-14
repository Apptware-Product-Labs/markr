/**
 * handoffTargets.test.ts — block upsert, consumed-marking, per-tool shaping.
 */
import { describe, it, expect } from 'vitest';
import {
  HANDOFF_START, HANDOFF_END, targetFileFor, upsertHandoffBlock,
  markBlockConsumed, markWholeConsumed, cursorMdc, shapeWholeFile,
} from './handoffTargets';

describe('targetFileFor', () => {
  it('maps each tool to its native file', () => {
    expect(targetFileFor('claude-code')).toEqual({ relPath: 'CLAUDE.local.md', mode: 'block' });
    expect(targetFileFor('cursor')!.relPath).toBe('.cursor/rules/markr-handoff.mdc');
    expect(targetFileFor('codex')!.relPath).toBe('HANDOFF.md');
    expect(targetFileFor('augment')!.relPath).toBe('HANDOFF.md');
    expect(targetFileFor('chatgpt')).toBeNull();
    expect(targetFileFor('clipboard')).toBeNull();
  });
});

describe('upsertHandoffBlock', () => {
  it('appends a block to a file that has none, preserving content', () => {
    const out = upsertHandoffBlock('# My notes\n\nSome existing text.', 'HANDOFF BODY');
    expect(out).toContain('# My notes');
    expect(out).toContain('Some existing text.');
    expect(out).toContain(HANDOFF_START);
    expect(out).toContain('HANDOFF BODY');
    expect(out).toContain(HANDOFF_END);
  });

  it('replaces an existing block without touching the rest', () => {
    const initial = upsertHandoffBlock('# Keep me\n\ntext', 'OLD BODY');
    const updated = upsertHandoffBlock(initial, 'NEW BODY');
    expect(updated).toContain('# Keep me');
    expect(updated).toContain('NEW BODY');
    expect(updated).not.toContain('OLD BODY');
    // Only one block
    expect(updated.split(HANDOFF_START).length - 1).toBe(1);
  });

  it('handles an empty file', () => {
    const out = upsertHandoffBlock('', 'BODY');
    expect(out.startsWith(HANDOFF_START)).toBe(true);
    expect(out).toContain('BODY');
  });

  it('leaves content OUTSIDE the markers byte-for-byte intact (seam-scoped)', () => {
    // Interior blank lines + intentional spacing in the surrounding content must survive.
    const before = '# Title\n\nPara one.\n\n\nPara two with trailing.   ';
    const initial = upsertHandoffBlock(before, 'OLD');
    const updated = upsertHandoffBlock(initial, 'NEW');
    expect(updated).toContain('# Title\n\nPara one.\n\n\nPara two with trailing.');
    expect(updated).toContain('NEW');
    expect(updated).not.toContain('OLD');
  });
});

describe('markWholeConsumed', () => {
  it('flips cursor alwaysApply to false and stamps consumed', () => {
    const mdc = cursorMdc('continue the work');
    const out = markWholeConsumed('cursor', mdc, '2026-06-11');
    expect(out).toContain('alwaysApply: false');
    expect(out).not.toMatch(/alwaysApply:\s*true/);
    expect(out).toContain('(consumed 2026-06-11)');
  });

  it('stamps HANDOFF.md (codex/augment) as consumed', () => {
    const out = markWholeConsumed('codex', 'HANDOFF CONTENT', '2026-06-11');
    expect(out.startsWith('> (consumed 2026-06-11)')).toBe(true);
    expect(out).toContain('HANDOFF CONTENT');
  });

  it('is idempotent', () => {
    const once = markWholeConsumed('codex', 'X', '2026-06-11');
    expect(markWholeConsumed('codex', once, '2026-06-12')).toBe(once);
  });
});

describe('markBlockConsumed', () => {
  it('marks an existing block as consumed', () => {
    const withBlock = upsertHandoffBlock('', 'BODY');
    const marked = markBlockConsumed(withBlock, '2026-06-11');
    expect(marked).toContain('markr:handoff:start (consumed 2026-06-11)');
  });

  it('is a no-op without a block', () => {
    expect(markBlockConsumed('# just notes', '2026-06-11')).toBe('# just notes');
  });

  it('does not double-mark', () => {
    const once = markBlockConsumed(upsertHandoffBlock('', 'BODY'), '2026-06-11');
    const twice = markBlockConsumed(once, '2026-06-12');
    expect(twice.match(/consumed/g)!.length).toBe(1);
  });
});

describe('shaping', () => {
  it('cursorMdc includes frontmatter', () => {
    const out = cursorMdc('rule body');
    expect(out).toMatch(/^---\n/);
    expect(out).toContain('alwaysApply: true');
    expect(out).toContain('rule body');
  });

  it('shapeWholeFile uses mdc for cursor, plain otherwise', () => {
    expect(shapeWholeFile('cursor', 'b')).toContain('alwaysApply');
    expect(shapeWholeFile('codex', 'b')).toBe('b\n');
  });
});
