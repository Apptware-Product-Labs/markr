import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MarkdownPreviewPanel } from './preview';
import { MarkrExplorerProvider, MarkrFileItem, AI_CONFIG_TEMPLATES } from './markrExplorer';
import { MarkrTokenLensProvider, MarkrTokenDecorations } from './tokenLens';
import { countTokens, detectModel } from './tokenEngine';
import { ContextBridgeViewProvider } from './contextBridge';
import { analyzeAiWorkspace, buildAiConfigBundle, buildAiHealthMarkdown } from './aiConfigAnalyzer';

export async function activate(context: vscode.ExtensionContext) {

  // ── Activity Bar Explorer ──────────────────────────────────────────────────
  const explorerProvider = new MarkrExplorerProvider();
  const treeView = vscode.window.createTreeView('markrExplorer', {
    treeDataProvider: explorerProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ── Context Bridge sidebar view ────────────────────────────────────────────
  // Lives under markr-sidebar container as a collapsible WebviewView section.
  // When collapsed → markrExplorer expands to fill the space (Source-Control style).
  const contextBridgeProvider = new ContextBridgeViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ContextBridgeViewProvider.viewType,
      contextBridgeProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markr.openContextBridge', () => {
      vscode.commands.executeCommand('markrContextBridge.focus');
    }),
    vscode.commands.registerCommand('markr.refreshContextBridge', () => {
      contextBridgeProvider.refresh();
    }),
    vscode.commands.registerCommand('markr.openAiHealth', async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Markr: checking AI config health...', cancellable: false },
        async () => {
          const report = await analyzeAiWorkspace();
          await MarkdownPreviewPanel.showClipboard(buildAiHealthMarkdown(report));
        },
      );
    }),
    vscode.commands.registerCommand('markr.copyAiConfigBundle', async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Markr: building AI workspace bundle...', cancellable: false },
        async () => {
          const report = await analyzeAiWorkspace();
          const bundle = await buildAiConfigBundle(report);
          await vscode.env.clipboard.writeText(bundle);
          const action = await vscode.window.showInformationMessage(
            `Markr copied an AI workspace bundle (${bundle.length.toLocaleString()} chars).`,
            'Preview',
          );
          if (action === 'Preview') {
            await MarkdownPreviewPanel.showClipboard(bundle);
          }
        },
      );
    }),
  );

  // ── AI Sessions status bar item ────────────────────────────────────────────
  // Right side — shows active session count + context-limit warnings.
  // Click → opens the Context Bridge panel.
  const sbAi = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
  sbAi.command  = 'markr.openContextBridge';
  sbAi.tooltip  = 'AI Sessions — click to open Context Bridge';
  context.subscriptions.push(sbAi);

  function updateAiStatusBar() {
    try {
      const { activeSessions, warnings } = contextBridgeProvider.getStatusSummary();
      if (activeSessions.length || warnings.length) {
        const toolLabels = [...new Set(activeSessions.map(s => {
          const map: Record<string, string> = {
            'claude-code': 'Claude', codex: 'Codex', cursor: 'Cursor',
            aider: 'Aider', augment: 'Augment',
          };
          return map[s.tool] ?? s.tool;
        }))];
        const count = activeSessions.length;
        sbAi.text = warnings.length
          ? `$(warning) AI ${count || warnings.length}`
          : `$(sparkle) AI ${count}`;
        sbAi.tooltip = [
          'Markr Context Bridge',
          count ? `${count} active session${count === 1 ? '' : 's'}${toolLabels.length ? `: ${toolLabels.join(', ')}` : ''}` : '',
          warnings.length ? `Context warnings: ${warnings.join(', ')}` : '',
          'Click to open Context Bridge',
        ].filter(Boolean).join('\n');
        sbAi.backgroundColor = warnings.length
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;
        sbAi.show();
      } else {
        sbAi.hide();
      }
    } catch {
      sbAi.hide();
    }
  }

  // Refresh status bar every 30 s to stay in sync with session changes
  const aiBarTimer = setInterval(updateAiStatusBar, 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(aiBarTimer) });
  // Initial update after a short delay (provider needs to load sessions first).
  // Track the timer so deactivation within 3 s doesn't fire on a disposed context.
  const aiBarInitTimer = setTimeout(updateAiStatusBar, 3_000);
  context.subscriptions.push({ dispose: () => clearTimeout(aiBarInitTimer) });

  /** Reveal and highlight the given URI in the Activity Bar. Shows the Markr panel. */
  function revealInExplorer(uri: vscode.Uri): void {
    const uriStr = uri.toString();
    // Mark as active (adds ◉ indicator and updates icon colour)
    explorerProvider.setActiveFile(uriStr);
    // Bring the Markr sidebar into view so the user sees it
    vscode.commands.executeCommand('workbench.view.extension.markr-sidebar').then(() => {
      const entry = explorerProvider.getFiles().find(f => f.uri.toString() === uriStr);
      if (!entry) return;
      // Pass active=true so the revealed item has the highlight icon
      Promise.resolve(treeView.reveal(new MarkrFileItem(entry, true), { select: true, focus: false })).catch(() => {});
    }, () => {});
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  // openPreview: smart fallback — if no .md file is active, show workspace quick-pick
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.openPreview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.languageId === 'markdown') {
        MarkdownPreviewPanel.createOrShow(editor.document);
        revealInExplorer(editor.document.uri);
        return;
      }
      // No markdown file active — show workspace picker
      const wsFolders = vscode.workspace.workspaceFolders;
      if (!wsFolders?.length) {
        vscode.window.showInformationMessage('Open a workspace or a Markdown file to use Markr.');
        return;
      }
      const maxFiles = vscode.workspace.getConfiguration('markr').get<number>('maxWorkspaceFiles', 500);
      const uris = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Markr: scanning workspace…', cancellable: false },
        () => vscode.workspace.findFiles('**/*.md', '{**/node_modules/**,**/.git/**,**/.next/**,**/dist/**}', maxFiles)
      );
      if (!uris.length) {
        const action = await vscode.window.showInformationMessage(
          'No Markdown files found. Create an AI config?', 'New AI Config', 'Dismiss'
        );
        if (action === 'New AI Config') vscode.commands.executeCommand('markr.newAiConfig');
        return;
      }
      // Sort: AI config names first (alphabetically), then regular docs
      const AI_NAMES = new Set(['claude.md','claude.local.md','.cursorrules','copilot-instructions.md','agent.md','agents.md','skill.md','skills.md','system-prompt.md','prompt.md','prompts.md','instructions.md','rules.md']);
      uris.sort((a, b) => {
        const an = path.basename(a.fsPath).toLowerCase();
        const bn = path.basename(b.fsPath).toLowerCase();
        const aAi = AI_NAMES.has(an) ? 0 : 1;
        const bAi = AI_NAMES.has(bn) ? 0 : 1;
        if (aAi !== bAi) return aAi - bAi;
        return vscode.workspace.asRelativePath(a).localeCompare(vscode.workspace.asRelativePath(b));
      });
      const items = uris.map(uri => ({
        label: path.basename(uri.fsPath),
        description: vscode.workspace.asRelativePath(uri),
        uri,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Open a Markdown file in Markr…',
        matchOnDescription: true,
      });
      if (!picked) return;
      const doc = await vscode.workspace.openTextDocument(picked.uri);
      MarkdownPreviewPanel.createOrShow(doc);
      revealInExplorer(picked.uri);
    })
  );

  // openFile: called from tree view item click or context menu
  // Handles both markdown AND non-markdown AI configs (mcp.json, .env, etc.)
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.openFile', async (uri: vscode.Uri) => {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        MarkdownPreviewPanel.createOrShow(doc);
        revealInExplorer(uri);
      } catch (e) {
        vscode.window.showErrorMessage(`Markr: could not open file — ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );

  // newAiConfig: wizard to create a new AI config file from a template
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.newAiConfig', async () => {
      // Step 1: pick type
      type ConfigPick = vscode.QuickPickItem & {
        key: string;
        filename: string;
        template: string;
      };

      const typeOptions: ConfigPick[] = Object.entries(AI_CONFIG_TEMPLATES).map(([key, t]) => ({
        label: `$(star) ${t.filename}`,
        description: t.description,
        detail: `Creates ${t.filename} with a starter template`,
        key,
        filename: t.filename,
        template: t.template,
      }));
      const customOption: ConfigPick = {
        label: '$(file-add) Custom name…',
        description: 'Create a new Markdown file with a custom name',
        detail: 'You will be prompted for the filename',
        key: '__custom__',
        filename: '',
        template: '',
      };

      const allOptions = [...typeOptions, customOption];

      const picked = await vscode.window.showQuickPick(allOptions, {
        placeHolder: 'Choose an AI config type…',
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!picked) return;

      // Step 2: determine filename
      let filename = picked.filename;
      if (picked.key === '__custom__') {
        const input = await vscode.window.showInputBox({
          prompt: 'Enter filename (e.g. my-prompt.md)',
          placeHolder: 'filename.md',
          validateInput: v =>
            !v?.trim() ? 'Filename cannot be empty' :
            !v.trim().match(/\.(md|txt|yaml|yml|json)$|^\.[a-z]+rules?$|^\.[a-z]+config$/) && !v.trim().includes('.') ?
              'File should have an extension (e.g. .md)' : null,
        });
        if (!input) return;
        filename = input.trim();
      }

      // Step 3: determine target folder
      const wsFolders = vscode.workspace.workspaceFolders;
      let targetFolder: vscode.Uri;
      if (!wsFolders?.length) {
        const result = await vscode.window.showOpenDialog({
          canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
          openLabel: 'Choose folder to create file in',
        });
        if (!result?.[0]) return;
        targetFolder = result[0];
      } else if (wsFolders.length === 1) {
        targetFolder = wsFolders[0].uri;
      } else {
        const folderPick = await vscode.window.showQuickPick(
          wsFolders.map(f => ({ label: f.name, description: f.uri.fsPath, uri: f.uri })),
          { placeHolder: 'Which workspace folder?' }
        );
        if (!folderPick) return;
        targetFolder = folderPick.uri;
      }

      const fileUri = vscode.Uri.joinPath(targetFolder, filename);

      // Step 4: check if file exists
      let fileExists = false;
      try { await vscode.workspace.fs.stat(fileUri); fileExists = true; } catch {}

      if (fileExists) {
        const action = await vscode.window.showWarningMessage(
          `${filename} already exists. Open it in Markr?`, { modal: false }, 'Open', 'Cancel'
        );
        if (action !== 'Open') return;
      } else {
        // Create parent directories if needed (e.g. .github/)
        const parentUri = vscode.Uri.joinPath(fileUri, '..');
        try { await vscode.workspace.fs.createDirectory(parentUri); } catch {}
        // Write template content
        const templateContent = picked.template || `# ${filename.replace(/\.[^.]+$/, '')}\n\n`;
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(templateContent, 'utf-8'));
        // Small delay so the file watcher picks it up before we open
        await new Promise(r => setTimeout(r, 100));
      }

      const doc = await vscode.workspace.openTextDocument(fileUri);
      MarkdownPreviewPanel.createOrShow(doc);
      revealInExplorer(fileUri);
    })
  );

  // openShowcase
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.openShowcase', async () => {
      const uri = vscode.Uri.joinPath(context.extensionUri, 'samples', 'markr-showcase.md');
      const doc = await vscode.workspace.openTextDocument(uri);
      MarkdownPreviewPanel.createOrShow(doc);
    })
  );

  // pastePreview
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.pastePreview', async () => {
      const text = await vscode.env.clipboard.readText();
      if (!text.trim()) {
        vscode.window.showInformationMessage('Clipboard is empty — copy some Markdown first.');
        return;
      }
      await MarkdownPreviewPanel.showClipboard(text);
    })
  );

  // refreshExplorer
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.refreshExplorer', () => {
      explorerProvider.refresh();
    })
  );

  // searchFiles: instant when cache is warm, scans directly when cold
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.searchFiles', async () => {
      // Helper: show the quick-pick from a flat file list
      async function showPick(entries: Array<{ label: string; relPath: string; uri: vscode.Uri; isAiConfig: boolean; aiKind: string }>) {
        if (!entries.length) {
          vscode.window.showInformationMessage('No Markdown files found in workspace.');
          return;
        }
        const sorted = [...entries].sort((a, b) => {
          if (a.isAiConfig !== b.isAiConfig) { return a.isAiConfig ? -1 : 1; }
          return a.relPath.localeCompare(b.relPath);
        });
        const items = sorted.map(f => ({
          label: (f.isAiConfig ? '$(star) ' : '$(file) ') + f.label,
          description: f.relPath,
          detail: f.aiKind ? `✦ ${f.aiKind}` : undefined,
          uri: f.uri,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Search Markdown & AI config files…',
          matchOnDescription: true,
          matchOnDetail: true,
        });
        if (!picked) { return; }
        const doc = await vscode.workspace.openTextDocument(picked.uri);
        MarkdownPreviewPanel.createOrShow(doc);
      }

      // Use cached files immediately if available (instant, no scan needed)
      const cached = explorerProvider.getFiles();
      if (cached.length > 0) { await showPick(cached); return; }

      // Cache is cold — scan directly so the user never sees an empty picker
      const maxFiles = vscode.workspace.getConfiguration('markr').get<number>('maxWorkspaceFiles', 500);
      const exclude = '{**/node_modules/**,**/.git/**,**/.vscode/**,**/.next/**,**/out/**,**/dist/**,**/build/**,**/coverage/**}';
      const uris = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Markr: finding files…', cancellable: false },
        () => vscode.workspace.findFiles('**/*.md', exclude, maxFiles),
      );
      const { AI_CONFIG_NAMES, aiDocKindExplorer } = await import('./markrExplorer');
      const entries = uris.map(uri => {
        const label   = path.basename(uri.fsPath);
        const relPath = vscode.workspace.asRelativePath(uri);
        const lower   = label.toLowerCase();
        const isAiConfig = AI_CONFIG_NAMES.has(lower) || /^claude(\.local)?\.md$/i.test(lower);
        return { label, relPath, uri, isAiConfig, aiKind: aiDocKindExplorer(label, relPath) };
      });
      await showPick(entries);
    })
  );

  // ── Optional: auto-open AI config files in Markr ─────────────────────────
  // OFF by default — users opt in via markr.autoOpenAiConfigs setting.
  // When ON: opening CLAUDE.md / .cursorrules / agent.md etc. automatically
  // opens Markr alongside the text editor (Beside column).
  // The text editor stays open — the user controls their own layout.
  const { AI_CONFIG_NAMES: AI_NAMES_AUTO } = await import('./markrExplorer');
  let _autoOpenTimer: ReturnType<typeof setTimeout> | undefined;
  let _suppressAutoClose = false;

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async editor => {
      if (_suppressAutoClose) return;
      // Only run when the setting is explicitly enabled by the user
      const cfg = vscode.workspace.getConfiguration('markr');
      if (!cfg.get<boolean>('autoOpenAiConfigs', false)) return;

      if (!editor || editor.document.languageId !== 'markdown') return;
      const doc = editor.document;
      if (doc.uri.scheme !== 'file') return;
      const filename = path.basename(doc.uri.fsPath).toLowerCase();
      const isAiConfig = AI_NAMES_AUTO.has(filename) || /^claude(\.local)?\.md$/i.test(filename);
      if (!isAiConfig) return;

      clearTimeout(_autoOpenTimer);
      _autoOpenTimer = setTimeout(() => {
        // Open Markr Beside the text editor — both stay open, user controls layout
        const current = MarkdownPreviewPanel.currentPanel;
        if (!current || current['_document']?.uri.toString() !== doc.uri.toString()) {
          MarkdownPreviewPanel.createOrShow(doc); // uses Beside column — text editor stays
        }
      }, 250);
    })
  );

  // Expose the suppress flag so the Source button in Markr can set it temporarily
  MarkdownPreviewPanel.setSuppressAutoClose = (val: boolean) => {
    _suppressAutoClose = val;
    if (val) { setTimeout(() => { _suppressAutoClose = false; }, 2000); }
  };

  // ── Document listeners ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (document.languageId === 'markdown') MarkdownPreviewPanel.update(document);
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor?.document.languageId === 'markdown') {
        MarkdownPreviewPanel.followEditor(editor.document);
        explorerProvider.setActiveFile(editor.document.uri.toString());
      }
    }),
    vscode.window.onDidChangeTextEditorSelection(event => {
      const cfg = vscode.workspace.getConfiguration('markr');
      if (!cfg.get<boolean>('scrollSync', true)) return;
      if (event.textEditor.document.languageId === 'markdown') {
        const line = event.selections[0].active.line;
        MarkdownPreviewPanel.syncScroll(event.textEditor.document, line);
      }
    })
  );

  // ── Token Lens ────────────────────────────────────────────────────────────────
  // CodeLens: file-level summary at top (total tokens, model, context %)
  // Decorations: colored inline text after each heading (section tok, % of file)
  const tokenLens = new MarkrTokenLensProvider();
  const tokenDeco = new MarkrTokenDecorations(context);

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [{ language: 'markdown' }, { pattern: '**/.cursorrules' }, { pattern: '**/.windsurfrules' }],
      tokenLens,
    ),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      tokenLens.scheduleRefresh();
      tokenDeco.update(editor);
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.languageId === 'markdown') {
        tokenLens.scheduleRefresh();
        const editor = vscode.window.activeTextEditor;
        if (editor?.document === e.document) tokenDeco.scheduleUpdate(editor);
      }
    }),
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.languageId === 'markdown') {
        tokenLens.scheduleRefresh();
        const editor = vscode.window.activeTextEditor;
        if (editor?.document === doc) tokenDeco.update(editor);
      }
    }),
  );
  // Apply to whatever file is already open when the extension activates
  tokenDeco.update(vscode.window.activeTextEditor);

  // ── Status bar token count ────────────────────────────────────────────────
  // Shows ⬡ 8.4K tok in the bottom bar whenever a markdown file is active.
  // Clicking it opens the file in Markr.
  const statusBarTok = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  statusBarTok.command = 'markr.openPreview';
  statusBarTok.tooltip = 'Open in Markr';
  context.subscriptions.push(statusBarTok);

  function updateStatusBar(editor?: vscode.TextEditor) {
    if (!editor || editor.document.languageId !== 'markdown') {
      statusBarTok.hide(); return;
    }
    const doc    = editor.document;
    const text   = doc.getText();
    const model  = detectModel(path.basename(doc.uri.fsPath), vscode.workspace.asRelativePath(doc.uri));
    const tokens = countTokens(text, model);
    const fmt    = tokens >= 10_000 ? Math.round(tokens / 1_000) + 'K' : tokens >= 1_000 ? (tokens / 1_000).toFixed(1) + 'K' : String(tokens);
    statusBarTok.text = `⬡ ${fmt} tok`;
    statusBarTok.show();
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(e => updateStatusBar(e)),
    vscode.workspace.onDidChangeTextDocument(e => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document === e.document) updateStatusBar(editor);
    }),
  );
  updateStatusBar(vscode.window.activeTextEditor);

  // ── File watcher ───────────────────────────────────────────────────────────
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const debouncedRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { MarkdownPreviewPanel.refreshFiles(); }, 400);
  };
  // Incremental add/remove keeps the Activity Bar responsive (no full re-scan)
  watcher.onDidCreate(uri => { explorerProvider.addFile(uri);    debouncedRefresh(); });
  watcher.onDidDelete(uri => { explorerProvider.removeFile(uri); debouncedRefresh(); });
  context.subscriptions.push(watcher);
}

export function deactivate() {}
