/**
 * sessionReader.ts — Read AI tool session transcripts from disk
 *
 * Supports:
 *   - Claude Code  (~/.claude/projects/<hash>/<uuid>.jsonl)
 *   - OpenAI Codex (~/.codex/sessions/YYYY/MM/DD/*.jsonl + archived_sessions/)
 *   - Aider        (.aider.chat.history.md in workspace)
 *   - Cursor       (~/Library/…/Cursor/User/workspaceStorage/<hash>/state.vscdb)
 *   - Augment Code (~/Library/…/Code/User/workspaceStorage/<hash>/Augment.vscode-augment/augment-kv-store/)
 *
 * Reads only what is already on disk — no network calls, no data sent anywhere.
 */

import * as cp   from 'child_process';
import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { redactSecrets } from './redact';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AiTool =
  | 'claude-code' | 'codex' | 'aider' | 'cursor' | 'augment'
  | 'cline' | 'roo-code' | 'windsurf' | 'gemini-cli';

export interface SessionMessage {
  role: 'user' | 'assistant';
  text: string;        // conversational text only — used for display & summarisation
  ts?:  number;        // unix ms
  fullLength?: number; // total byte count including tool_use inputs + tool_result content;
                       // when set, roughTokens() uses this instead of text.length so
                       // file reads and bash outputs are counted toward the session total
}

export interface SessionInfo {
  id:           string;
  tool:         AiTool;
  projectPath:  string;   // workspace root this session belongs to
  projectSlug:  string;   // human-readable label (last 2 path segments)
  filePath:     string;   // absolute path to the session file / DB
  messages:     SessionMessage[];
  startedAt:    number;   // unix ms
  lastActive:   number;   // unix ms (mtime of file)
  title:        string;   // first user message, truncated to 80 chars
  tokenCount:   number;   // rough estimate
  isActive:     boolean;  // file modified within last 2 hours (live session)
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

/** True if `child` is the same as or nested under `parent`, with a path-segment
 *  boundary so /Users/me/app does NOT match the sibling /Users/me/app-v2. */
function pathWithin(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.replace(/\/$/, '') + '/');
}

/** Convert /Users/foo/bar → human label using last 2 path segments */
function pathToLabel(fsPath: string): string {
  const parts = fsPath.replace(/^file:\/\//, '').split(path.sep).filter(Boolean);
  return parts.slice(-2).join('/') || fsPath;
}

function roughTokens(messages: SessionMessage[]): number {
  // Use fullLength when available (includes tool_use inputs + tool_result content)
  // so that file reads and bash outputs are reflected in the session token total.
  return messages.reduce((s, m) => s + Math.ceil((m.fullLength ?? m.text.length) / 4), 0);
}

// ─── Claude Code reader ───────────────────────────────────────────────────────

const CLAUDE_ROOT = path.join(os.homedir(), '.claude', 'projects');

/**
 * Convert an absolute path to a Claude Code project-directory slug.
 * Claude Code encodes /Users/foo/my-app as -Users-foo-my-app (all slashes → dashes).
 * We encode the workspace path the same way so we can compare directly.
 */
function pathToClaudeSlug(fsPath: string): string {
  return fsPath.replace(/\//g, '-');
}

/**
 * Best-effort decode of a Claude Code slug → human-readable label.
 * NOTE: this is ambiguous when folder names contain hyphens (e.g. "my-app").
 * Only use for display (projectSlug), never for equality checks.
 */
function slugToDisplayLabel(slug: string): string {
  // slug = -Users-Sumit-Desktop-my-project
  // Take last 3 dash-separated tokens so hyphenated project names like
  // "apptware-bench-mark" render correctly as "apptware-bench-mark" rather
  // than the truncated "bench-mark" that slice(-2) would produce.
  // NOTE: still ambiguous when 4+ tokens belong to the project name itself;
  // contextBridge.ts overrides this with the real folder name for open workspaces.
  const parts = slug.replace(/^-/, '').split('-');
  return parts.slice(-3).join('-') || slug;
}

// ── Claude file smart-reader ───────────────────────────────────────────────
// Large sessions (the biggest on disk is >91 MB) cannot be fully read on every
// sidebar refresh — that blocks the extension host for seconds.
// Strategy: read the first HEAD_BYTES for the title + last TAIL_BYTES for
// recent messages.  Partial JSON lines at the boundary are skipped gracefully
// by the JSON.parse try-catch that already wraps every line.
//
// HEAD_BYTES must be large enough to capture the first queue-operation line
// even when the user pastes a large conversation-summary as the opening
// prompt (e.g. Claude Code continuation sessions start with a summary that
// can be 10-20 KB).  We use 20 KB so even the longest summaries fit cleanly.
const CLAUDE_HEAD_BYTES = 20_000;
const CLAUDE_TAIL_BYTES = 60_000;
const CLAUDE_FAST_THRESHOLD = CLAUDE_HEAD_BYTES + CLAUDE_TAIL_BYTES; // 80 KB

function readClaudeFileSmart(filePath: string, fileSize: number): string {
  if (fileSize <= CLAUDE_FAST_THRESHOLD) {
    // Small file — read fully as before
    return fs.readFileSync(filePath, 'utf-8');
  }
  // Large file — read head (for title) + tail (for recent messages)
  const fd = fs.openSync(filePath, 'r');
  try {
    const headBuf = Buffer.alloc(CLAUDE_HEAD_BYTES);
    const tailBuf = Buffer.alloc(CLAUDE_TAIL_BYTES);
    fs.readSync(fd, headBuf, 0, CLAUDE_HEAD_BYTES, 0);
    fs.readSync(fd, tailBuf, 0, CLAUDE_TAIL_BYTES, fileSize - CLAUDE_TAIL_BYTES);
    // Join with a newline so the last head-line and first tail-line don't merge
    return headBuf.toString('utf-8') + '\n' + tailBuf.toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

// Maximum total Claude Code sessions returned (sorted newest-first by mtime).
// Prevents reading hundreds of JSONL files when a user has many old projects.
// Sessions belonging to an OPEN workspace are always included regardless of this
// cap (see priorityPaths in readClaudeCodeSessions) — the cap only bounds the
// long tail of OTHER projects.
const CLAUDE_MAX_SESSIONS = 50;

// Lines that are session plumbing / preamble, not the actual task — skipped
// when deriving a human-readable title so continuation sessions don't show
// "This session is being continued…" as their title.
const TITLE_SKIP_RE = /^(this session is being continued|caveat:|<|\[system|summary:|analysis:|continue the conversation|please continue|the user (?:has |is |asked|wants))/i;

/** Derive a meaningful title: first real instruction line, skipping the
 *  continuation-summary / system preamble that long sessions open with. */
export function deriveClaudeTitle(messages: SessionMessage[]): string {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    for (const rawLine of m.text.split('\n')) {
      const t = rawLine.trim().replace(/^#+\s*/, '').replace(/^[-*]\s+/, '').replace(/^\*\*|\*\*$/g, '');
      if (t.length < 8) continue;
      if (TITLE_SKIP_RE.test(t)) continue;
      return t.slice(0, 80);
    }
  }
  const firstUser = messages.find(m => m.role === 'user');
  return firstUser ? firstUser.text.split('\n')[0].slice(0, 80) || '(no title)' : '(no title)';
}

function parseClaudeSession(filePath: string, fileSize?: number): SessionMessage[] {
  const messages: SessionMessage[] = [];
  let raw: string;
  try {
    raw = readClaudeFileSmart(filePath, fileSize ?? fs.statSync(filePath).size);
  } catch { return []; }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try { d = JSON.parse(line); } catch { continue; }

    if (d.type === 'user' || d.type === 'assistant') {
      const msg = d.message as Record<string, unknown> | undefined;
      if (!msg) continue;
      const content = msg.content;
      let text = '';
      let toolBytes = 0; // bytes from tool_use inputs + tool_result content

      if (Array.isArray(content)) {
        for (const raw of content) {
          if (typeof raw !== 'object' || raw === null) continue;
          const c = raw as Record<string, unknown>;

          if (c.type === 'text') {
            // Conversational text — used for display and summarisation
            text += String(c.text ?? '') + '\n';

          } else if (c.type === 'tool_result') {
            // User message: results from the previous turn's tool calls.
            // These carry file contents, bash outputs, etc. — often the bulk
            // of the token budget but not conversational; count but don't display.
            if (Array.isArray(c.content)) {
              for (const tc of c.content as Record<string, unknown>[]) {
                if (typeof tc === 'object' && tc !== null && tc.type === 'text') {
                  toolBytes += String(tc.text ?? '').length;
                }
              }
            } else if (typeof c.content === 'string') {
              toolBytes += c.content.length;
            }

          } else if (c.type === 'tool_use') {
            // Assistant message: the tool call request (file path, command, etc.)
            if (c.input) toolBytes += JSON.stringify(c.input).length;
          }
        }
      } else if (typeof content === 'string') {
        text = content;
      }

      text = text.trim();
      if (!text) continue; // skip messages that are pure tool plumbing with no prose
      const ts = typeof d.timestamp === 'string'
        ? new Date(d.timestamp).getTime()
        : typeof d.timestamp === 'number' ? d.timestamp : undefined;
      const fullLength = text.length + toolBytes;
      messages.push({
        role:       d.type as 'user' | 'assistant',
        text,
        ts,
        // Only set fullLength when there is actually extra tool content to count;
        // avoids storing an unnecessary field on every conversational-only message.
        ...(toolBytes > 0 ? { fullLength } : {}),
      });
    }

    // queue-operation enqueue = opening user message (before the session starts)
    if (d.type === 'queue-operation' && (d as Record<string, unknown>).operation === 'enqueue') {
      const content = (d as Record<string, unknown>).content;
      if (typeof content === 'string' && content.trim() && messages.length === 0) {
        messages.push({ role: 'user', text: content.trim() });
      }
    }
  }
  return messages;
}

export function readClaudeCodeSessions(workspacePath?: string, priorityPaths?: string[]): SessionInfo[] {
  if (!fs.existsSync(CLAUDE_ROOT)) return [];

  const wsSlug = workspacePath ? pathToClaudeSlug(workspacePath) : '';
  // Slugs of open workspaces — their sessions bypass the cap entirely so the
  // current project's sessions are NEVER dropped, even with many old projects.
  const prioritySlugs = new Set((priorityPaths ?? []).map(pathToClaudeSlug));

  // ── Step 1: collect all (filePath, slug, stat) entries, sort by mtime ─────
  // We do stat() on every file but read none yet — stat is fast (metadata only).
  type Entry = { filePath: string; slug: string; stat: fs.Stats };
  const allEntries: Entry[] = [];

  try {
    for (const slug of fs.readdirSync(CLAUDE_ROOT)) {
      const projectDir = path.join(CLAUDE_ROOT, slug);
      try { if (!fs.statSync(projectDir).isDirectory()) continue; } catch { continue; }
      if (wsSlug && slug !== wsSlug) continue;

      let files: string[];
      try { files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
      for (const file of files) {
        const filePath = path.join(projectDir, file);
        let stat: fs.Stats;
        try { stat = fs.statSync(filePath); } catch { continue; }
        allEntries.push({ filePath, slug, stat });
      }
    }
  } catch { /* directory not readable */ }

  // Sort newest-first by mtime, then cap — but keep ALL open-workspace sessions
  // first, and fill the remaining budget from other projects.  This guarantees
  // the current project is fully covered while still bounding total reads.
  allEntries.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  const priority = allEntries.filter(e => prioritySlugs.has(e.slug));
  const rest     = allEntries.filter(e => !prioritySlugs.has(e.slug));
  const budget   = Math.max(0, CLAUDE_MAX_SESSIONS - priority.length);
  const toRead   = [...priority, ...rest.slice(0, budget)];

  // ── Step 2: parse only the capped list ────────────────────────────────────
  const results: SessionInfo[] = [];
  const now = Date.now();

  for (const { filePath, slug, stat } of toRead) {
    const messages = parseClaudeSession(filePath, stat.size);
    if (!messages.length) continue;

    // For large files we only read head+tail, so roughTokens() under-counts.
    // Use file size / 4 as a more representative estimate for those.
    const tokenCount = stat.size > CLAUDE_FAST_THRESHOLD
      ? Math.round(stat.size / 4)
      : roughTokens(messages);

    results.push({
      id:          path.basename(filePath).replace('.jsonl', ''),
      tool:        'claude-code',
      projectPath: slug.replace(/^-/, '/').replace(/-/g, '/'), // heuristic; overridden in contextBridge
      projectSlug: slugToDisplayLabel(slug),
      filePath,
      messages,
      startedAt:   messages[0]?.ts ?? stat.birthtimeMs ?? stat.ctimeMs,
      lastActive:  stat.mtimeMs,
      title:       deriveClaudeTitle(messages),
      tokenCount,
      isActive:    (now - stat.mtimeMs) < 2 * 60 * 60 * 1000,
    });
  }

  return results.sort((a, b) => b.lastActive - a.lastActive);
}

// ─── Codex CLI reader ─────────────────────────────────────────────────────────
// Sessions live at ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
// and ~/.codex/archived_sessions/rollout-<ts>-<uuid>.jsonl
//
// Each JSONL line format:
//   { "timestamp": "...", "type": "session_meta",   "payload": { "cwd": "...", "id": "..." } }
//   { "timestamp": "...", "type": "response_item",  "payload": { "type": "message", "role": "user"|"assistant", "content": [{ "type": "input_text", "text": "..." }] } }
//   { "timestamp": "...", "type": "event_msg",      "payload": { "type": "task_started", ... } }

const CODEX_ROOT = path.join(os.homedir(), '.codex');
const CODEX_MAX_SESSIONS = 40;

const _codexParseCache = new Map<string, {
  size: number;
  mtimeMs: number;
  parsed: { messages: SessionMessage[]; cwd: string };
}>();

function parseCodexSession(filePath: string): { messages: SessionMessage[]; cwd: string } {
  let stat: fs.Stats | undefined;
  try { stat = fs.statSync(filePath); } catch { return { messages: [], cwd: '' }; }

  const cached = _codexParseCache.get(filePath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.parsed;
  }

  const messages: SessionMessage[] = [];
  let cwd = '';
  let raw: string;
  try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { return { messages, cwd }; }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try { d = JSON.parse(line); } catch { continue; }

    const payload = d.payload as Record<string, unknown> | undefined;
    if (!payload) continue;

    // Extract project directory from session metadata
    if (d.type === 'session_meta') {
      if (typeof payload.cwd === 'string') cwd = payload.cwd;
      continue;
    }

    // Extract messages from response items
    if (d.type === 'response_item' && payload.type === 'message') {
      const role = payload.role as string;
      // Only capture genuine user messages (skip "developer" role system context)
      if (role !== 'user' && role !== 'assistant') continue;

      const content = payload.content;
      let text = '';
      if (Array.isArray(content)) {
        text = content
          .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
          .map(c => {
            // input_text, output_text, text — all have a .text field
            if (typeof c.text === 'string') return c.text;
            if (typeof c.output_text === 'string') return c.output_text;
            return '';
          })
          .join('\n');
      } else if (typeof content === 'string') {
        text = content;
      }
      text = text.trim();
      // Skip system injection messages (start with XML-like tags — env context, permissions, etc.)
      if (!text || text.startsWith('<') || text.startsWith('[SYSTEM]')) continue;

      const ts = typeof d.timestamp === 'string' ? new Date(d.timestamp).getTime() : undefined;
      messages.push({ role: role as 'user' | 'assistant', text, ts });
    }

    // response_output_item = assistant's actual reply
    if (d.type === 'response_output_item') {
      const output = payload as Record<string, unknown>;
      if (output.type === 'message' && output.role === 'assistant') {
        const content = output.content;
        let text = '';
        if (Array.isArray(content)) {
          text = (content as Record<string, unknown>[])
            .map(c => typeof c.text === 'string' ? c.text : '')
            .join('\n');
        } else if (typeof content === 'string') {
          text = content;
        }
        text = text.trim();
        if (text) {
          const ts = typeof d.timestamp === 'string' ? new Date(d.timestamp).getTime() : undefined;
          messages.push({ role: 'assistant', text, ts });
        }
      }
    }
  }
  const parsed = { messages, cwd };
  _codexParseCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, parsed });
  return parsed;
}

/** Recursively find .jsonl files in a directory up to maxDepth levels deep */
function findJsonlFiles(dir: string, maxDepth: number): string[] {
  if (maxDepth < 0 || !fs.existsSync(dir)) return [];
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory() && maxDepth > 0) {
        results.push(...findJsonlFiles(full, maxDepth - 1));
      } else if (entry.endsWith('.jsonl')) {
        results.push(full);
      }
    }
  } catch { /* not readable */ }
  return results;
}

export function readCodexSessions(workspacePath?: string): SessionInfo[] {
  if (!fs.existsSync(CODEX_ROOT)) return [];
  const results: SessionInfo[] = [];
  const entries: Array<{ filePath: string; stat: fs.Stats }> = [];

  const scanDir = (dir: string, maxDepth: number) => {
    for (const filePath of findJsonlFiles(dir, maxDepth)) {
      let stat: fs.Stats;
      try { stat = fs.statSync(filePath); } catch { continue; }
      entries.push({ filePath, stat });
    }
  };

  // Scan live sessions: ~/.codex/sessions/YYYY/MM/DD/ (3 levels deep)
  scanDir(path.join(CODEX_ROOT, 'sessions'), 3);
  // Scan archived sessions: ~/.codex/archived_sessions/ (flat)
  scanDir(path.join(CODEX_ROOT, 'archived_sessions'), 0);

  entries.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  for (const { filePath, stat } of entries.slice(0, CODEX_MAX_SESSIONS)) {
    const { messages, cwd } = parseCodexSession(filePath);
    if (!messages.length) continue;

    // Filter by workspace if provided (path-segment boundary)
    if (workspacePath && cwd && !pathWithin(cwd, workspacePath)) continue;

    const projectPath = cwd || path.dirname(filePath);
    const firstUser   = messages.find(m => m.role === 'user');
    const uuid        = path.basename(filePath).replace(/^rollout-[^-]+-/, '').replace('.jsonl', '');
    const now         = Date.now();

    results.push({
      id:          uuid || path.basename(filePath, '.jsonl'),
      tool:        'codex',
      projectPath,
      projectSlug: cwd ? pathToLabel(cwd) : 'codex',
      filePath,
      messages,
      startedAt:   messages[0]?.ts ?? stat.birthtimeMs ?? stat.ctimeMs,
      lastActive:  stat.mtimeMs,
      title:       firstUser ? firstUser.text.split('\n')[0].slice(0, 80) : '(codex session)',
      tokenCount:  roughTokens(messages),
      isActive:    (now - stat.mtimeMs) < 2 * 60 * 60 * 1000,
    });
  }

  return results.sort((a, b) => b.lastActive - a.lastActive);
}

// ─── Cursor reader ────────────────────────────────────────────────────────────
// Each workspace has a SQLite DB at:
//   macOS:   ~/Library/Application Support/Cursor/User/workspaceStorage/<hash>/state.vscdb
//   Linux:   ~/.config/Cursor/User/workspaceStorage/<hash>/state.vscdb
//   Windows: ~/AppData/Roaming/Cursor/User/workspaceStorage/<hash>/state.vscdb
//
// Relevant keys in the ItemTable:
//   workspace.json           → { "folder": "file:///absolute/path" }  (in the dir, not the DB)
//   aiService.prompts        → [{text: "...", commandType: N}]  — user messages
//   aiService.generations    → [{unixMs: N, textDescription: "...", type: "composer"}]

// Cache whether sqlite3 binary is available — checked once, not on every 30s refresh
let _sqlite3Available: boolean | undefined;
function hasSqlite3(): boolean {
  if (_sqlite3Available === undefined) {
    try {
      cp.execSync('which sqlite3', { stdio: 'ignore', timeout: 1_000 });
      _sqlite3Available = true;
    } catch {
      _sqlite3Available = false;
    }
  }
  return _sqlite3Available;
}

/** Run sqlite3 CLI and return output; returns empty string on any error */
function sqlite3Query(dbPath: string, sql: string): string {
  try {
    return cp.execSync(`sqlite3 "${dbPath}" ${JSON.stringify(sql)}`, {
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return '';
  }
}

/** App-storage workspaceStorage path for a VS Code-family app (Cursor, Windsurf). */
function vscFamilyWorkspaceStorage(appDir: string): string {
  const p = os.platform();
  if (p === 'darwin')  return path.join(os.homedir(), 'Library', 'Application Support', appDir, 'User', 'workspaceStorage');
  if (p === 'linux')   return path.join(os.homedir(), '.config', appDir, 'User', 'workspaceStorage');
  if (p === 'win32')   return path.join(os.homedir(), 'AppData', 'Roaming', appDir, 'User', 'workspaceStorage');
  return '';
}

function cursorWorkspaceStoragePath(): string { return vscFamilyWorkspaceStorage('Cursor'); }

/**
 * Shared reader for VS Code-family apps that store chat prompts in
 * `<workspaceStorage>/<hash>/state.vscdb` (Cursor, Windsurf). Reads the workspace
 * folder from workspace.json and user prompts via the aiService.* keys.
 */
function readVscdbSessions(storageRoot: string, tool: AiTool, workspacePath?: string): SessionInfo[] {
  if (!storageRoot || !fs.existsSync(storageRoot)) return [];
  if (!hasSqlite3()) return [];

  const results: SessionInfo[] = [];
  let hashes: string[];
  try { hashes = fs.readdirSync(storageRoot); } catch { return []; }

  for (const hash of hashes) {
    const dbPath = path.join(storageRoot, hash, 'state.vscdb');
    const wjPath = path.join(storageRoot, hash, 'workspace.json');
    if (!fs.existsSync(dbPath)) continue;

    let folderUri = '';
    try {
      const wj = JSON.parse(fs.readFileSync(wjPath, 'utf-8'));
      folderUri = typeof wj.folder === 'string' ? wj.folder : '';
    } catch { continue; }

    const projectPath = folderUri.replace(/^file:\/\//, '');
    if (workspacePath && projectPath && !pathWithin(projectPath, workspacePath)) continue;

    const promptsJson = sqlite3Query(dbPath, 'SELECT value FROM ItemTable WHERE key = \'aiService.prompts\'');
    if (!promptsJson) continue;

    let promptsArr: Array<{ text?: string; commandType?: number }>;
    try { promptsArr = JSON.parse(promptsJson); } catch { continue; }
    if (!Array.isArray(promptsArr) || !promptsArr.length) continue;

    let lastActive = 0;
    const gensJson = sqlite3Query(dbPath, 'SELECT value FROM ItemTable WHERE key = \'aiService.generations\'');
    if (gensJson) {
      try {
        const gens = JSON.parse(gensJson) as Array<{ unixMs?: number }>;
        if (Array.isArray(gens) && gens.length) {
          lastActive = gens.reduce((max, g) => Math.max(max, typeof g.unixMs === 'number' ? g.unixMs : 0), 0);
        }
      } catch { /* ignore */ }
    }

    let stat: fs.Stats;
    try { stat = fs.statSync(dbPath); } catch { continue; }
    if (!lastActive) lastActive = stat.mtimeMs;

    const messages: SessionMessage[] = promptsArr
      .filter(p => typeof p.text === 'string' && p.text.trim().length > 0)
      .map(p => ({ role: 'user' as const, text: (p.text as string).trim() }));
    if (!messages.length) continue;

    results.push({
      id:          `${tool}-${hash}`,
      tool,
      projectPath,
      projectSlug: projectPath ? pathToLabel(projectPath) : hash.slice(0, 8),
      filePath:    dbPath,
      messages,
      startedAt:   stat.birthtimeMs ?? stat.ctimeMs,
      lastActive,
      title:       messages[0].text.split('\n')[0].slice(0, 80),
      tokenCount:  roughTokens(messages),
      isActive:    (Date.now() - lastActive) < 2 * 60 * 60 * 1000,
    });
  }
  return results.sort((a, b) => b.lastActive - a.lastActive);
}

export function readCursorSessions(workspacePath?: string): SessionInfo[] {
  return readVscdbSessions(cursorWorkspaceStoragePath(), 'cursor', workspacePath);
}

/** Windsurf — same VS Code-family state.vscdb layout as Cursor. EXPERIMENTAL:
 *  the exact prompt keys are unverified on this machine; degrades to [] if absent. */
export function readWindsurfSessions(workspacePath?: string): SessionInfo[] {
  return readVscdbSessions(vscFamilyWorkspaceStorage('Windsurf'), 'windsurf', workspacePath);
}

// ─── Cline / Roo Code reader ────────────────────────────────────────────────
// Both store one folder per task under a VS Code extension's globalStorage:
//   globalStorage/<extId>/tasks/<taskId>/api_conversation_history.json
// The history is an array of Anthropic-format messages ({role, content}).

function vscodeGlobalStoragePath(): string {
  const p = os.platform();
  if (p === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
  if (p === 'linux')  return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage');
  if (p === 'win32')  return path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage');
  return '';
}

/** Parse a Cline/Roo `api_conversation_history.json` (Anthropic message array). */
export function parseClineHistory(raw: string): SessionMessage[] {
  let arr: unknown;
  try { arr = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const messages: SessionMessage[] = [];
  for (const m of arr as Array<Record<string, unknown>>) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : null;
    if (!role) continue;
    const content = m.content;
    let text = '';
    let toolBytes = 0;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const raw2 of content as Array<Record<string, unknown>>) {
        if (!raw2 || typeof raw2 !== 'object') continue;
        if (raw2.type === 'text' && typeof raw2.text === 'string') text += raw2.text + '\n';
        else if (raw2.type === 'tool_use' && raw2.input) toolBytes += JSON.stringify(raw2.input).length;
        else if (raw2.type === 'tool_result') {
          const c = raw2.content;
          if (typeof c === 'string') toolBytes += c.length;
          else if (Array.isArray(c)) for (const t of c as Array<Record<string, unknown>>) {
            if (t && t.type === 'text' && typeof t.text === 'string') toolBytes += t.text.length;
          }
        }
      }
    }
    text = text.trim();
    if (!text) continue;
    messages.push({ role, text, ...(toolBytes > 0 ? { fullLength: text.length + toolBytes } : {}) });
  }
  return messages;
}

/** Best-effort cwd from a Cline/Roo task's injected environment_details, so the
 *  session can surface in project scope. Returns '' (global) if not present. */
function inferClineCwd(messages: SessionMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return '';
  const m = firstUser.text.match(/Current Working Directory\s*\(([^)]+)\)/i)
    ?? firstUser.text.match(/<cwd>\s*([^<\n]+?)\s*<\/cwd>/i);
  return m && m[1] ? m[1].trim() : '';
}

function readClineStyleSessions(extId: string, tool: AiTool, label: string): SessionInfo[] {
  const base = vscodeGlobalStoragePath();
  if (!base) return [];
  const tasksDir = path.join(base, extId, 'tasks');
  if (!fs.existsSync(tasksDir)) return [];

  const results: SessionInfo[] = [];
  let taskIds: string[];
  try { taskIds = fs.readdirSync(tasksDir); } catch { return []; }

  for (const taskId of taskIds) {
    const histFile = path.join(tasksDir, taskId, 'api_conversation_history.json');
    let stat: fs.Stats;
    try { stat = fs.statSync(histFile); } catch { continue; }
    let raw: string;
    try { raw = fs.readFileSync(histFile, 'utf-8'); } catch { continue; }
    const messages = parseClineHistory(raw);
    if (!messages.length) continue;

    const firstUser = messages.find(m => m.role === 'user');
    const startedAt = /^\d{10,}$/.test(taskId) ? Number(taskId) : (stat.birthtimeMs ?? stat.ctimeMs);
    // Infer cwd from environment_details so it can appear in project scope; '' = global.
    const projectPath = inferClineCwd(messages);
    results.push({
      id:          `${tool}-${taskId}`,
      tool,
      projectPath,
      projectSlug: projectPath ? pathToLabel(projectPath) : label,
      filePath:    histFile,
      messages,
      startedAt,
      lastActive:  stat.mtimeMs,
      title:       firstUser ? firstUser.text.split('\n')[0].slice(0, 80) : `(${label})`,
      tokenCount:  roughTokens(messages),
      isActive:    (Date.now() - stat.mtimeMs) < 2 * 60 * 60 * 1000,
    });
  }
  return results.sort((a, b) => b.lastActive - a.lastActive);
}

export function readClineSessions(): SessionInfo[] {
  return readClineStyleSessions('saoudrizwan.claude-dev', 'cline', 'Cline');
}
export function readRooSessions(): SessionInfo[] {
  return readClineStyleSessions('rooveterinaryinc.roo-cline', 'roo-code', 'Roo Code');
}

// ─── Gemini CLI reader (EXPERIMENTAL) ────────────────────────────────────────
// ~/.gemini/tmp/<hash>/chats/*.json — Gemini "content" format ({role, parts:[{text}]}).
// Format documented from public docs; verify on disk when available.

export function parseGeminiChat(raw: string): SessionMessage[] {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  const d = data as Record<string, unknown>;
  const arr: unknown = Array.isArray(data) ? data
    : Array.isArray(d.messages) ? d.messages
    : Array.isArray(d.history) ? d.history
    : [];
  const messages: SessionMessage[] = [];
  for (const m of arr as Array<Record<string, unknown>>) {
    if (!m || typeof m !== 'object') continue;
    const role = (m.role === 'model' || m.role === 'assistant') ? 'assistant'
      : m.role === 'user' ? 'user' : null;
    if (!role) continue;
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.parts)) text = (m.parts as Array<Record<string, unknown>>).map(p => typeof p?.text === 'string' ? p.text : '').join('');
    else if (typeof m.text === 'string') text = m.text;
    text = text.trim();
    if (!text) continue;
    messages.push({ role, text });
  }
  return messages;
}

export function readGeminiSessions(): SessionInfo[] {
  const root = path.join(os.homedir(), '.gemini', 'tmp');
  if (!fs.existsSync(root)) return [];
  const results: SessionInfo[] = [];
  let hashes: string[];
  try { hashes = fs.readdirSync(root); } catch { return []; }
  for (const hash of hashes) {
    const chatsDir = path.join(root, hash, 'chats');
    let files: string[];
    try { files = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      const fp = path.join(chatsDir, f);
      let stat: fs.Stats;
      try { stat = fs.statSync(fp); } catch { continue; }
      let raw: string;
      try { raw = fs.readFileSync(fp, 'utf-8'); } catch { continue; }
      const messages = parseGeminiChat(raw);
      if (!messages.length) continue;
      const firstUser = messages.find(m => m.role === 'user');
      results.push({
        id:          `gemini-cli-${hash}-${f.replace('.json', '')}`,
        tool:        'gemini-cli',
        projectPath: '',
        projectSlug: 'Gemini CLI',
        filePath:    fp,
        messages,
        startedAt:   stat.birthtimeMs ?? stat.ctimeMs,
        lastActive:  stat.mtimeMs,
        title:       firstUser ? firstUser.text.split('\n')[0].slice(0, 80) : '(gemini)',
        tokenCount:  roughTokens(messages),
        isActive:    (Date.now() - stat.mtimeMs) < 2 * 60 * 60 * 1000,
      });
    }
  }
  return results.sort((a, b) => b.lastActive - a.lastActive);
}

// ─── Aider reader ────────────────────────────────────────────────────────────

export function readAiderSession(workspacePath: string): SessionInfo | null {
  const filePath = path.join(workspacePath, '.aider.chat.history.md');
  if (!fs.existsSync(filePath)) return null;

  let raw: string;
  try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { return null; }

  const messages: SessionMessage[] = [];
  let current: { role: 'user' | 'assistant'; lines: string[] } | null = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith('#### /')) {
      if (current) messages.push({ role: current.role, text: current.lines.join('\n').trim() });
      current = { role: 'user', lines: [line.slice(6)] };
    } else if (line.startsWith('# aider:')) {
      if (current) messages.push({ role: current.role, text: current.lines.join('\n').trim() });
      current = { role: 'assistant', lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) messages.push({ role: current.role, text: current.lines.join('\n').trim() });

  const filtered = messages.filter(m => m.text.length > 0);
  if (!filtered.length) return null;

  const stat = fs.statSync(filePath);
  const firstUser = filtered.find(m => m.role === 'user');
  return {
    id:          'aider-' + path.basename(workspacePath),
    tool:        'aider',
    projectPath: workspacePath,
    projectSlug: pathToLabel(workspacePath),
    filePath,
    messages:    filtered,
    startedAt:   stat.birthtimeMs ?? stat.ctimeMs,
    lastActive:  stat.mtimeMs,
    title:       firstUser ? firstUser.text.slice(0, 80) : '(aider session)',
    tokenCount:  roughTokens(filtered),
    isActive:    (Date.now() - stat.mtimeMs) < 2 * 60 * 60 * 1000,
  };
}

// ─── Augment Code reader ─────────────────────────────────────────────────────
//
// Augment stores chat history per-workspace as a LevelDB key-value store under:
//   ~/Library/Application Support/Code/User/workspaceStorage/<hash>/
//       Augment.vscode-augment/augment-kv-store/
//
// Each record in the WAL (.log) is a JSON object.  Records are grouped by
// conversationId; user turns have request_message, assistant turns have
// response_text.  We also surface input/output token counts from billing records.

const AUGMENT_VS_STORAGE = path.join(
  os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage',
);

/** Extract parseable JSON objects from a LevelDB WAL (.log) file.
 *
 *  Performance strategy: LevelDB WAL is append-only, so the newest records
 *  are always at the END of the file.  We only read the last MAX_TAIL_BYTES
 *  to avoid stalling the extension host on 10–20 MB log files.  We start
 *  scanning from the first complete '{' after the truncation point so we
 *  never parse a partial record.
 */
const AUGMENT_MAX_TAIL_BYTES = 1_500_000; // 1.5 MB — covers hundreds of turns (sidebar load)

/**
 * Extract parseable JSON objects from a LevelDB WAL (.log) file.
 *
 * @param maxBytes   When provided, only reads the last N bytes of the file
 *                   (fast path for the sidebar — newest records are at the tail).
 *                   Omit (or pass undefined) for a full read — used at handoff
 *                   time so no tool calls are missed.
 * @param filterKey  Only return records that have this key set.
 *                   Defaults to 'conversationId' (chat messages).
 *                   Pass 'tool_name' to extract tool-call records instead.
 */
function extractJsonRecords(
  filePath: string,
  maxBytes?: number,
  filterKey = 'conversationId',
): Record<string, unknown>[] {
  let buf: Buffer;
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    if (size === 0) return [];
    if (maxBytes && size > maxBytes) {
      // Tail read — fast path for sidebar
      const fd     = fs.openSync(filePath, 'r');
      const offset = size - maxBytes;
      buf = Buffer.alloc(maxBytes);
      fs.readSync(fd, buf, 0, maxBytes, offset);
      fs.closeSync(fd);
    } else {
      // Full read — used at handoff time, or when the file is small enough
      buf = fs.readFileSync(filePath);
    }
  } catch { return []; }

  // Convert to a latin1 string so byte offsets map 1-to-1 to string indices.
  // We re-encode each candidate slice to UTF-8 before JSON.parse.
  const text = buf.toString('binary');
  const out: Record<string, unknown>[] = [];
  let i = 0;

  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start < 0) break;

    // Walk forward matching braces.  Skip strings (naive — good enough for WAL).
    let depth = 0;
    let j = start;
    let inStr = false;
    while (j < text.length) {
      const ch = text[j];
      if (inStr) {
        if (ch === '\\') { j++; }          // skip escaped char
        else if (ch === '"') { inStr = false; }
      } else {
        if      (ch === '"') { inStr = true; }
        else if (ch === '{') { depth++; }
        else if (ch === '}') { depth--; if (depth === 0) { j++; break; } }
      }
      j++;
    }

    if (depth === 0) {
      try {
        const slice = buf.slice(start, j).toString('utf-8');
        const obj   = JSON.parse(slice) as Record<string, unknown>;
        if (obj[filterKey] !== undefined) out.push(obj);
      } catch { /* skip malformed */ }
    }
    i = start + 1;
  }
  return out;
}

export function readAugmentSessions(workspacePath?: string): SessionInfo[] {
  if (!fs.existsSync(AUGMENT_VS_STORAGE)) return [];

  let hashDirs: string[];
  try { hashDirs = fs.readdirSync(AUGMENT_VS_STORAGE); } catch { return []; }

  const sessions: SessionInfo[] = [];

  for (const hash of hashDirs) {
    const augDir = path.join(AUGMENT_VS_STORAGE, hash, 'Augment.vscode-augment', 'augment-kv-store');
    if (!fs.existsSync(augDir)) continue;

    // Resolve the workspace root via workspace.json (same pattern as Cursor reader)
    let wsFolder = '';
    try {
      const wsJson = JSON.parse(fs.readFileSync(
        path.join(AUGMENT_VS_STORAGE, hash, 'workspace.json'), 'utf-8',
      ) as string) as { folder?: string };
      wsFolder = decodeURIComponent((wsJson.folder ?? '').replace(/^file:\/\//, ''));
    } catch { /* workspace.json may not exist for multi-root workspaces */ }

    // Apply workspace filter
    if (workspacePath && wsFolder !== workspacePath) continue;

    // Read all .log WAL files in the kv-store directory
    // Pass AUGMENT_MAX_TAIL_BYTES so each file is tail-read (fast sidebar load).
    let logFiles: string[];
    try { logFiles = fs.readdirSync(augDir).filter(f => f.endsWith('.log')); } catch { continue; }

    const allRecords: Record<string, unknown>[] = [];
    for (const lf of logFiles) {
      allRecords.push(...extractJsonRecords(path.join(augDir, lf), AUGMENT_MAX_TAIL_BYTES));
    }

    // Group records by conversationId
    const byConv = new Map<string, Record<string, unknown>[]>();
    for (const rec of allRecords) {
      const cid = rec['conversationId'] as string | undefined;
      if (!cid) continue;
      if (!byConv.has(cid)) byConv.set(cid, []);
      byConv.get(cid)!.push(rec);
    }

    for (const [cid, recs] of byConv) {
      const messages: SessionMessage[] = [];
      let totalTokens = 0;
      let latestTs = 0;
      let earliestTs = Infinity;
      let folderRoot = wsFolder;
      let modelId = '';

      // Process records in chronological order
      const sorted = [...recs].sort((a, b) => {
        const ta = a['timestamp_ms'] as number ?? Date.parse((a['timestamp'] as string) ?? '') ?? 0;
        const tb = b['timestamp_ms'] as number ?? Date.parse((b['timestamp'] as string) ?? '') ?? 0;
        return ta - tb;
      });

      for (const r of sorted) {
        const ts = r['timestamp_ms'] as number | undefined
          ?? (r['timestamp'] ? Date.parse(r['timestamp'] as string) : undefined)
          ?? 0;
        if (ts > latestTs) latestTs = ts;
        if (ts > 0 && ts < earliestTs) earliestTs = ts;

        if (r['folder_root']) folderRoot = r['folder_root'] as string;
        if (r['model_id']) modelId = r['model_id'] as string;

        const userText = r['request_message'] as string | undefined;
        if (userText?.trim()) messages.push({ role: 'user', text: userText.trim(), ts });

        const assistText = r['response_text'] as string | undefined;
        if (assistText?.trim()) messages.push({ role: 'assistant', text: assistText.trim(), ts });

        // Accumulate token usage from billing records
        const inTok  = r['input_tokens']  as number | undefined;
        const outTok = r['output_tokens'] as number | undefined;
        if (inTok !== undefined) totalTokens += inTok;
        if (outTok !== undefined) totalTokens += outTok;
      }

      if (!messages.length) continue;

      const firstUser = messages.find(m => m.role === 'user');
      const title = (firstUser?.text ?? '(augment session)').split('\n')[0].slice(0, 80);
      const effectivePath = folderRoot || wsFolder;

      sessions.push({
        id:          'augment-' + cid,
        tool:        'augment',
        projectPath: effectivePath,
        projectSlug: pathToLabel(effectivePath),
        filePath:    augDir,
        messages,
        startedAt:   earliestTs === Infinity ? latestTs : earliestTs,
        lastActive:  latestTs,
        title,
        tokenCount:  totalTokens > 0 ? totalTokens : roughTokens(messages),
        isActive:    (Date.now() - latestTs) < 2 * 60 * 60 * 1000,
      });
    }
  }

  return sessions;
}

// ─── Combined reader ──────────────────────────────────────────────────────────

/**
 * Read all sessions across all supported tools.
 *
 * @param workspacePath  Filter to a single workspace root (used by the preview-panel).
 *                       When omitted, all sessions from all projects are returned.
 * @param aiderPaths     Extra workspace paths to scan for .aider.chat.history.md.
 *                       Required when workspacePath is omitted so Aider sessions
 *                       still surface in the Context Bridge sidebar.
 */
function safeRead<T>(label: string, fn: () => T[]): T[] {
  try { return fn(); } catch (e) {
    console.error(`[Markr] ${label} reader failed:`, e);
    return [];
  }
}

/** Per-tool health for the sidebar's tool-health row — no silent failures.
 *  'experimental' = the tool is installed but Markr's reader for it is unverified
 *  (distinguishes "can't read yet" from a genuine "no sessions"). */
export type ToolHealthStatus = 'ok' | 'none' | 'error' | 'experimental';
export interface ToolHealth { tool: AiTool; status: ToolHealthStatus; count: number; }

/** Run one tool reader, capturing its session count or failure for the health row. */
function readWithHealth(
  tool: AiTool, health: ToolHealth[], fn: () => SessionInfo[],
): SessionInfo[] {
  try {
    const r = fn();
    health.push({ tool, status: r.length ? 'ok' : 'none', count: r.length });
    return r;
  } catch (e) {
    console.error(`[Markr] ${tool} reader failed:`, e);
    health.push({ tool, status: 'error', count: 0 });
    return [];
  }
}

/** Read all sessions plus per-tool health. */
export function readAllSessionsWithHealth(
  workspacePath?: string, aiderPaths?: string[],
): { sessions: SessionInfo[]; health: ToolHealth[] } {
  const health: ToolHealth[] = [];
  const sessions: SessionInfo[] = [
    ...readWithHealth('claude-code', health, () => readClaudeCodeSessions(workspacePath, aiderPaths)),
    ...readWithHealth('codex',       health, () => readCodexSessions(workspacePath)),
    ...readWithHealth('cursor',      health, () => readCursorSessions(workspacePath)),
    ...readWithHealth('augment',     health, () => readAugmentSessions(workspacePath)),
    ...readWithHealth('cline',       health, () => readClineSessions()),
    ...readWithHealth('roo-code',    health, () => readRooSessions()),
    ...readWithHealth('windsurf',    health, () => readWindsurfSessions(workspacePath)),
    ...readWithHealth('gemini-cli',  health, () => readGeminiSessions()),
  ];

  // Windsurf reader is experimental (prompt schema unverified). If Windsurf is
  // installed but we found nothing, surface "experimental" — not a clean "none" —
  // so the user can tell "can't read yet" from "genuinely empty".
  try {
    const wsHealth = health.find(h => h.tool === 'windsurf');
    if (wsHealth && wsHealth.status === 'none' && fs.existsSync(vscFamilyWorkspaceStorage('Windsurf'))) {
      wsHealth.status = 'experimental';
    }
  } catch { /* ignore */ }

  // Aider: scan the specified workspace, or every path in aiderPaths.
  const pathsForAider: string[] = workspacePath ? [workspacePath] : (aiderPaths ?? []);
  let aiderCount = 0; let aiderErr = false;
  for (const p of pathsForAider) {
    try {
      const aider = readAiderSession(p);
      if (aider) { sessions.push(aider); aiderCount++; }
    } catch { aiderErr = true; }
  }
  health.push({ tool: 'aider', status: aiderErr ? 'error' : aiderCount ? 'ok' : 'none', count: aiderCount });

  sessions.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return b.lastActive - a.lastActive;
  });
  return { sessions, health };
}

export function readAllSessions(workspacePath?: string, aiderPaths?: string[]): SessionInfo[] {
  return readAllSessionsWithHealth(workspacePath, aiderPaths).sessions;
}

// ─── Tool-activity extractors ─────────────────────────────────────────────────
//
// Called ONLY at handoff-generation time, never on sidebar load.
// Each re-reads the session storage to get accurate file + command lists.

interface ToolActivity {
  filesModified: string[];
  filesRead:     string[];
  commandsRun:   string[];
}

const EMPTY_ACTIVITY: ToolActivity = { filesModified: [], filesRead: [], commandsRun: [] };

function uniqueFirst(items: string[], limit: number): string[] {
  return [...new Set(items.map(i => i.trim()).filter(Boolean))].slice(0, limit);
}

function collectPatchFiles(patchText: string): string[] {
  const files: string[] = [];
  for (const line of patchText.split('\n')) {
    const m = line.match(/^\*{3}\s+(?:Update|Add|Create|Delete)\s+File:\s*(.+)/i);
    if (m?.[1]) files.push(m[1].trim());
  }
  return files;
}

function collectPathLikeValues(value: unknown, out: string[]): void {
  if (!value) return;
  if (typeof value === 'string') {
    if (/^\/|^[A-Za-z0-9_.-]+\/|^[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$/.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(v => collectPathLikeValues(v, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/file|path|uri/i.test(key)) collectPathLikeValues(child, out);
      else if (typeof child === 'object') collectPathLikeValues(child, out);
    }
  }
}

function commandLooksLikeVerification(command: string): boolean {
  return /\b(test|check|lint|build|typecheck|tsc|vitest|jest|mocha|pytest|cargo test|go test|npm run|pnpm|yarn)\b/i.test(command);
}

// ── Claude Code — reads full JSONL for Write/Edit/Bash tool_use blocks ────────
function extractClaudeActivity(filePath: string): ToolActivity {
  const modifiedSet = new Set<string>();
  const readSet     = new Set<string>();
  const commands:     string[] = [];

  let raw: string;
  try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { return EMPTY_ACTIVITY; }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'assistant') continue;

    const content = (d.message as Record<string, unknown> | undefined)?.content;
    if (!Array.isArray(content)) continue;

    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue;
      const c = item as Record<string, unknown>;
      if (c.type !== 'tool_use') continue;
      const inp = c.input as Record<string, unknown> | undefined;
      if (!inp) continue;

      const name = String(c.name ?? '');
      if (name === 'Write' || name === 'Edit') {
        const fp = inp.file_path ?? inp.path ?? inp.filePath;
        if (typeof fp === 'string' && fp) modifiedSet.add(fp);
      } else if (name === 'Read') {
        const fp = inp.file_path ?? inp.path ?? inp.filePath;
        if (typeof fp === 'string' && fp) readSet.add(fp);
      } else if (name === 'Bash') {
        const cmd = inp.command ?? inp.cmd;
        if (typeof cmd === 'string' && cmd && commands.length < 12) {
          const first = cmd.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) ?? '';
          if (first) commands.push(first.slice(0, 120));
        }
      }
    }
  }

  return {
    filesModified: [...modifiedSet],
    filesRead:     [...readSet].filter(f => !modifiedSet.has(f)),
    commandsRun:   commands,
  };
}

// ── Codex — reads function_call items from JSONL transcripts ─────────────────
function extractCodexActivity(filePath: string): ToolActivity {
  const modifiedSet = new Set<string>();
  const readSet     = new Set<string>();
  const commands: string[] = [];

  let raw: string;
  try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { return EMPTY_ACTIVITY; }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try { d = JSON.parse(line); } catch { continue; }

    const payload = d.payload as Record<string, unknown> | undefined;
    if (!payload || d.type !== 'response_item') continue;
    if (payload.type !== 'function_call') continue;

    const name = String(payload.name ?? '');
    let args: Record<string, unknown> = {};
    try {
      const rawArgs = payload.arguments;
      args = (typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs) as Record<string, unknown>;
    } catch { /* keep empty args */ }

    if (name === 'apply_patch') {
      const patchText = String(args.input ?? args.patch ?? '');
      collectPatchFiles(patchText).forEach(f => modifiedSet.add(f));
      continue;
    }

    if (name === 'exec_command' || name === 'shell' || name === 'run_command') {
      const cmd = String(args.cmd ?? args.command ?? '').trim();
      if (cmd) {
        const first = cmd.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) ?? '';
        if (first) commands.push(first.slice(0, 160));
      }
      continue;
    }

    const paths: string[] = [];
    collectPathLikeValues(args, paths);
    const isWriteTool = /write|edit|patch|save|create|delete/i.test(name);
    const isReadTool  = /read|view|open|search|find|rg|grep|list/i.test(name);
    for (const p of paths) {
      if (isWriteTool) modifiedSet.add(p);
      else if (isReadTool) readSet.add(p);
    }
  }

  return {
    filesModified: uniqueFirst([...modifiedSet], 20),
    filesRead:     uniqueFirst([...readSet].filter(f => !modifiedSet.has(f)), 10),
    commandsRun:   uniqueFirst(commands, 12),
  };
}

// ── Augment — reads LevelDB WAL+SSTable for apply_patch / launch-process / view ─
//
// apply_patch    → input_json.input  contains "*** Update File: <path>" diffs
// launch-process → input_json.command
// view           → input_json.path  (files read/explored)
//
// Tool records use the key "tool_name" (NOT "conversationId"), so we must pass
// filterKey='tool_name' to extractJsonRecords.  Chat-message records use
// "conversationId" — a completely separate schema — which is why the sidebar
// reader never found any tool activity before this fix.
//
// We also scan both .log (WAL — live/recent) and .ldb (SSTable — compacted/older)
// files so we don't miss patches that were flushed before the session ended.
function extractAugmentActivity(augDir: string): ToolActivity {
  const modifiedSet = new Set<string>();
  const readSet     = new Set<string>();
  const commands:     string[] = [];

  let allFiles: string[];
  try {
    allFiles = fs.readdirSync(augDir).filter(f => f.endsWith('.log') || f.endsWith('.ldb'));
  } catch { return EMPTY_ACTIVITY; }

  for (const lf of allFiles) {
    // No maxBytes — full read so we capture apply_patch calls from anywhere
    // in the history.  filterKey='tool_name' so tool records (not chat records)
    // are returned — this was the core bug: tool records have no conversationId.
    const records = extractJsonRecords(path.join(augDir, lf), undefined, 'tool_name');
    for (const r of records) {
      // Skip streaming partial chunks — only process completed tool calls
      if (r['is_partial'] === true) continue;

      const toolName = String(r['tool_name']);
      let inp: Record<string, unknown> = {};
      try {
        const raw = r['input_json'];
        inp = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
      } catch { continue; }

      if (toolName === 'apply_patch') {
        // Patch content: "*** Update File: path/to/file\n..."
        const patchText = String(inp['input'] ?? '');
        collectPatchFiles(patchText).forEach(f => modifiedSet.add(f));
      } else if (toolName === 'launch-process') {
        const cmd = String(inp['command'] ?? '').trim();
        if (cmd && commands.length < 12) {
          const first = cmd.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) ?? '';
          if (first) commands.push(first.slice(0, 120));
        }
      } else if (toolName === 'view') {
        const fp = String(inp['path'] ?? '').trim();
        if (fp) readSet.add(fp);
      }
    }
  }

  return {
    filesModified: uniqueFirst([...modifiedSet], 20),
    filesRead:     uniqueFirst([...readSet].filter(f => !modifiedSet.has(f)), 10),
    commandsRun:   uniqueFirst(commands, 12),
  };
}

// ─── CRH: decision-graph + in-flight delta extraction ──────────────────────────
//
// The handoff's job is NOT to transmit the codebase — the receiving agent can
// read the repo (Slepian-Wolf: side information at the decoder).  Its job is to
// transmit the *residual*: what the repo can't tell you.  That residual is:
//   • decisions + their rationale   (why, not just what)
//   • failed approaches / dead-ends  (literally nowhere in the repo)
//   • hard constraints the user set
//   • the uncommitted in-flight diff  (the redo log on top of HEAD)
// These four are mined here, at handoff time, from the FULL transcript + git.

// For decision mining we read a generous head (task) + tail (recent reasoning).
// 3 MB of tail covers hundreds of turns while staying fast on 90 MB sessions.
const DECISION_SCAN_HEAD = 20_000;
const DECISION_SCAN_TAIL = 3_000_000;

function readHeadTail(filePath: string, headBytes: number, tailBytes: number): string {
  try {
    const size = fs.statSync(filePath).size;
    if (size <= headBytes + tailBytes) return fs.readFileSync(filePath, 'utf-8');
    const fd = fs.openSync(filePath, 'r');
    try {
      const hb = Buffer.alloc(headBytes);
      const tb = Buffer.alloc(tailBytes);
      fs.readSync(fd, hb, 0, headBytes, 0);
      fs.readSync(fd, tb, 0, tailBytes, size - tailBytes);
      return hb.toString('utf-8') + '\n' + tb.toString('utf-8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

/** Pull every assistant + user prose block from the full transcript. */
function gatherProse(session: SessionInfo): { assistant: string[]; user: string[] } {
  const assistant: string[] = [];
  const user:      string[] = [];

  try {
    if (session.tool === 'claude-code') {
      const raw = readHeadTail(session.filePath, DECISION_SCAN_HEAD, DECISION_SCAN_TAIL);
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let d: Record<string, unknown>;
        try { d = JSON.parse(line); } catch { continue; }
        if (d.type !== 'user' && d.type !== 'assistant') continue;
        const content = (d.message as Record<string, unknown> | undefined)?.content;
        let text = '';
        if (Array.isArray(content)) {
          for (const c of content) {
            if (typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'text') {
              text += String((c as Record<string, unknown>).text ?? '') + '\n';
            }
          }
        } else if (typeof content === 'string') { text = content; }
        text = text.trim();
        if (text) (d.type === 'assistant' ? assistant : user).push(text);
      }
    } else if (session.tool === 'codex') {
      const raw = readHeadTail(session.filePath, DECISION_SCAN_HEAD, DECISION_SCAN_TAIL);
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let d: Record<string, unknown>;
        try { d = JSON.parse(line); } catch { continue; }
        const payload = d.payload as Record<string, unknown> | undefined;
        if (!payload || payload.type !== 'message') continue;
        if (d.type !== 'response_item' && d.type !== 'response_output_item') continue;
        const role = String(payload.role ?? '');
        if (role !== 'user' && role !== 'assistant') continue;
        const content = payload.content;
        let text = '';
        if (Array.isArray(content)) {
          text = (content as Record<string, unknown>[])
            .map(c => typeof c.text === 'string' ? c.text
              : typeof c.output_text === 'string' ? c.output_text : '')
            .join('\n');
        } else if (typeof content === 'string') { text = content; }
        text = text.trim();
        if (text && !text.startsWith('<')) (role === 'assistant' ? assistant : user).push(text);
      }
    } else if (session.tool === 'augment') {
      let files: string[] = [];
      try { files = fs.readdirSync(session.filePath).filter(f => f.endsWith('.log') || f.endsWith('.ldb')); } catch { /* ignore */ }
      for (const lf of files) {
        for (const r of extractJsonRecords(path.join(session.filePath, lf), undefined, 'conversationId')) {
          const u = r['request_message']; if (typeof u === 'string' && u.trim()) user.push(u.trim());
          const a = r['response_text'];   if (typeof a === 'string' && a.trim()) assistant.push(a.trim());
        }
      }
    } else {
      for (const m of session.messages) (m.role === 'assistant' ? assistant : user).push(m.text);
    }
  } catch { /* best-effort */ }

  // Fallback — if the file read surfaced nothing, use the already-parsed messages
  if (!assistant.length && !user.length) {
    for (const m of session.messages) (m.role === 'assistant' ? assistant : user).push(m.text);
  }
  return { assistant, user };
}

// Split prose into sentences, stripping code fences (we mine reasoning, not code).
export function splitSentences(text: string): string[] {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 12);
}

// Sentences that look like pasted content (review-bot output, logs, file refs)
// rather than genuine prose — rejected so they don't pollute mined results
// (e.g. a pasted "Medium: src/foo.ts (line 17)…" line being read as a constraint).
const PASTED_RE = /\(line \d+\)|\b[\w./-]+\.(?:ts|tsx|js|jsx|py|sql|md|json|ya?ml|css|html)\b\s*[:#]?\d|^(?:medium|high|low|critical|info|warning|error|note|todo|p[0-3])\s*[:\-]/i;

export function mineByRegex(texts: string[], re: RegExp, cap: number, reject?: RegExp): string[] {
  const out:  string[]     = [];
  const seen: Set<string>  = new Set();
  for (const t of texts) {
    for (const s of splitSentences(t)) {
      if (!re.test(s)) continue;
      if (reject && reject.test(s)) continue;
      const key = s.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s.length > 240 ? s.slice(0, 239) + '…' : s);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

// Decision/rationale signals — "why" language.
export const DECISION_RE  = /\b(because|since|the (?:issue|problem|root cause|reason|fix|bug)\b|instead of|rather than|decided|chose|choosing|opted|going with|switched to|turns out|that's why|this is why|so that|to avoid|in order to|the trade-?off)\b/i;
// Failed-approach signals — dead-ends the receiver must not retry.  Widened to
// cover the common ways an agent reports a dead-end ("rolled back", "couldn't
// get X to work", "doesn't compile", "abandoned", "gave up", "regression").
export const FAIL_RE      = /\b(did ?n['’]?t work|does ?n['’]?t work|(?:does|did) not (?:work|compile|build|help)|not working|not compile|failed|fails|failing|revert(?:ed|ing)?|rolled? back|undo(?:ne)?|wo ?n['’]?t work|could ?n['’]?t (?:get|make)|ca ?n['’]?t get|broke|broken|does ?n['’]?t compile|compile error|that was wrong|my mistake|scratch that|abandon(?:ed|ing)?|gave up|no longer (?:needed|works)|did(?:n['’]?t| not) help|does ?n['’]?t help|wrong approach|incorrect approach|regression|tried .* but)\b/i;
// Hard-constraint signals stated by the user.
export const CONSTRAINT_RE = /\b(must(?: not)?|should not|do not|don['’]?t|never|always|make sure|ensure|required|has to|needs? to|important:)\b/i;
// Re-export for the constraint reject filter.
export const PASTED_CONTENT_RE = PASTED_RE;

/** Capture the uncommitted in-flight state — the redo log on top of HEAD.
 *  This is the one thing reading the repo at HEAD can NOT show the receiver. */
function captureGitState(projectPath: string): { branch: string; dirtyFiles: string[]; diffStat: string } {
  const empty = { branch: '', dirtyFiles: [] as string[], diffStat: '' };
  if (!projectPath) return empty;
  try { if (!fs.statSync(projectPath).isDirectory()) return empty; } catch { return empty; }

  const run = (cmd: string): string => {
    try {
      return cp.execSync(cmd, { cwd: projectPath, timeout: 2_500, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
    } catch { return ''; }
  };

  const branch = run('git rev-parse --abbrev-ref HEAD');
  if (!branch) return empty; // not a git repo (or git unavailable)
  const status = run('git status --porcelain');
  const dirtyFiles = status.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 40);
  const diffStat = run('git diff --stat HEAD').slice(0, 2_000);
  return { branch, dirtyFiles, diffStat };
}

// ─── Session summariser ───────────────────────────────────────────────────────

/** Shape consumed by generateHandoff. */
export interface SessionContext {
  task:            string;    // first user message — the goal
  lastUserMsg:     string;    // most recent user message verbatim
  lastAssistMsg:   string;    // most recent assistant message verbatim
  recentMessages:  Array<{ role: 'user' | 'assistant'; text: string }>;
  filesModified:   string[];
  filesRead:       string[];
  commandsRun:     string[];
  nextSteps:       string[];
  lastVerifiedCommand: string;
  projectPath:     string;
  projectSlug:     string;
  model:           string;
  messageCount:    number;
  tokenCount:      number;

  // ── CRH (Conditional Residual Handoff) fields ──────────────────────────────
  // The irreducible residual: things the receiver CANNOT re-derive by reading
  // the repo, so they must be transmitted in full.  (Re-derivable state — file
  // contents, current code shape — is emitted as pointers instead.)
  decisions:        string[];  // decisions + rationale mined from assistant prose
  failedApproaches: string[];  // dead-ends — "don't retry X"; pure residual
  constraints:      string[];  // hard requirements stated by the user
  gitBranch:        string;    // in-flight checkpoint: current branch
  gitDirtyFiles:    string[];  // uncommitted changes (the redo log)
  gitDiffStat:      string;    // `git diff --stat HEAD` summary
}

function inferNextSteps(ctx: {
  lastUserMsg: string;
  lastAssistMsg: string;
  filesModified: string[];
  commandsRun: string[];
}): string[] {
  const steps: string[] = [];
  const lastAssistant = ctx.lastAssistMsg.trim();
  const explicit = lastAssistant.match(/(?:next steps?|todo|remaining|follow[- ]?up)[:\n]([\s\S]{0,700})/i)?.[1] ?? '';

  for (const line of explicit.split('\n')) {
    const cleaned = line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim();
    if (cleaned.length > 12) steps.push(cleaned.slice(0, 180));
    if (steps.length >= 3) break;
  }

  if (!steps.length && ctx.filesModified.length) {
    steps.push(`Inspect the current diff for ${ctx.filesModified.slice(0, 4).join(', ')} and continue from the latest changes.`);
  }

  if (!ctx.commandsRun.some(commandLooksLikeVerification)) {
    steps.push('Run the relevant build, lint, or test command before calling the handoff complete.');
  }

  steps.push('Preserve existing user changes and avoid reverting unrelated work.');
  return uniqueFirst(steps, 4);
}

/**
 * Mine a session's CRH residuals (decisions / dead-ends / constraints) without
 * the git capture or activity extraction summariseSession does. Used by the
 * background memory scan so it stays cheap and never blocks the sidebar.
 */
/** Concatenated assistant + user prose for a session (for dead-rule detection). */
export function gatherSessionText(session: SessionInfo): string {
  try {
    const p = gatherProse(session);
    return [...p.assistant, ...p.user].join('\n');
  } catch {
    return '';
  }
}

export function mineSessionResiduals(session: SessionInfo): { decisions: string[]; deadEnds: string[]; constraints: string[] } {
  try {
    const prose = gatherProse(session);
    return {
      decisions:   mineByRegex(prose.assistant, DECISION_RE, 8, PASTED_RE),
      deadEnds:    mineByRegex(prose.assistant, FAIL_RE, 5, PASTED_RE),
      constraints: mineByRegex(prose.user, CONSTRAINT_RE, 6, PASTED_RE),
    };
  } catch {
    return { decisions: [], deadEnds: [], constraints: [] };
  }
}

/**
 * @param seed  Persisted residuals from earlier sessions of the same project.
 *              Merged into the handoff's dead-ends/constraints, tagged
 *              "(from earlier sessions)", so continuity survives across sessions.
 */
export function summariseSession(
  session: SessionInfo,
  seed?: { deadEnds?: string[]; constraints?: string[] },
): SessionContext {
  const userMsgs   = session.messages.filter(m => m.role === 'user');
  const assistMsgs = session.messages.filter(m => m.role === 'assistant');

  // First non-empty user message = the original task
  const task = userMsgs.find(m => m.text.trim())?.text.slice(0, 400) ?? '(unknown task)';

  // Last exchange — verbatim
  const lastUserMsg   = userMsgs[userMsgs.length   - 1]?.text ?? '';
  const lastAssistMsg = assistMsgs[assistMsgs.length - 1]?.text ?? '';

  // Last 10 messages for inline context (more than before so the receiver has
  // enough conversation to understand what's happening)
  const recentMessages = session.messages
    .slice(-10)
    .map(m => ({ role: m.role, text: m.text.slice(0, 1000) }));

  // Extract real file/command activity per tool
  let filesModified: string[] = [];
  let filesRead:     string[] = [];
  let commandsRun:   string[] = [];

  try {
    if (session.tool === 'claude-code') {
      const act  = extractClaudeActivity(session.filePath);
      filesModified = act.filesModified.slice(0, 20);
      filesRead     = act.filesRead.slice(0, 10);
      commandsRun   = act.commandsRun.slice(0, 12);
    } else if (session.tool === 'codex') {
      const act  = extractCodexActivity(session.filePath);
      filesModified = act.filesModified.slice(0, 20);
      filesRead     = act.filesRead.slice(0, 10);
      commandsRun   = act.commandsRun.slice(0, 12);
    } else if (session.tool === 'augment') {
      // session.filePath for Augment is the augment-kv-store directory
      const act  = extractAugmentActivity(session.filePath);
      filesModified = act.filesModified.slice(0, 20);
      filesRead     = act.filesRead.slice(0, 10);
      commandsRun   = act.commandsRun.slice(0, 12);
    }
  } catch { /* activity extraction is best-effort */ }

  const MODEL_LABELS: Record<AiTool, string> = {
    'claude-code': 'Claude Code', codex: 'Codex/GPT-4o',
    aider: 'Aider', cursor: 'Cursor', augment: 'Augment',
    cline: 'Cline', 'roo-code': 'Roo Code', windsurf: 'Windsurf', 'gemini-cli': 'Gemini CLI',
  };

  // ── CRH residual extraction (handoff-time only — full transcript + git) ──────
  const mined = mineSessionResiduals(session);
  const decisions        = mined.decisions;
  const failedApproaches = mined.deadEnds;
  const constraints      = mined.constraints;

  // Seed from persisted memory of earlier sessions in this project.
  const mergeSeed = (target: string[], extra: string[] | undefined, cap: number) => {
    for (const s of extra ?? []) {
      if (target.length >= cap) break;
      const key = s.toLowerCase().slice(0, 40);
      if (!target.some(x => x.toLowerCase().includes(key))) {
        target.push(`${s} (from earlier sessions)`);
      }
    }
  };
  mergeSeed(failedApproaches, seed?.deadEnds, 10);
  mergeSeed(constraints, seed?.constraints, 10);

  let gitBranch = '';
  let gitDirtyFiles: string[] = [];
  let gitDiffStat = '';
  try {
    const git = captureGitState(session.projectPath);
    gitBranch     = git.branch;
    gitDirtyFiles = git.dirtyFiles;
    gitDiffStat   = git.diffStat;
  } catch { /* git capture is best-effort */ }

  return {
    task,
    lastUserMsg:    lastUserMsg.slice(0, 800),
    lastAssistMsg:  lastAssistMsg.slice(0, 1500),
    recentMessages,
    filesModified,
    filesRead,
    commandsRun,
    nextSteps: inferNextSteps({ lastUserMsg, lastAssistMsg, filesModified, commandsRun }),
    lastVerifiedCommand: [...commandsRun].reverse().find(commandLooksLikeVerification) ?? '',
    projectPath: session.projectPath,
    projectSlug: session.projectSlug,
    model:        MODEL_LABELS[session.tool] ?? session.tool,
    messageCount: session.messages.length,
    tokenCount:   session.tokenCount,
    decisions,
    failedApproaches,
    constraints,
    gitBranch,
    gitDirtyFiles,
    gitDiffStat,
  };
}

// ─── Handoff document generator ───────────────────────────────────────────────

export type TargetTool = 'claude-code' | 'cursor' | 'codex' | 'chatgpt' | 'augment' | 'clipboard';

const TOOL_LABELS: Record<AiTool, string> = {
  'claude-code': 'Claude Code', codex: 'Codex CLI',
  aider: 'Aider', cursor: 'Cursor', augment: 'Augment',
  cline: 'Cline', 'roo-code': 'Roo Code', windsurf: 'Windsurf', 'gemini-cli': 'Gemini CLI',
};

function fmtTokHandoff(n: number): string {
  return n < 1_000 ? `${n}` : n < 1_000_000 ? `${(n / 1_000).toFixed(1)}K` : `${(n / 1_000_000).toFixed(1)}M`;
}

function fenceSafe(text: string): string {
  return text.replace(/```/g, "'''");
}

function bulletList(items: string[], fallback = '_none captured_'): string {
  return items.length ? items.map(i => `- ${i}`).join('\n') : fallback;
}

function codeBulletList(items: string[], fallback = '_none captured_'): string {
  return items.length ? items.map(i => `- \`${i}\``).join('\n') : fallback;
}

function targetInstruction(to: TargetTool): string {
  const map: Record<TargetTool, string> = {
    'claude-code': 'Continue in Claude Code. Start by checking the workspace diff, then proceed with the next actions.',
    cursor:        'Continue in Cursor Chat. Use the project files as source of truth and keep changes scoped.',
    codex:         'Continue in Codex. Inspect the repo state first, then implement and verify.',
    chatgpt:       'Continue in ChatGPT. Ask for missing repo details only if the handoff is not enough.',
    augment:       'Continue in Augment. Use the file list and next actions to resume the implementation.',
    clipboard:     'Use this handoff to continue the same work in another AI tool.',
  };
  return map[to];
}

function compactText(text: string, max = 260): string {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

// Targets that can read the repository themselves (agentic IDE/CLI tools).
// For these, CRH transmits the RESIDUAL + pointers.  Only genuinely repo-less
// targets (web ChatGPT) get the inlined "you don't have the repo" framing.
// 'clipboard' is treated as repo-aware: a copied handoff is almost always pasted
// back into a coding tool that DOES have the repo (continuing the same work).
const REPO_AWARE_TARGETS = new Set<TargetTool>(['claude-code', 'cursor', 'codex', 'augment', 'clipboard']);

/** Pick the single coherent task to continue.
 *  The latest user line is often a throwaway follow-up ("commit msg?", "any
 *  change on google app?").  When it's short and the original task is more
 *  substantial, lead with the original to avoid task contamination. */
export function chooseTask(ctx: SessionContext): { task: string; background: string } {
  const last  = ctx.lastUserMsg.trim();
  const first = ctx.task.trim();
  if (!last || last === first) return { task: first, background: '' };
  // A throwaway follow-up: short, or a meta-request unrelated to the build.
  const looksThrowaway = last.length < 60
    || /\b(commit|message|msg|rename|typo|format|lint|push|pr|google app)\b/i.test(last);
  if (looksThrowaway && first.length > last.length) {
    return { task: first, background: `Most recent ask (handle after the main task): ${compactText(last, 160)}` };
  }
  return { task: last, background: `Original task: ${compactText(first, 160)}` };
}

/** CRH paste block — the only thing the receiving agent reads first.
 *  Ordered by entropy (highest-residual first) and closed with the proven
 *  I-PASS "synthesis by receiver" loop. */
function buildContinuationPrompt(ctx: SessionContext, repoAware: boolean): string {
  const { task, background } = chooseTask(ctx);

  const stateLines: string[] = [];
  if (ctx.gitBranch) {
    stateLines.push(`Branch \`${ctx.gitBranch}\`${ctx.gitDirtyFiles.length ? ` · ${ctx.gitDirtyFiles.length} uncommitted file(s)` : ' · working tree clean'}`);
  }
  const stopLine = firstMeaningfulLine(ctx.lastAssistMsg);
  if (stopLine) stateLines.push(`Stopped at: ${compactText(stopLine, 200)}`);

  const section = (title: string, items: string[]) =>
    items.length ? `\n${title}\n${items.map(i => `- ${i}`).join('\n')}` : '';

  // Re-derivable file list → pointers (read these), not payload.
  const filePointers = ctx.filesModified.length
    ? `\nFILES IN PLAY (read them — don't trust this list blindly)\n${ctx.filesModified.slice(0, 12).map(f => `- ${f}`).join('\n')}`
    : '';

  const inFlight = ctx.gitDirtyFiles.length
    ? `\nUNCOMMITTED (in-flight — not on HEAD, you can't see this by reading committed code)\n${ctx.gitDirtyFiles.slice(0, 20).map(f => `- ${f}`).join('\n')}`
    : '';

  const verify = ctx.lastVerifiedCommand
    ? `\nVERIFY\n- \`${ctx.lastVerifiedCommand}\``
    : '\nVERIFY\n- No verification command was captured — run the project build/lint/test before finishing.';

  const sideInfo = repoAware
    ? 'You have the repository — read it for anything not stated here. This handoff carries only what the code itself cannot tell you.'
    : 'You do NOT have the repository in front of you. Ask for any file you need; this handoff summarises the work but cannot show live code.';

  return `I'm resuming a previous ${ctx.model} session on ${ctx.projectSlug}. ${sideInfo}

TASK
${task}${background ? `\n${background}` : ''}
${stateLines.length ? `\nSTATE\n${stateLines.map(s => `- ${s}`).join('\n')}` : ''}${section('DECISIONS & LOGIC (carry these forward — the reasoning behind the current code)', ctx.decisions)}${section('DO NOT REDO (dead-ends already tried — re-attempting wastes turns)', ctx.failedApproaches)}${section('CONSTRAINTS (hard requirements from the user — do not violate)', ctx.constraints)}${inFlight}${filePointers}${section('NEXT', ctx.nextSteps)}${verify}

SYNTHESIS — before you change anything, restate in one line: (a) the task, and (b) the one constraint you must not break. Then proceed.`.trim();
}

export function firstMeaningfulLine(text: string): string {
  // Skip conversational filler so "Stopped at" carries a real action/decision.
  const FILLER = /^(yes|no|ok|okay|sure|got it|done|great|perfect|thanks|here'?s|let me|now |alright|understood|right[,. ])/i;
  const lines = String(text || '').replace(/```[\s\S]*?```/g, ' ').split('\n').map(l => l.trim()).filter(Boolean);
  return lines.find(l => l.length > 20 && !FILLER.test(l)) ?? lines[0] ?? '';
}

/**
 * Build the handoff document.
 *
 * @param meta  Optional out-param; if provided, `meta.redactions` is set to the
 *              number of secrets stripped from the document (for the UI toast).
 */
export function generateHandoff(
  ctx: SessionContext,
  from: AiTool,
  to: TargetTool,
  meta?: { redactions?: number },
): string {
  const repoAware    = REPO_AWARE_TARGETS.has(to);
  const continuation = fenceSafe(buildContinuationPrompt(ctx, repoAware));

  // Full record (the lossless layer) — referenced on demand, ordered residual-first.
  const recentConvo = ctx.recentMessages.slice(-6).map(m => {
    const label = m.role === 'user' ? '**You**' : `**${ctx.model}**`;
    return `${label}: ${fenceSafe(compactText(m.text, 600))}`;
  }).join('\n\n');

  const core = `\
# Handoff from ${TOOL_LABELS[from] ?? from}
> ${ctx.messageCount} messages | ~${fmtTokHandoff(ctx.tokenCount)} tokens | ${ctx.projectSlug}${ctx.gitBranch ? ` | branch \`${ctx.gitBranch}\`` : ''}
>
> Conditional Residual Handoff — transmits what the repo can't tell you (decisions, dead-ends, constraints, uncommitted diff), not the code itself.

## ⚡ Paste this first

${targetInstruction(to)}

\`\`\`text
${continuation}
\`\`\`

---

## 🧠 Decision log

${bulletList(ctx.decisions, '_No explicit decisions were captured in the transcript._')}

## 🛑 Dead-ends — do not redo

${bulletList(ctx.failedApproaches, '_None captured._')}

## 📌 Constraints

${bulletList(ctx.constraints, '_None explicitly stated._')}

## 🔀 In-flight (uncommitted) state

${ctx.gitBranch ? `Branch: \`${ctx.gitBranch}\`` : '_Not a git repository, or git unavailable._'}

${ctx.gitDirtyFiles.length ? `Uncommitted changes:\n${codeBulletList(ctx.gitDirtyFiles)}` : '_Working tree clean (everything committed)._'}
${ctx.gitDiffStat ? `\n\`\`\`\n${ctx.gitDiffStat}\n\`\`\`` : ''}

## 📁 Files in play (pointers — read the live files, this is just the index)

Modified:
${codeBulletList(ctx.filesModified)}

Read / explored:
${codeBulletList(ctx.filesRead)}

## ⌨️ Commands run

${bulletList(ctx.commandsRun)}

**Verify:** ${ctx.lastVerifiedCommand ? `\`${ctx.lastVerifiedCommand}\`` : '_none captured — run build/lint/test before finalizing._'}

## 🎯 Task

**Continue:** ${ctx.lastUserMsg || ctx.task}

**Original request:** ${ctx.task}

## 💬 Recent exchange (tail)

${recentConvo || '_none captured_'}
`;

  const PREAMBLE: Partial<Record<TargetTool, string>> = {
    cursor:      '<!-- Paste into Cursor Chat -->',
    augment:     '<!-- Paste into Augment Chat -->',
    codex:       '# continue',
    chatgpt:     'Please continue helping with this task. Context from my previous AI session is below.',
  };
  const preamble = PREAMBLE[to];
  const doc = preamble ? `${preamble}\n\n${core}` : core;

  // FINAL step: strip any pasted secrets before the handoff leaves the machine.
  const redacted = redactSecrets(doc);
  if (meta) meta.redactions = redacted.count;
  return redacted.text;
}
