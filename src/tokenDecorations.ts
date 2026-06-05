/**
 * tokenDecorations.ts — Inline token cost decorations for the VS Code editor
 *
 * Shows a subtle "~N tok" annotation at the end of each heading line in
 * markdown files, making token cost visible right in the editor without
 * needing to open the Markr preview panel.
 *
 * Like GitLens blame annotations — always there, never in the way.
 *
 * Decorations update on:
 *   - Active editor change
 *   - Document change (debounced 500ms)
 *   - Configuration change (setting enabled/disabled)
 */

import * as vscode from 'vscode';
import { countTokens, detectModel, type AiModel } from './tokenEngine';

// ─── Decoration type ──────────────────────────────────────────────────────────

// Two levels: normal sections and heavy sections (>20% of total)
const normalDeco = vscode.window.createTextEditorDecorationType({
  after: {
    margin: '0 0 0 12px',
    color: new vscode.ThemeColor('editorLineNumber.foreground'),
    fontStyle:  'normal',
    fontWeight: 'normal',
  },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

const heavyDeco = vscode.window.createTextEditorDecorationType({
  after: {
    margin: '0 0 0 12px',
    color: new vscode.ThemeColor('editorWarning.foreground'),
    fontStyle: 'italic',
  },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

// ─── TokenDecorationProvider ──────────────────────────────────────────────────

export class TokenDecorationProvider implements vscode.Disposable {
  private _disposables: vscode.Disposable[] = [];
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor(e => {
        if (e) this._update(e);
      }),
      vscode.workspace.onDidChangeTextDocument(ev => {
        const editor = vscode.window.activeTextEditor;
        if (editor && ev.document === editor.document) {
          this._scheduleUpdate(editor);
        }
      }),
      vscode.workspace.onDidChangeConfiguration(ev => {
        if (ev.affectsConfiguration('markr.showTokenDecorations')) {
          const editor = vscode.window.activeTextEditor;
          if (editor) this._update(editor);
        }
      }),
    );
    // Decorate the active editor immediately on activation
    if (vscode.window.activeTextEditor) {
      this._update(vscode.window.activeTextEditor);
    }
  }

  private _scheduleUpdate(editor: vscode.TextEditor): void {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._update(editor), 500);
  }

  private _update(editor: vscode.TextEditor): void {
    const doc = editor.document;

    // Only decorate markdown files
    if (doc.languageId !== 'markdown') {
      editor.setDecorations(normalDeco, []);
      editor.setDecorations(heavyDeco, []);
      return;
    }

    // Check the user's setting (default: on)
    const cfg = vscode.workspace.getConfiguration('markr');
    if (!cfg.get<boolean>('showTokenDecorations', true)) {
      editor.setDecorations(normalDeco, []);
      editor.setDecorations(heavyDeco, []);
      return;
    }

    const text     = doc.getText();
    const filename = doc.uri.path.split('/').pop() ?? '';
    const relPath  = vscode.workspace.asRelativePath(doc.uri);
    const model    = detectModel(filename, relPath);

    // Parse sections and count tokens per section
    const sections = this._parseSections(text, model);
    if (!sections.length) {
      editor.setDecorations(normalDeco, []);
      editor.setDecorations(heavyDeco, []);
      return;
    }

    const total = sections.reduce((s, sec) => s + sec.tokens, 0);
    const normalRanges: vscode.DecorationOptions[] = [];
    const heavyRanges:  vscode.DecorationOptions[] = [];

    for (const sec of sections) {
      const line  = doc.lineAt(sec.line);
      const range = new vscode.Range(line.range.end, line.range.end);

      const pct     = total > 0 ? (sec.tokens / total) * 100 : 0;
      const label   = sec.tokens >= 1000
        ? `~${(sec.tokens / 1000).toFixed(1)}K tok`
        : `~${sec.tokens} tok`;
      const pctStr  = pct > 5 ? ` · ${Math.round(pct)}%` : '';
      const content = `  ${label}${pctStr}`;

      const opts: vscode.DecorationOptions = {
        range,
        renderOptions: { after: { contentText: content } },
      };

      // Heavy sections (>25% of total) get the warning colour
      if (pct > 25) { heavyRanges.push(opts); } else { normalRanges.push(opts); }
    }

    editor.setDecorations(normalDeco, normalRanges);
    editor.setDecorations(heavyDeco,  heavyRanges);
  }

  /** Parse markdown headings and measure the token cost of each section's content. */
  private _parseSections(text: string, model: AiModel): Array<{ line: number; tokens: number }> {
    const lines   = text.split('\n');
    const result: Array<{ line: number; tokens: number }> = [];
    let curLine   = -1;
    let curBuf:   string[] = [];

    const flush = () => {
      if (curLine >= 0 && curBuf.length) {
        result.push({ line: curLine, tokens: countTokens(curBuf.join('\n'), model) });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^#{1,6}\s/.test(l)) {
        flush();
        curLine = i;
        curBuf  = [l];
      } else if (curLine >= 0) {
        curBuf.push(l);
      }
    }
    flush();
    return result;
  }

  dispose(): void {
    clearTimeout(this._debounceTimer);
    normalDeco.dispose();
    heavyDeco.dispose();
    this._disposables.forEach(d => d.dispose());
  }
}
