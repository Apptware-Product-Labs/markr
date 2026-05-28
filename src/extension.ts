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

    vscode.commands.registerCommand('markr.openShowcase', async () => {
      const uri = vscode.Uri.joinPath(context.extensionUri, 'samples', 'markr-showcase.md');
      const doc = await vscode.workspace.openTextDocument(uri);
      MarkdownPreviewPanel.createOrShow(doc);
    }),

    vscode.commands.registerCommand('markr.pastePreview', async () => {
      const text = await vscode.env.clipboard.readText();
      if (!text.trim()) {
        vscode.window.showInformationMessage('Clipboard is empty — copy some Markdown first.');
        return;
      }
      const doc = await vscode.workspace.openTextDocument({ content: text, language: 'markdown' });
      MarkdownPreviewPanel.createOrShow(doc);
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
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => MarkdownPreviewPanel.refreshFiles(), 250);
  };
  watcher.onDidCreate(refresh);
  watcher.onDidDelete(refresh);
  context.subscriptions.push(watcher);
}

export function deactivate() {}
