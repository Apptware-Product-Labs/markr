import * as vscode from 'vscode';
import * as path from 'path';
import { MarkdownPreviewPanel } from './preview';
import { MarkrExplorerProvider, AI_CONFIG_TEMPLATES } from './markrExplorer';
import { ContextComposer } from './contextComposer';
import { PromptRunner, MODELS } from './promptRunner';
import { PromptHistoryManager } from './promptHistory';
import { TokenDecorationProvider } from './tokenDecorations';

export async function activate(context: vscode.ExtensionContext) {

  // ── Core modules ───────────────────────────────────────────────────────────
  const contextComposer  = new ContextComposer();
  const promptRunner     = new PromptRunner(context.secrets);
  const promptHistory    = new PromptHistoryManager(context);
  const tokenDecorations = new TokenDecorationProvider();
  context.subscriptions.push(tokenDecorations);

  // ── Activity Bar Explorer ──────────────────────────────────────────────────
  const explorerProvider = new MarkrExplorerProvider();
  const treeView = vscode.window.createTreeView('markrExplorer', {
    treeDataProvider: explorerProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ── Commands ───────────────────────────────────────────────────────────────

  // openPreview: smart fallback — if no .md file is active, show workspace quick-pick
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.openPreview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.languageId === 'markdown') {
        MarkdownPreviewPanel.createOrShow(editor.document);
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
    })
  );

  // openFile: called from tree view item click or context menu
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.openFile', async (uri: vscode.Uri) => {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        MarkdownPreviewPanel.createOrShow(doc);
      } catch (e) {
        vscode.window.showErrorMessage(`Markr: could not open file — ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );

  // newAiConfig: wizard to create a new AI config file from a template
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.newAiConfig', async () => {
      // Step 1: pick type
      const typeOptions = Object.entries(AI_CONFIG_TEMPLATES).map(([key, t]) => ({
        label: `$(star) ${t.filename}`,
        description: t.description,
        detail: `Creates ${t.filename} with a starter template`,
        key,
        filename: t.filename,
        kind: t.kind,
        template: t.template,
      }));
      const customOption = {
        label: '$(file-add) Custom name…',
        description: 'Create a new Markdown file with a custom name',
        detail: 'You will be prompted for the filename',
        key: '__custom__',
        filename: '',
        kind: '',
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

  // ── Context Composer ──────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.refreshContext', async () => {
      const active = vscode.window.activeTextEditor?.document.uri;
      const summary = await contextComposer.discover(active);
      MarkdownPreviewPanel.currentPanel?.postMessage({ type: 'contextSummary', summary });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markr.copyMergedContext', async () => {
      const active = vscode.window.activeTextEditor?.document.uri;
      const summary = await contextComposer.discover(active);
      // Get selected files (default: all selected)
      const merged = contextComposer.mergeContext(summary.files);
      await vscode.env.clipboard.writeText(merged);
      vscode.window.setStatusBarMessage(`$(check) Markr: merged context copied (${summary.files.filter(f => f.selected).length} files)`, 3000);
    })
  );

  // ── Prompt Runner ──────────────────────────────────────────────────────────
  // Set an API key for a provider
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.setApiKey', async (provider?: string) => {
      const providerOptions = [
        { label: '$(anthropic) Anthropic (Claude)', value: 'anthropic' },
        { label: '$(symbol-misc) OpenAI (GPT-4o / o3)', value: 'openai' },
        { label: '$(globe) Google (Gemini)', value: 'google' },
      ];
      let chosen = provider;
      if (!chosen) {
        const picked = await vscode.window.showQuickPick(providerOptions, { placeHolder: 'Which provider?' });
        if (!picked) return;
        chosen = picked.value;
      }
      const key = await vscode.window.showInputBox({
        prompt:      `Paste your ${chosen} API key`,
        placeHolder: 'sk-... or sk-ant-... or AIza...',
        password:    true,
        ignoreFocusOut: true,
        validateInput: v => v && v.length > 10 ? null : 'Key seems too short',
      });
      if (!key) return;
      await promptRunner.setKey(chosen as 'anthropic' | 'openai' | 'google', key);
      vscode.window.showInformationMessage(`✓ ${chosen} API key saved securely`);
      // Refresh models list in any open Markr panel so the setup screen clears
      if (MarkdownPreviewPanel.onGetModels) MarkdownPreviewPanel.onGetModels();
    })
  );

  // Handle prompt run requests from the webview
  // The webview sends { type: 'promptRun', provider, model, systemPrompt, messages }
  // We stream back chunks via postMessage
  MarkdownPreviewPanel.onPromptRun = async (msg: {
    provider: 'anthropic' | 'openai' | 'google';
    model: string;
    systemPrompt: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) => {
    const panel = MarkdownPreviewPanel.currentPanel;
    if (!panel) return;

    // Check if key exists; if not, prompt to set it
    const hasKey = await promptRunner.hasKey(msg.provider);
    if (!hasKey) {
      const action = await vscode.window.showInformationMessage(
        `No ${msg.provider} API key found. Add one to use the Prompt Runner.`,
        'Add key', 'Cancel'
      );
      if (action === 'Add key') {
        await vscode.commands.executeCommand('markr.setApiKey', msg.provider);
      }
      panel.postMessage({ type: 'promptError', error: 'No API key configured. Add one via the key icon.' });
      return;
    }

    panel.postMessage({ type: 'promptStart' });

    const safePost = (msg2: object) => { try { panel.postMessage(msg2); } catch { /* panel disposed */ } };
    const modelObj = MODELS.find(m => m.id === msg.model);
    const runId    = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const startMs  = Date.now();

    // Accumulate full assistant response for history storage
    let fullResponse = '';

    await promptRunner.streamRun(
      { provider: msg.provider, model: msg.model, systemPrompt: msg.systemPrompt, messages: msg.messages },
      (text) => { fullResponse += text; safePost({ type: 'promptChunk', text }); },
      async () => {
        safePost({ type: 'promptDone' });
        // Save the completed run to history (non-blocking)
        const p = MarkdownPreviewPanel.currentPanel;
        const docUri  = p?.['_document']?.uri;
        const relPath = docUri ? vscode.workspace.asRelativePath(docUri) : '';
        await promptHistory.save({
          id:           runId,
          timestamp:    startMs,
          file:         docUri?.path.split('/').pop() ?? '',
          relPath,
          model:        msg.model,
          modelLabel:   modelObj?.label ?? msg.model,
          provider:     msg.provider,
          systemPrompt: msg.systemPrompt,
          messages:     [...msg.messages, { role: 'assistant', content: fullResponse }],
          durationMs:   Date.now() - startMs,
        });
        // Refresh history count in webview
        safePost({ type: 'historyCount', count: promptHistory.getAll().length });
      },
      (err) => safePost({ type: 'promptError', error: err }),
    );
  };

  // Expose models list to webview on request
  MarkdownPreviewPanel.onGetModels = async () => {
    const configured = await promptRunner.configuredProviders();
    MarkdownPreviewPanel.currentPanel?.postMessage({ type: 'modelsList', models: MODELS, configured });
  };

  // History: get all runs for the current file
  MarkdownPreviewPanel.onGetHistory = async (relPath?: string) => {
    const runs = relPath ? promptHistory.getForFile(relPath) : promptHistory.getAll();
    MarkdownPreviewPanel.currentPanel?.postMessage({ type: 'historyData', runs });
  };

  // Clear history
  context.subscriptions.push(
    vscode.commands.registerCommand('markr.clearPromptHistory', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all Markr prompt history for this workspace?', 'Clear', 'Cancel'
      );
      if (confirm === 'Clear') {
        await promptHistory.clear();
        MarkdownPreviewPanel.currentPanel?.postMessage({ type: 'historyCount', count: 0 });
        vscode.window.showInformationMessage('Prompt history cleared.');
      }
    })
  );

  // ── Document listeners ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (document.languageId === 'markdown') MarkdownPreviewPanel.update(document);
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor?.document.languageId === 'markdown') MarkdownPreviewPanel.update(editor.document);
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

  // ── File watcher ───────────────────────────────────────────────────────────
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      MarkdownPreviewPanel.refreshFiles();
      explorerProvider.refresh();  // also refresh the Activity Bar tree
    }, 300);
  };
  watcher.onDidCreate(refresh);
  watcher.onDidDelete(refresh);
  context.subscriptions.push(watcher);
}

export function deactivate() {}
