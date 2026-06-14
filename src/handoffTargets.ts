/**
 * handoffTargets.ts — shape a handoff for native, file-based delivery into each
 * tool's own convention, so continuity is zero-click (the next session in that
 * tool picks the file up automatically).
 *
 * Pure / dependency-free (string + path shaping only) so it's fully unit-tested.
 * The actual file IO + confirmation lives in contextBridge.
 *
 *   claude-code → CLAUDE.local.md, inside a delimited block (rest of file untouched)
 *   cursor      → .cursor/rules/markr-handoff.mdc  (frontmatter: description, alwaysApply)
 *   codex/augment → HANDOFF.md at repo root
 */
import type { TargetTool } from './sessionReader';

export const HANDOFF_START = '<!-- markr:handoff:start -->';
export const HANDOFF_END   = '<!-- markr:handoff:end -->';

export interface TargetFile {
  /** Path relative to the workspace root. */
  relPath: string;
  /** 'block' = replace a delimited block inside the file; 'whole' = own the file. */
  mode: 'block' | 'whole';
}

/** Where each target tool's handoff file lives, and how Markr owns it. */
export function targetFileFor(target: TargetTool): TargetFile | null {
  switch (target) {
    case 'claude-code': return { relPath: 'CLAUDE.local.md', mode: 'block' };
    case 'cursor':      return { relPath: '.cursor/rules/markr-handoff.mdc', mode: 'whole' };
    case 'codex':
    case 'augment':     return { relPath: 'HANDOFF.md', mode: 'whole' };
    default:            return null; // chatgpt / clipboard → no native file
  }
}

/**
 * Insert or replace Markr's delimited handoff block in an existing file's
 * content, leaving everything outside the markers untouched. Appends the block
 * if not already present.
 */
export function upsertHandoffBlock(existing: string, body: string): string {
  const block = `${HANDOFF_START}\n${body.trim()}\n${HANDOFF_END}`;
  const src = existing || '';
  const start = src.indexOf(HANDOFF_START);
  const end = src.indexOf(HANDOFF_END);
  if (start !== -1 && end !== -1 && end > start) {
    // Replace only the block; normalize ONLY the seams so content outside the
    // markers is byte-for-byte untouched (apart from trailing whitespace at the
    // immediate junction).
    const before = src.slice(0, start).replace(/[ \t]*\n+$/, '');
    const after = src.slice(end + HANDOFF_END.length).replace(/^\n+[ \t]*/, '');
    const parts: string[] = [];
    if (before) parts.push(before);
    parts.push(block);
    if (after) parts.push(after);
    return parts.join('\n\n') + '\n';
  }
  // Append — trim only the file's trailing whitespace, never its interior/leading.
  const sep = src.trim() ? src.replace(/\s+$/, '') + '\n\n' : '';
  return `${sep}${block}\n`;
}

/**
 * Mark a whole-file handoff (cursor .mdc / HANDOFF.md) as consumed once a new
 * session has started in that tool: drop cursor's always-apply so a stale
 * continuation stops being injected, and stamp a consumed marker. Idempotent.
 */
export function markWholeConsumed(target: TargetTool, content: string, date: string): string {
  if (/\(consumed /.test(content)) return content;
  if (target === 'cursor') {
    const flipped = content.replace(/alwaysApply:\s*true/i, 'alwaysApply: false');
    return `${flipped.replace(/\s+$/, '')}\n\n> (consumed ${date})\n`;
  }
  return `> (consumed ${date})\n\n${content}`;
}

/**
 * Mark an existing handoff block as consumed by prepending "(consumed <date>)"
 * to the start marker. Used when a NEW session is detected in the target tool.
 * No-op if there is no block or it's already marked.
 */
export function markBlockConsumed(existing: string, date: string): string {
  const src = existing || '';
  if (!src.includes(HANDOFF_START)) return src;
  if (src.includes('markr:handoff:start (consumed')) return src;
  return src.replace(HANDOFF_START, `<!-- markr:handoff:start (consumed ${date}) -->`);
}

/** Cursor .mdc rule file with the required frontmatter. */
export function cursorMdc(body: string): string {
  return [
    '---',
    'description: Continuation handoff written by Markr',
    'alwaysApply: true',
    '---',
    '',
    body.trim(),
    '',
  ].join('\n');
}

/** Shape the final file content for a target (whole-file modes). */
export function shapeWholeFile(target: TargetTool, body: string): string {
  if (target === 'cursor') return cursorMdc(body);
  return body.trim() + '\n';
}
