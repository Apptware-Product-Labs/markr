/**
 * contextComposer.ts — Context Composer for Markr
 *
 * Discovers every AI config file that is in scope for the current workspace
 * (current dir + parent dirs — exactly how Claude Code reads CLAUDE.md files),
 * counts their tokens, and lets the user compose a merged context block.
 *
 * Performance notes:
 *   - Static mtime cache: tokens are NOT re-counted unless the file changed on disk.
 *   - Streaming: discover() calls onFile() for each file as soon as it's found,
 *     so the webview can render rows incrementally instead of waiting for a full scan.
 *   - mergeContext() reads from cache when possible (same mtime check).
 */

import * as vscode from 'vscode';
import * as nodePath from 'path';
import * as fs from 'fs';
import { countTokens, detectModel, fmtTokens, isExactCount, modelLabel, type AiModel } from './tokenEngine';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContextFile {
  uri:        vscode.Uri;
  filename:   string;
  relPath:    string;          // workspace-relative path shown in UI
  fullPath:   string;          // absolute path for reading
  model:      AiModel;
  modelLabel: string;
  exact:      boolean;         // true = exact token count, false = estimated
  tokens:     number;
  selected:   boolean;
  scope:      'workspace' | 'parent';  // is file inside or above workspace root?
}

export interface ContextSummary {
  files:          ContextFile[];
  selectedTokens: number;
  totalTokens:    number;
  model:          AiModel;       // primary model (most files target)
  contextWindow:  number;        // context window for the primary model (tokens)
}

// Context window sizes by model (tokens)
const CONTEXT_WINDOWS: Record<AiModel, number> = {
  claude:   200_000,
  gpt4:     128_000,
  gpt4o:    128_000,
  llama3:   128_000,
  llama2:     4_096,
  deepseek: 128_000,
  kimi:     128_000,
  gemini: 1_000_000,
  mistral:  128_000,
  qwen:     128_000,
  generic:  128_000,
};

// ─── AI config detection ─────────────────────────────────────────────────────
// Three layers: exact name → filename pattern → folder path → content heuristic.

const AI_CONFIG_FILENAMES = new Set([
  'claude.md', 'claude.local.md',
  '.cursorrules', 'cursor.md',
  '.github/copilot-instructions.md', 'copilot-instructions.md',
  '.windsurfrules', 'windsurf.md',
  'agent.md', 'agents.md', 'skill.md', 'skills.md',
  'system-prompt.md', 'prompt.md', 'prompts.md',
  'aider.md', 'codex.md', 'openai.md', 'gpt.md', 'gemini.md',
  'instructions.md', 'memory.md', 'rules.md', 'context.md',
  'deepseek.md', 'kimi.md', 'llama.md', 'mistral.md', 'qwen.md',
]);

// Filename suffix patterns — catches my-agent.md, review-skill.md, etc.
const AI_NAME_PATTERN =
  /[-_](agent|skill|skills|prompt|prompts|instructions?|rules?|context|memory|system|assistant|bot)\.md$/i;

// Folder patterns — anything inside these directories is treated as an AI config
const AI_FOLDER_PATTERN =
  /(^|\/)(\.(claude|cursor|github)|skills?|agents?|prompts?|instructions?|memories|rules|contexts)(\/|$)/i;

/**
 * Returns true if the file is an AI config by name, pattern, or folder.
 * Optionally pass `content` (first ~600 chars) for a lightweight heading heuristic.
 */
function isAiConfig(filename: string, relPath?: string, content?: string): boolean {
  const lower = filename.toLowerCase();

  // Layer 1 — exact known name
  if (AI_CONFIG_FILENAMES.has(lower)) return true;
  if (/^claude(\.local)?\.md$/i.test(filename)) return true;

  // Layer 2 — filename pattern  (e.g. review-agent.md, deployment-skill.md)
  if (AI_NAME_PATTERN.test(lower)) return true;

  // Layer 3 — folder pattern  (e.g. skills/review.md, .claude/commands/commit.md)
  if (relPath && AI_FOLDER_PATTERN.test(relPath)) return true;

  // Layer 4 — content heuristic: has both ## Trigger AND ## Instructions → Claude skill
  // Only runs when content is already in memory (avoids extra I/O in the walk phase).
  if (content) {
    const head = content.slice(0, 600).toLowerCase();
    const hasTrigger      = /^##\s+trigger/m.test(head);
    const hasInstructions = /^##\s+(instructions?|steps?|how to|what to do)/m.test(head);
    const hasRole         = /^##\s+(role|persona|system prompt)/m.test(head);
    const hasFrontmatter  = /^---[\s\S]{0,200}\b(role|model|agent|skill)\s*:/m.test(head);
    if ((hasTrigger && hasInstructions) || hasRole || hasFrontmatter) return true;
  }

  return false;
}

// ─── Static mtime cache ───────────────────────────────────────────────────────
// Keyed by absolute path → { mtime (ms), tokens, content }
// Survives across multiple ContextComposer instances in the same process.

interface CacheEntry { mtime: number; tokens: number; content: string; }
const _fileCache = new Map<string, CacheEntry>();

// ─── ContextComposer ─────────────────────────────────────────────────────────

export class ContextComposer {

  /**
   * Discover all AI config files in scope for the given document.
   *
   * @param activeDocUri  The URI of the file open in Markr (used to start the
   *                      directory walk). Falls back to workspace root.
   * @param onFile        Optional streaming callback — called with each ContextFile
   *                      as soon as it is found, before the full scan completes.
   *                      Use this to stream rows to the webview progressively.
   */
  async discover(
    activeDocUri?: vscode.Uri,
    onFile?: (f: ContextFile) => void,
  ): Promise<ContextSummary> {
    const files: ContextFile[] = [];
    const seen  = new Set<string>();

    const wsRoot    = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const startPath = activeDocUri
      ? nodePath.dirname(activeDocUri.fsPath)
      : wsRoot;

    // ── 1. Walk up from the active document to the filesystem root ────────
    // In the walk phase we check name/pattern only (no file read yet — fast).
    // relPath and content checks happen inside _buildEntry after the cache hit.
    let dir = startPath;
    while (dir && dir !== nodePath.dirname(dir)) {
      const isParent = !!(wsRoot && !dir.startsWith(wsRoot));
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          // Quick name/pattern check — no I/O yet
          const tentativeRel = wsRoot && nodePath.join(dir, entry).startsWith(wsRoot)
            ? nodePath.join(dir, entry).slice(wsRoot.length + 1).replace(/\\/g, '/')
            : entry;
          if (!isAiConfig(entry, tentativeRel)) continue;
          const fullPath = nodePath.join(dir, entry);
          if (seen.has(fullPath)) continue;
          seen.add(fullPath);
          const file = this._buildEntry(fullPath, wsRoot, isParent ? 'parent' : 'workspace', true);
          if (file) {
            files.push(file);
            onFile?.(file);
          }
        }
      } catch { /* dir not readable */ }
      if (dir === wsRoot) break;
      dir = nodePath.dirname(dir);
    }

    // ── 2. Workspace scan — all .md files, content heuristic on unknowns ──
    if (wsRoot) {
      try {
        const maxFiles = vscode.workspace.getConfiguration('markr').get<number>('maxWorkspaceFiles', 500);
        const uris = await vscode.workspace.findFiles(
          '**/*.md',
          '{**/node_modules/**,**/.git/**,**/.vscode/**,**/.next/**,**/dist/**,**/build/**}',
          maxFiles,
        );
        for (const uri of uris) {
          if (seen.has(uri.fsPath)) continue;
          const fn      = nodePath.basename(uri.fsPath);
          const relPath = vscode.workspace.asRelativePath(uri.fsPath);

          // Quick check (no read) — name or folder pattern
          if (isAiConfig(fn, relPath)) {
            seen.add(uri.fsPath);
            const file = this._buildEntry(uri.fsPath, wsRoot, 'workspace', false);
            if (file) { files.push(file); onFile?.(file); }
            continue;
          }

          // Content heuristic for unrecognised .md files
          // Only reads cached content (free) or does a small readFileSync
          try {
            const stat   = fs.statSync(uri.fsPath);
            const cached = _fileCache.get(uri.fsPath);
            const content = (cached && cached.mtime === stat.mtimeMs)
              ? cached.content
              : fs.readFileSync(uri.fsPath, 'utf-8');
            if (isAiConfig(fn, relPath, content)) {
              seen.add(uri.fsPath);
              const file = this._buildEntry(uri.fsPath, wsRoot, 'workspace', false);
              if (file) { files.push(file); onFile?.(file); }
            }
          } catch { /* unreadable */ }
        }
      } catch { /* scan failed */ }
    }

    // Sort: parent-scope first, then workspace alphabetically
    files.sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'parent' ? -1 : 1;
      return a.relPath.localeCompare(b.relPath);
    });

    // Primary model = most common among selected files
    const modelCounts: Partial<Record<AiModel, number>> = {};
    for (const f of files.filter(f => f.selected)) {
      modelCounts[f.model] = (modelCounts[f.model] ?? 0) + 1;
    }
    const primaryModel = (Object.entries(modelCounts)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? 'generic') as AiModel;

    const selectedTokens = files.filter(f => f.selected).reduce((s, f) => s + f.tokens, 0);
    const totalTokens    = files.reduce((s, f) => s + f.tokens, 0);

    return { files, selectedTokens, totalTokens, model: primaryModel, contextWindow: CONTEXT_WINDOWS[primaryModel] };
  }

  private _buildEntry(
    fullPath: string,
    wsRoot:   string,
    scope:    'workspace' | 'parent',
    selected: boolean,
  ): ContextFile | null {
    try {
      const stat     = fs.statSync(fullPath);
      const mtime    = stat.mtimeMs;
      const filename = nodePath.basename(fullPath);
      const relPath  = wsRoot && fullPath.startsWith(wsRoot)
        ? vscode.workspace.asRelativePath(fullPath)
        : fullPath.replace(nodePath.dirname(wsRoot || '/'), '').replace(/^[\\/]/, '../');
      const model    = detectModel(filename, relPath);

      // Cache check: skip readFileSync + countTokens if file hasn't changed
      const cached = _fileCache.get(fullPath);
      let content: string;
      let tokens: number;
      if (cached && cached.mtime === mtime) {
        content = cached.content;
        tokens  = cached.tokens;
      } else {
        content = fs.readFileSync(fullPath, 'utf-8');
        tokens  = countTokens(content, model);
        _fileCache.set(fullPath, { mtime, tokens, content });
      }

      return {
        uri: vscode.Uri.file(fullPath),
        filename, relPath, fullPath, model,
        modelLabel: modelLabel(model),
        exact: isExactCount(model),
        tokens, selected, scope,
      };
    } catch { return null; }
  }

  /**
   * Merge selected files into a single context block.
   * Reads from the mtime cache when possible — no redundant disk I/O.
   */
  mergeContext(files: ContextFile[]): string {
    const selected = files.filter(f => f.selected);
    const blocks = selected.map(f => {
      let content = '';
      try {
        const stat   = fs.statSync(f.fullPath);
        const cached = _fileCache.get(f.fullPath);
        if (cached && cached.mtime === stat.mtimeMs) {
          content = cached.content.trim();
        } else {
          content = fs.readFileSync(f.fullPath, 'utf-8').trim();
          const model  = detectModel(f.filename, f.relPath);
          const tokens = countTokens(content, model);
          _fileCache.set(f.fullPath, { mtime: stat.mtimeMs, tokens, content });
        }
      } catch {}
      return `# === ${f.relPath} ===\n\n${content}`;
    });
    const total  = selected.reduce((s, f) => s + f.tokens, 0);
    const header = `# Merged AI context — ${selected.length} files, ${fmtTokens(total)}\n\n`;
    return header + blocks.join('\n\n---\n\n');
  }
}
