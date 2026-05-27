import * as vscode from 'vscode';
import { MarkdownPreviewPanel } from './preview';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.openPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showInformationMessage('Open a Markdown (.md) file to use Markr.');
        return;
      }
      MarkdownPreviewPanel.createOrShow(editor.document);
    }),

    // Live update as you type
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (document.languageId === 'markdown') {
        MarkdownPreviewPanel.update(document);
      }
    }),

    // Follow active editor
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor?.document.languageId === 'markdown') {
        MarkdownPreviewPanel.update(editor.document);
      }
    }),

    // Scroll sync: cursor moves → preview scrolls to nearest heading
    vscode.window.onDidChangeTextEditorSelection(event => {
      const cfg = vscode.workspace.getConfiguration('markr');
      if (!cfg.get<boolean>('scrollSync', true)) return;
      if (event.textEditor.document.languageId === 'markdown') {
        const line = event.selections[0].active.line;
        MarkdownPreviewPanel.syncScroll(event.textEditor.document, line);
      }
    }),
  );

  // Watch workspace for .md file additions/deletions → refresh file panel
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
  const refresh = () => MarkdownPreviewPanel.refreshFiles();
  watcher.onDidCreate(refresh);
  watcher.onDidDelete(refresh);
  context.subscriptions.push(watcher);
}

export function deactivate() {}
