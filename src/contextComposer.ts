/**
 * contextComposer.ts — Context Composer for Markr
 *
 * Discovers every AI config file that is in scope for the current workspace
 * (current dir + parent dirs — exactly how Claude Code reads CLAUDE.md files),
 * counts their tokens, and lets the user compose a merged context block.
 *
 * Architecture:
 *   - ContextComposer class: pure business logic, no VS Code UI
 *   - Called by extension.ts to populate the webview sidebar
 *   - Sends messages to webview via postMessage
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
  contextWindow:  number;        // context window for the primary model (chars for % bar)
}

// Context window sizes by model (tokens)
const CONTEXT_WINDOWS: Record<AiModel, number> = {
  claude:  200_000,
  gpt4:    128_000,
  gpt4o:   128_000,
  llama3:  128_000,
  gemini:  1_000_000,
  mistral: 128_000,
  generic: 128_000,
};

// ─── AI config filenames (shared with markrExplorer) ─────────────────────────

const AI_CONFIG_FILENAMES = new Set([
  'claude.md', 'claude.local.md',
  '.cursorrules', 'cursor.md',
  '.github/copilot-instructions.md', 'copilot-instructions.md',
  '.windsurfrules', 'windsurf.md',
  'agent.md', 'agents.md', 'skill.md', 'skills.md',
  'system-prompt.md', 'prompt.md', 'prompts.md',
  'aider.md', 'codex.md', 'openai.md', 'gpt.md', 'gemini.md',
  'instructions.md', 'memory.md', 'rules.md', 'context.md',
]);

function isAiConfig(filename: string): boolean {
  return AI_CONFIG_FILENAMES.has(filename.toLowerCase())
    || /^claude(\.local)?\.md$/i.test(filename);
}

// ─── ContextComposer ─────────────────────────────────────────────────────────

export class ContextComposer {

  /**
   * Discover all AI config files in scope for the given document.
   * "In scope" means: same directory + every parent up to filesystem root,
   * plus other AI configs found within the workspace.
   *
   * This mirrors exactly how Claude Code reads CLAUDE.md hierarchically.
   */
  async discover(activeDocUri?: vscode.Uri): Promise<ContextSummary> {
    const files: ContextFile[] = [];
    const seen  = new Set<string>();

    // ── 1. Walk up from the active document / workspace root ─────────────
    const startPath = activeDocUri
      ? nodePath.dirname(activeDocUri.fsPath)
      : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

    let dir = startPath;
    while (dir && dir !== nodePath.dirname(dir)) {
      const isParent = wsRoot && !dir.startsWith(wsRoot);
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          if (!isAiConfig(entry)) continue;
          const fullPath = nodePath.join(dir, entry);
          if (seen.has(fullPath)) continue;
          seen.add(fullPath);
          const file = this._buildEntry(fullPath, wsRoot, isParent ? 'parent' : 'workspace', true);
          if (file) files.push(file);
        }
      } catch { /* dir not readable — skip */ }
      dir = nodePath.dirname(dir);
      if (dir === wsRoot && isParent) break;
    }

    // ── 2. Also find AI configs elsewhere in the workspace ───────────────
    if (wsRoot) {
      try {
        const maxFiles = vscode.workspace.getConfiguration('markr').get<number>('maxWorkspaceFiles', 500);
        const uris = await vscode.workspace.findFiles(
          '**/*.md',
          '{**/node_modules/**,**/.git/**,**/.vscode/**,**/.next/**,**/dist/**,**/build/**}',
          maxFiles,
        );
        for (const uri of uris) {
          const fn = nodePath.basename(uri.fsPath);
          if (!isAiConfig(fn) || seen.has(uri.fsPath)) continue;
          seen.add(uri.fsPath);
          const file = this._buildEntry(uri.fsPath, wsRoot, 'workspace', false);
          if (file) files.push(file);
        }
      } catch { /* scan failed */ }
    }

    // Sort: parent-scope first (hierarchically read first), then workspace alphabetically
    files.sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'parent' ? -1 : 1;
      return a.relPath.localeCompare(b.relPath);
    });

    // Determine primary model (most common among selected files)
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
      // Note: readFileSync is intentional here for the directory-walk phase
      // (called synchronously within the directory listing loop).
      // The async findFiles path in step 2 is non-blocking.
      // TODO: migrate to fs.promises for large workspaces (tracked in CLAUDE.md).
      const content  = fs.readFileSync(fullPath, 'utf-8');
      const filename = nodePath.basename(fullPath);
      const relPath  = wsRoot && fullPath.startsWith(wsRoot)
        ? vscode.workspace.asRelativePath(fullPath)
        : fullPath.replace(nodePath.dirname(wsRoot), '').replace(/^[\\/]/, '../');
      const model    = detectModel(filename, relPath);
      const tokens   = countTokens(content, model);
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
   * Merge selected files into a single context block ready to paste.
   * Format: each file wrapped with a clear header so the model knows the source.
   */
  mergeContext(files: ContextFile[]): string {
    const selected = files.filter(f => f.selected);
    const blocks = selected.map(f => {
      let content = '';
      try { content = fs.readFileSync(f.fullPath, 'utf-8').trim(); } catch {}
      return `# === ${f.relPath} ===\n\n${content}`;
    });
    const total = selected.reduce((s, f) => s + f.tokens, 0);
    const header = `# Merged AI context — ${selected.length} files, ${fmtTokens(total)}\n\n`;
    return header + blocks.join('\n\n---\n\n');
  }
}
