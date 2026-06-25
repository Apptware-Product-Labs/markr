/**
 * handoffEditor.ts — the "Review & edit handoff" panel (vscode glue).
 *
 * Opens a generated handoff in an editable webview so the user can trim it before
 * copying. The EDITED text is sent back via `onFinalize(text, mode)`, where the
 * caller (Context Bridge) does the actual clipboard write / native-file delivery /
 * history record. A single panel is reused; opening a new handoff re-targets it.
 */
import * as vscode from 'vscode';
import { buildHandoffEditorHtml } from './webview/handoffEditorHtml';

export interface HandoffEditorOptions {
  text:        string;
  sourceLabel: string;
  targetLabel: string;
  isClipboard: boolean;
  redactions:  number;
  /** Finalize the (possibly edited) handoff. 'copy' = clipboard only; 'deliver' = also write the target's native file. */
  onFinalize:  (text: string, mode: 'copy' | 'deliver') => Promise<void> | void;
}

export class HandoffEditorPanel {
  private static current?: HandoffEditorPanel;

  private constructor(private readonly panel: vscode.WebviewPanel, private opts: HandoffEditorOptions) {
    panel.onDidDispose(() => { if (HandoffEditorPanel.current === this) HandoffEditorPanel.current = undefined; });
    panel.webview.onDidReceiveMessage(async (m: Record<string, unknown>) => {
      if (m.type !== 'finalize' || typeof m.text !== 'string') return;
      const mode = m.mode === 'deliver' ? 'deliver' : 'copy';
      try {
        await this.opts.onFinalize(m.text, mode);
        this.panel.webview.postMessage({ type: 'done', mode });
      } catch (err) {
        vscode.window.showErrorMessage(`Markr: handoff ${mode} failed. ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    this._render();
  }

  static show(opts: HandoffEditorOptions) {
    if (HandoffEditorPanel.current) {
      HandoffEditorPanel.current.opts = opts;
      HandoffEditorPanel.current.panel.reveal(vscode.ViewColumn.Active);
      HandoffEditorPanel.current._render();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'markrHandoffEditor', 'Review Handoff', vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    HandoffEditorPanel.current = new HandoffEditorPanel(panel, opts);
  }

  private _render() {
    this.panel.title = `Review Handoff → ${this.opts.targetLabel}`;
    this.panel.webview.html = buildHandoffEditorHtml({
      text: this.opts.text,
      sourceLabel: this.opts.sourceLabel,
      targetLabel: this.opts.targetLabel,
      isClipboard: this.opts.isClipboard,
      redactions: this.opts.redactions,
    });
  }
}
