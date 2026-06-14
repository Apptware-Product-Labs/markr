/**
 * configSuggester.ts — "configs that write themselves".
 *
 * Observes what users repeatedly tell their agents (persisted constraint memory)
 * and proposes config-file rules backed by evidence. Also detects "dead rules" —
 * sections of the existing config whose keywords never appear in recent sessions.
 *
 * Pure / dependency-free (only tokenEngine for token estimates), so the whole
 * suggestion engine is unit-testable. The extension supplies the inputs
 * (memory items, which config files exist, recent transcripts).
 */
import * as crypto from 'crypto';
import { countTokens, type AiModel } from './tokenEngine';
import type { MemoryItem } from './memoryStore';

export interface SuggestionEvidence {
  sessionId: string;
  tool:      string;
  date:      number;
  quote:     string;
}

export interface ConfigSuggestion {
  id:              string;
  type:            'add' | 'remove';
  ruleText:        string;
  evidence:        SuggestionEvidence[];
  targetFile:      string;
  estimatedTokens: number;
  status:          'pending' | 'accepted' | 'dismissed';
  sectionHeading?: string;          // for 'remove'
}

// ─── Token-set similarity (hand-rolled, no dependency) ─────────────────────────

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'that', 'this',
  'use', 'using', 'please', 'should', 'must', 'always', 'never', 'make', 'sure',
  'can', 'could', 'would', 'when', 'into', 'from', 'have', 'has', 'all', 'any',
]);

/** Distinctive lowercase tokens (length ≥ 3, no stopwords). */
export function tokenSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of String(text || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Greedy clustering of constraint items by token-set Jaccard ≥ threshold. */
export function clusterConstraints(items: MemoryItem[], threshold = 0.6): MemoryItem[][] {
  const clusters: Array<{ rep: Set<string>; members: MemoryItem[] }> = [];
  for (const item of items) {
    const ts = tokenSet(item.text);
    let placed = false;
    for (const c of clusters) {
      if (jaccard(ts, c.rep) >= threshold) { c.members.push(item); placed = true; break; }
    }
    if (!placed) clusters.push({ rep: ts, members: [item] });
  }
  return clusters.map(c => c.members);
}

/** Stable signature for a cluster: sorted union of its token sets. Used for a
 *  suggestion id that survives the representative text changing between scans
 *  (so a dismissed suggestion doesn't resurrect under a new id). */
export function clusterSignature(cluster: MemoryItem[]): string {
  const toks = new Set<string>();
  for (const m of cluster) for (const t of tokenSet(m.text)) toks.add(t);
  return [...toks].sort().join(' ');
}

/** Distinct sessions a cluster was seen across (from evidence + ids). */
export function distinctSessions(cluster: MemoryItem[]): Set<string> {
  const s = new Set<string>();
  for (const item of cluster) {
    s.add(item.sessionId);
    if (item.lastSessionId) s.add(item.lastSessionId);
    for (const e of item.evidence ?? []) s.add(e.sessionId);
  }
  return s;
}

// ─── Imperative rewrite ────────────────────────────────────────────────────────

const POLITE_PREFIX = /^(?:please\s+|can you\s+|could you\s+|make sure (?:to\s+|that\s+)?|i('?d| would) (?:like|prefer) (?:you to\s+)?|you (?:should|must|need to)\s+|always remember to\s+)/i;

/** Turn a raw constraint into a terse imperative config rule. */
export function toRuleText(text: string): string {
  let t = String(text || '').trim().replace(/\s+/g, ' ');
  t = t.replace(POLITE_PREFIX, '').trim();
  t = t.replace(/[.!?]+$/, '');
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ─── Target-file precedence ────────────────────────────────────────────────────

const TARGET_PRECEDENCE = ['CLAUDE.md', 'AGENTS.md', '.cursorrules'];

/**
 * Pick the primary config file to append to, by precedence. If none exist,
 * returns 'CLAUDE.md' (to be created on accept).
 * @param existing  basenames of config files present in the workspace.
 */
export function pickTargetFile(existing: string[]): string {
  const set = new Set(existing.map(f => f.trim()));
  for (const f of TARGET_PRECEDENCE) if (set.has(f)) return f;
  return 'CLAUDE.md';
}

// ─── Suggestion builders ───────────────────────────────────────────────────────

function suggestionId(type: string, key: string): string {
  return crypto.createHash('sha1').update(`${type}|${key.toLowerCase()}`).digest('hex').slice(0, 16);
}

/**
 * Build 'add' suggestions: cluster constraints seen ≥2× across ≥2 distinct
 * sessions, rewrite each cluster's representative as an imperative rule.
 */
export function buildAddSuggestions(
  constraints: MemoryItem[],
  targetFile: string,
  model: AiModel = 'generic',
): ConfigSuggestion[] {
  const eligible = constraints.filter(i => i.status === 'active' && i.occurrences >= 2);
  const clusters = clusterConstraints(eligible);
  const out: ConfigSuggestion[] = [];
  for (const cluster of clusters) {
    if (distinctSessions(cluster).size < 2) continue;
    // Representative = most-seen item in the cluster.
    const rep = [...cluster].sort((a, b) => b.occurrences - a.occurrences)[0];
    const ruleText = toRuleText(rep.text);
    if (!ruleText) continue;
    const evidence: SuggestionEvidence[] = [];
    for (const item of cluster) {
      for (const e of item.evidence ?? [{ sessionId: item.sessionId, tool: item.tool, ts: item.lastSeen, quote: item.text }]) {
        if (evidence.length < 6) evidence.push({ sessionId: e.sessionId, tool: String(e.tool), date: e.ts, quote: e.quote });
      }
    }
    out.push({
      id:              suggestionId('add', clusterSignature(cluster)),
      type:            'add',
      ruleText,
      evidence,
      targetFile,
      estimatedTokens: countTokens(ruleText, model),
      status:          'pending',
    });
  }
  return out;
}

// ─── Dead-rule detection ───────────────────────────────────────────────────────

export interface ConfigSection { heading: string; body: string; level: number; }

/** Split a markdown config into heading/body sections (level 0 = preamble). */
export function splitConfigSections(markdown: string): ConfigSection[] {
  const lines = String(markdown || '').split('\n');
  const sections: ConfigSection[] = [];
  let cur: ConfigSection = { heading: '(preamble)', body: '', level: 0 };
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      if (cur.body.trim() || cur.heading !== '(preamble)') sections.push(cur);
      cur = { heading: m[2].trim(), level: m[1].length, body: '' };
    } else {
      cur.body += line + '\n';
    }
  }
  if (cur.body.trim() || cur.heading !== '(preamble)') sections.push(cur);
  return sections;
}

/** Distinctive keywords for a section: identifiers/words ≥5 chars, no stopwords. */
export function sectionKeywords(section: ConfigSection): string[] {
  const out = new Set<string>();
  for (const w of `${section.heading} ${section.body}`.toLowerCase().replace(/[^\w\s.-]/g, ' ').split(/\s+/)) {
    const clean = w.replace(/^[.-]+|[.-]+$/g, '');
    if (clean.length >= 5 && !STOPWORDS.has(clean)) out.add(clean);
  }
  return [...out];
}

/**
 * 'remove' suggestions: a section whose distinctive keywords never appear across
 * recent transcripts (with at least `minSessions` transcripts to judge from).
 */
// Sections whose VALUE is highest precisely when they're never discussed —
// guardrails. Never recommend removing these, and never frame removal as default.
const PROTECTED_RE = /\b(secur(?:e|ity)|secret|safety|safe|licen[cs]e|deploy(?:ment)?|auth|credential|privacy|incident|complian(?:t|ce)|backup|disaster|recovery|rollback|legal|gdpr|pii|vulnerab)/i;

export function isProtectedSection(section: ConfigSection): boolean {
  if (PROTECTED_RE.test(section.heading)) return true;
  return sectionKeywords(section).some(k => PROTECTED_RE.test(k));
}

export function detectDeadRules(
  sections: ConfigSection[],
  transcripts: string[],
  model: AiModel = 'generic',
  minSessions = 10,
): ConfigSuggestion[] {
  if (transcripts.length < minSessions) return [];
  const haystack = transcripts.join('\n').toLowerCase();
  const out: ConfigSuggestion[] = [];
  for (const section of sections) {
    if (section.level === 0) continue;            // never flag the preamble
    if (isProtectedSection(section)) continue;    // never suggest removing guardrails
    const keywords = sectionKeywords(section);
    if (keywords.length < 2) continue;            // too generic to judge
    const anyHit = keywords.some(k => haystack.includes(k));
    if (anyHit) continue;
    out.push({
      id:              suggestionId('remove', section.heading),
      type:            'remove',
      // Non-destructive framing — "review", not "delete".
      ruleText:        `Section "${section.heading}" may be stale — review whether it's still needed (no keyword from it appeared in the last ${transcripts.length} sessions).`,
      evidence:        [],
      targetFile:      '',
      estimatedTokens: countTokens(`${'#'.repeat(section.level)} ${section.heading}\n${section.body}`, model),
      status:          'pending',
      sectionHeading:  section.heading,
    });
  }
  return out;
}
