/**
 * promptHistory.ts — Prompt run history for Markr
 *
 * Every time the user runs a prompt via the Prompt Runner, the full conversation
 * is saved to VS Code's globalState (persists across sessions, per-machine).
 * History is keyed per workspace so different projects have separate histories.
 *
 * Storage limit: last 200 runs per workspace (old entries rotated out).
 *
 * Adding to CLAUDE.md: update `FEATURES` table status when this ships.
 */

import * as vscode from 'vscode';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PromptRun {
  id:           string;          // unique — `Date.now() + Math.random()`
  timestamp:    number;          // Unix ms
  file:         string;          // filename (e.g. "CLAUDE.md")
  relPath:      string;          // workspace-relative path
  model:        string;          // model ID (e.g. "claude-sonnet-4-5")
  modelLabel:   string;          // display name (e.g. "Claude 4 Sonnet")
  provider:     'anthropic' | 'openai' | 'google';
  systemPrompt: string;          // the file content used as system prompt
  messages:     Array<{ role: 'user' | 'assistant'; content: string }>;
  durationMs?:  number;          // how long the run took
}

// ─── PromptHistoryManager ─────────────────────────────────────────────────────

const MAX_RUNS = 200;

export class PromptHistoryManager {
  private readonly _key: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    // One history list per workspace root so different projects stay separate
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'global';
    // Hash the path to a safe storage key
    this._key = `markr.promptHistory.${Buffer.from(wsRoot).toString('base64').slice(0, 32)}`;
  }

  /** Save a completed run. Rotates out oldest entries beyond MAX_RUNS. */
  async save(run: PromptRun): Promise<void> {
    const all = this.getAll();
    all.unshift(run); // newest first
    if (all.length > MAX_RUNS) all.splice(MAX_RUNS);
    await this.context.globalState.update(this._key, all);
  }

  /** All runs for this workspace, newest first. */
  getAll(): PromptRun[] {
    return (this.context.globalState.get<PromptRun[]>(this._key) ?? []);
  }

  /** Runs for a specific file (matched by relPath). */
  getForFile(relPath: string): PromptRun[] {
    return this.getAll().filter(r => r.relPath === relPath);
  }

  /** Runs from the last N days. */
  getRecent(days = 7): PromptRun[] {
    const cutoff = Date.now() - days * 86_400_000;
    return this.getAll().filter(r => r.timestamp >= cutoff);
  }

  /** Delete a single run by id. */
  async delete(id: string): Promise<void> {
    const all = this.getAll().filter(r => r.id !== id);
    await this.context.globalState.update(this._key, all);
  }

  /** Clear all history for this workspace. */
  async clear(): Promise<void> {
    await this.context.globalState.update(this._key, []);
  }

  /** Serialise to JSON for export / display in webview. */
  toJSON(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }
}
