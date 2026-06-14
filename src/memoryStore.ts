/**
 * memoryStore.ts — persistent cross-session memory for CRH residuals.
 *
 * The decisions / dead-ends / constraints mined from a session are currently
 * computed at handoff time and thrown away. This store persists them, deduped,
 * one JSON file per project, so handoffs can be seeded from earlier sessions and
 * a "Memory" view can show what the project has accumulated.
 *
 * LOCAL-ONLY: plain JSON under the extension's globalStorage dir. No network.
 *
 * The store takes a base directory (string), NOT a vscode context, so the whole
 * thing is unit-testable against a temp dir. The extension passes
 * `context.globalStorageUri.fsPath + '/memory'`.
 */
import * as fs     from 'fs';
import * as path   from 'path';
import * as crypto from 'crypto';
import type { AiTool, SessionInfo } from './sessionReader';
import { redactSecrets } from './redact';

export type MemoryKind   = 'decision' | 'deadEnd' | 'constraint';
export type MemoryStatus = 'active' | 'dismissed' | 'promoted';

export interface MemoryItem {
  id:            string;
  kind:          MemoryKind;
  text:          string;
  tool:          AiTool;
  sessionId:     string;   // session that first created the item
  lastSessionId?: string;  // most recent session to (re)state it
  firstSeen:     number;
  lastSeen:      number;
  occurrences:   number;
  status:        MemoryStatus;
  /** Distinct-session sightings (capped) — powers config-suggestion evidence. */
  evidence?:     Array<{ sessionId: string; tool: AiTool; ts: number; quote: string }>;
}

const EVIDENCE_CAP = 5;

export interface ProjectMemory {
  version:     1;
  projectPath: string;
  items:       MemoryItem[];
  /** High-water mark: sessionId → lastActive(ms) at last scan (incremental scan). */
  scanned:     Record<string, number>;
}

export interface MinedResiduals {
  decisions:   string[];
  deadEnds:    string[];
  constraints: string[];
}

export const MEMORY_CAP = 500;

// ─── Pure helpers (no IO — directly unit-tested) ───────────────────────────────

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dedupe key: normalized text, first 60 chars. */
export function dedupeKey(text: string): string {
  return normalizeText(text).slice(0, 60);
}

/** Deterministic id from kind + dedupe key, so the same fact maps to one item. */
export function itemId(kind: MemoryKind, text: string): string {
  return crypto.createHash('sha1').update(`${kind}|${dedupeKey(text)}`).digest('hex').slice(0, 16);
}

/**
 * Merge one mined fact into a list. On a dedupe hit, bump occurrences + lastSeen
 * (keeping the earliest firstSeen) instead of inserting a duplicate.
 * Returns the (mutated) list for convenience.
 */
export function mergeItem(
  items: MemoryItem[],
  incoming: { kind: MemoryKind; text: string; tool: AiTool; sessionId: string; ts: number },
): MemoryItem[] {
  const id = itemId(incoming.kind, incoming.text);
  const existing = items.find(i => i.id === id);
  if (existing) {
    existing.occurrences += 1;
    existing.lastSeen = Math.max(existing.lastSeen, incoming.ts);
    existing.lastSessionId = incoming.sessionId;
    // Record a distinct-session sighting (capped) for suggestion evidence.
    if (!existing.evidence) existing.evidence = [];
    if (existing.evidence.length < EVIDENCE_CAP && !existing.evidence.some(e => e.sessionId === incoming.sessionId)) {
      existing.evidence.push({ sessionId: incoming.sessionId, tool: incoming.tool, ts: incoming.ts, quote: incoming.text });
    }
    // Resurface a previously dismissed item only if it recurs in a NEW session.
    if (existing.status === 'dismissed' && existing.sessionId !== incoming.sessionId) {
      existing.status = 'active';
    }
    return items;
  }
  items.push({
    id,
    kind:          incoming.kind,
    text:          incoming.text,
    tool:          incoming.tool,
    sessionId:     incoming.sessionId,
    lastSessionId: incoming.sessionId,
    firstSeen:     incoming.ts,
    lastSeen:      incoming.ts,
    occurrences:   1,
    status:        'active',
    evidence:      [{ sessionId: incoming.sessionId, tool: incoming.tool, ts: incoming.ts, quote: incoming.text }],
  });
  return items;
}

/**
 * Evict down to `cap`: oldest DISMISSED first (by lastSeen asc), then oldest by
 * lastSeen regardless of status. Returns a new array.
 */
export function evict(items: MemoryItem[], cap = MEMORY_CAP): MemoryItem[] {
  if (items.length <= cap) return items;
  const sorted = [...items].sort((a, b) => {
    const ad = a.status === 'dismissed' ? 0 : 1;
    const bd = b.status === 'dismissed' ? 0 : 1;
    if (ad !== bd) return ad - bd;           // dismissed group first (evicted first)
    return a.lastSeen - b.lastSeen;          // oldest first within group
  });
  // Drop from the front (oldest dismissed, then oldest) until at cap.
  const toDrop = new Set(sorted.slice(0, items.length - cap).map(i => i.id));
  return items.filter(i => !toDrop.has(i.id));
}

// ─── File-backed store ─────────────────────────────────────────────────────────

export class MemoryStore {
  constructor(private readonly baseDir: string) {}

  private projectHash(projectPath: string): string {
    return crypto.createHash('sha1').update(projectPath).digest('hex').slice(0, 16);
  }

  private fileFor(projectPath: string): string {
    return path.join(this.baseDir, `${this.projectHash(projectPath)}.json`);
  }

  private empty(projectPath: string): ProjectMemory {
    return { version: 1, projectPath, items: [], scanned: {} };
  }

  load(projectPath: string): ProjectMemory {
    try {
      const raw = fs.readFileSync(this.fileFor(projectPath), 'utf-8');
      const parsed = JSON.parse(raw) as ProjectMemory;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) return this.empty(projectPath);
      if (!parsed.scanned) parsed.scanned = {};
      return parsed;
    } catch {
      return this.empty(projectPath);
    }
  }

  private save(mem: ProjectMemory): void {
    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
      fs.writeFileSync(this.fileFor(mem.projectPath), JSON.stringify(mem, null, 2));
    } catch { /* best-effort; never throw into the sidebar */ }
  }

  /** Has this session changed since we last mined it? (high-water mark) */
  needsScan(projectPath: string, session: Pick<SessionInfo, 'id' | 'lastActive'>): boolean {
    const mem = this.load(projectPath);
    return mem.scanned[session.id] !== session.lastActive;
  }

  /** Merge a session's mined residuals into the project's memory. */
  addFromSession(session: SessionInfo, mined: MinedResiduals): ProjectMemory {
    const mem = this.load(session.projectPath);
    const ts = session.lastActive || session.startedAt || 0;
    const add = (kind: MemoryKind, texts: string[]) => {
      for (const text of texts) {
        if (!text || !text.trim()) continue;
        // Redact BEFORE persisting — memory is a new at-rest surface and must
        // honour the same "never store secrets" guarantee as handoffs.
        const safe = redactSecrets(text.trim()).text;
        mergeItem(mem.items, { kind, text: safe, tool: session.tool, sessionId: session.id, ts });
      }
    };
    add('decision',   mined.decisions);
    add('deadEnd',    mined.deadEnds);
    add('constraint', mined.constraints);
    mem.items = evict(mem.items);
    mem.scanned[session.id] = session.lastActive;

    // Prune the high-water map: drop sessions that no longer contribute any
    // retained item (their items were evicted), so it can't grow unbounded.
    const live = new Set<string>();
    for (const i of mem.items) { live.add(i.sessionId); if (i.lastSessionId) live.add(i.lastSessionId); }
    live.add(session.id);
    for (const sid of Object.keys(mem.scanned)) if (!live.has(sid)) delete mem.scanned[sid];

    this.save(mem);
    return mem;
  }

  getForProject(projectPath: string): MemoryItem[] {
    return this.load(projectPath).items;
  }

  /** Set status for an item by id. Scans project files to find its owner. */
  setStatus(id: string, status: MemoryStatus): boolean {
    let files: string[];
    try { files = fs.readdirSync(this.baseDir).filter(f => f.endsWith('.json')); } catch { return false; }
    for (const f of files) {
      let mem: ProjectMemory;
      try { mem = JSON.parse(fs.readFileSync(path.join(this.baseDir, f), 'utf-8')); } catch { continue; }
      const item = mem.items?.find(i => i.id === id);
      if (item) {
        item.status = status;
        this.save(mem);
        return true;
      }
    }
    return false;
  }

  // ── Handoff history (last 20 per project, in a sibling handoffs/ dir) ───────
  private handoffsDir(): string { return path.join(path.dirname(this.baseDir), 'handoffs'); }
  private handoffFile(projectPath: string): string {
    return path.join(this.handoffsDir(), `${this.projectHash(projectPath)}.json`);
  }

  addHandoff(projectPath: string, entry: { timestamp: number; sourceTool: AiTool; target: string; text: string }): void {
    let list: Array<typeof entry & { projectPath: string }> = [];
    try { list = JSON.parse(fs.readFileSync(this.handoffFile(projectPath), 'utf-8')); } catch { /* none yet */ }
    list.unshift({ ...entry, projectPath });
    list = list.slice(0, 20);
    try {
      fs.mkdirSync(this.handoffsDir(), { recursive: true });
      fs.writeFileSync(this.handoffFile(projectPath), JSON.stringify(list, null, 2));
    } catch { /* best-effort */ }
  }

  getHandoffs(projectPath: string): Array<{ timestamp: number; sourceTool: AiTool; target: string; text: string }> {
    try { return JSON.parse(fs.readFileSync(this.handoffFile(projectPath), 'utf-8')); } catch { return []; }
  }

  // ── Config-suggestion accept/dismiss state (separate small file) ────────────
  private suggestionStatePath(): string { return path.join(this.baseDir, 'suggestion-state.json'); }

  getSuggestionState(): Record<string, 'accepted' | 'dismissed'> {
    try { return JSON.parse(fs.readFileSync(this.suggestionStatePath(), 'utf-8')); } catch { return {}; }
  }

  setSuggestionStatus(id: string, status: 'accepted' | 'dismissed'): void {
    const state = this.getSuggestionState();
    state[id] = status;
    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
      fs.writeFileSync(this.suggestionStatePath(), JSON.stringify(state, null, 2));
    } catch { /* best-effort */ }
  }

  /** Search across all projects (case-insensitive substring). */
  searchAll(query: string): Array<MemoryItem & { projectPath: string }> {
    const q = query.toLowerCase().trim();
    const out: Array<MemoryItem & { projectPath: string }> = [];
    let files: string[];
    try { files = fs.readdirSync(this.baseDir).filter(f => f.endsWith('.json')); } catch { return out; }
    for (const f of files) {
      let mem: ProjectMemory;
      try { mem = JSON.parse(fs.readFileSync(path.join(this.baseDir, f), 'utf-8')); } catch { continue; }
      for (const item of mem.items || []) {
        if (!q || item.text.toLowerCase().includes(q)) out.push({ ...item, projectPath: mem.projectPath });
      }
    }
    return out;
  }
}
