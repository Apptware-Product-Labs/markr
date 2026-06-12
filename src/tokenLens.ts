/**
 * tokenLens.ts — Token-aware inline decorations + file CodeLens for AI config files
 *
 * Two layers:
 *   1. CodeLens at top of file — total tokens, model, % of context window
 *   2. Colored inline text after each heading — section tokens + % of file total
 *
 * Uses TextEditorDecorationType (same API as GitLens blame) so decorations
 * have real color: green for light sections, amber for medium, red for heavy.
 *
 * % shown is relative to the FILE TOTAL — "this section is 22% of your CLAUDE.md"
 * is immediately useful. Context window % only makes sense at the file level.
 */

import * as vscode from 'vscode';
import * as nodePath from 'path';
import { countTokens, detectModel, type AiModel } from './tokenEngine';
import { isAiConfigFile } from './markrExplorer';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTEXT_WINDOWS: Record<AiModel, number> = {
  claude:   200_000,
  gpt4:     128_000,
  gpt4o:    128_000,
  llama3:   128_000,
  gemini: 1_000_000,
  mistral:  128_000,
  generic:  128_000,
};

const MODEL_LABELS: Record<AiModel, string> = {
  claude:   'Claude',   gpt4:   'GPT-4',    gpt4o:    'GPT-4o',
  llama3:   'Llama 3',  gemini: 'Gemini',   mistral:  'Mistral',
  generic: 'Generic',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 10_000) return Math.round(n / 1_000) + 'K';
  if (n >= 1_000)  return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function buildBar(tokens: number, window: number, width = 10): string {
  const filled = Math.round(Math.min(1, tokens / window) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

/** Single block char encoding section weight — the character IS the visual. */
function weightChar(tokens: number): string {
  if (tokens < 150)   return '▏';
  if (tokens < 400)   return '▎';
  if (tokens < 800)   return '▍';
  if (tokens < 1_500) return '▌';
  if (tokens < 3_000) return '▊';
  if (tokens < 6_000) return '▉';
  return '█';
}

/** Parse headings from document text, skipping code fences. */
function parseHeadings(lines: string[]): { line: number }[] {
  const result: { line: number }[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^#{1,6}\s+\S/.test(lines[i])) result.push({ line: i });
  }
  return result;
}

// ─── 1. File-level CodeLens (top of file only) ───────────────────────────────
// CodeLens is intentionally only used here — it's the right tool for a
// one-line summary that doesn't clutter the document body.

export class MarkrTokenLensProvider implements vscode.CodeLensProvider {
  private _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onChange.event;
  private _timer: ReturnType<typeof setTimeout> | undefined;

  scheduleRefresh(): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._onChange.fire(), 500);
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const cfg      = vscode.workspace.getConfiguration('markr');
    if (!cfg.get<boolean>('showTokenLens', true)) return [];
    const filename = nodePath.basename(document.uri.fsPath);
    const relPath  = vscode.workspace.asRelativePath(document.uri);
    if (!isAiConfigFile(filename, relPath)) return [];

    const text    = document.getText();
    const model   = detectModel(nodePath.basename(document.uri.fsPath), vscode.workspace.asRelativePath(document.uri));
    const total   = countTokens(text, model);
    const ctxWin  = CONTEXT_WINDOWS[model];
    const ctxPct  = ((total / ctxWin) * 100);
    const pctStr  = ctxPct < 0.1 ? '<0.1%' : ctxPct.toFixed(ctxPct < 10 ? 1 : 0) + '%';
    const bar     = buildBar(total, ctxWin, 10);
    const warning = total > 50_000 ? '  $(error)' : total > 20_000 ? '  $(warning)' : '';

    return [new vscode.CodeLens(
      new vscode.Range(0, 0, 0, 0),
      {
        title: `⬡  ${fmt(total)} tok  ·  ${MODEL_LABELS[model]}  ·  ${bar}  ${pctStr} of context${warning}`,
        command: 'markr.openPreview',
        tooltip: 'Open in Markr',
      },
    )];
  }
}

// ─── 2. Per-section inline colored decorations ────────────────────────────────
// TextEditorDecorationType supports color — same mechanism GitLens uses.
// Three tiers:  🟢 green (light)  🟡 amber (medium)  🔴 red (heavy)
// % shown = % of file total (actionable: "trim this section — it's 30% of your config")

export class MarkrTokenDecorations {
  private _light:  vscode.TextEditorDecorationType;
  private _medium: vscode.TextEditorDecorationType;
  private _heavy:  vscode.TextEditorDecorationType;
  private _timer:  ReturnType<typeof setTimeout> | undefined;

  constructor(context: vscode.ExtensionContext) {
    const base = {
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    };
    // Colors use VS Code theme chart tokens — adapts to light/dark themes
    this._light = vscode.window.createTextEditorDecorationType({
      ...base,
      after: {
        color: new vscode.ThemeColor('charts.green'),
        fontStyle: 'normal',
        margin: '0 0 0 3ch',
      },
    });
    this._medium = vscode.window.createTextEditorDecorationType({
      ...base,
      after: {
        color: new vscode.ThemeColor('charts.yellow'),
        fontStyle: 'normal',
        margin: '0 0 0 3ch',
      },
    });
    this._heavy = vscode.window.createTextEditorDecorationType({
      ...base,
      after: {
        color: new vscode.ThemeColor('charts.red'),
        fontStyle: 'normal',
        margin: '0 0 0 3ch',
      },
    });
    context.subscriptions.push(this._light, this._medium, this._heavy);
  }

  scheduleUpdate(editor: vscode.TextEditor): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.update(editor), 450);
  }

  update(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    const doc = editor.document;
    if (doc.languageId !== 'markdown') return;
    const cfg = vscode.workspace.getConfiguration('markr');
    const fn  = nodePath.basename(doc.uri.fsPath);
    const rp  = vscode.workspace.asRelativePath(doc.uri);
    if (!cfg.get<boolean>('showTokenLens', true) || !isAiConfigFile(fn, rp)) {
      this._clearAll(editor); return;
    }

    const text     = doc.getText();
    const lines    = text.split('\n');
    const model    = detectModel(nodePath.basename(doc.uri.fsPath), vscode.workspace.asRelativePath(doc.uri));
    const total    = countTokens(text, model);
    if (total === 0) { this._clearAll(editor); return; }

    const headings = parseHeadings(lines);
    const light:  vscode.DecorationOptions[] = [];
    const medium: vscode.DecorationOptions[] = [];
    const heavy:  vscode.DecorationOptions[] = [];

    for (let hi = 0; hi < headings.length; hi++) {
      const hLine    = headings[hi].line;
      const nextLine = headings[hi + 1]?.line ?? lines.length;
      const sTok     = countTokens(lines.slice(hLine, nextLine).join('\n'), model);

      // % of this file — "22% of your CLAUDE.md" is immediately useful
      const pctOfFile = total > 0 ? Math.round((sTok / total) * 100) : 0;
      const bar       = weightChar(sTok);
      // Format: "  ▌ 1.8K tok · 22%"
      const text_     = `  ${bar} ${fmt(sTok)} tok · ${pctOfFile}%`;

      const col  = lines[hLine].length;
      const deco: vscode.DecorationOptions = {
        range: new vscode.Range(hLine, col, hLine, col),
        renderOptions: { after: { contentText: text_ } },
      };

      if (sTok >= 3_000)   heavy.push(deco);
      else if (sTok >= 600) medium.push(deco);
      else                  light.push(deco);
    }

    editor.setDecorations(this._light,  light);
    editor.setDecorations(this._medium, medium);
    editor.setDecorations(this._heavy,  heavy);
  }

  private _clearAll(editor: vscode.TextEditor): void {
    editor.setDecorations(this._light,  []);
    editor.setDecorations(this._medium, []);
    editor.setDecorations(this._heavy,  []);
  }
}
