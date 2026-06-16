/**
 * configLabRunner.ts — AI Config Lab panel controller + test runner (vscode glue).
 *
 * Owns the webview panel, reads the current AI config file as the instruction
 * source, and runs test prompts through the existing PromptRunner. Pure logic
 * (checks, message building, redaction, storage) lives in configLab.ts /
 * configLabStore.ts.
 *
 * Security: nothing is sent until the user clicks Run; the config + prompt are
 * redacted before sending; API keys stay in SecretStorage (via PromptRunner).
 */
import * as vscode from 'vscode';
import * as path   from 'path';
import * as crypto from 'crypto';
import { PromptRunner, MODELS, Provider } from './promptRunner';
import {
  loadTestsFile, saveTestsFile, upsertTest, deleteTest, getTestsForConfig,
  type ConfigTestCase,
} from './configLabStore';
import { buildMessages, evaluateChecks, summarizeResult, hashConfig, regressionDelta } from './configLab';
import { buildConfigLabHtml } from './webview/configLabHtml';

export class ConfigLabPanel {
  private static current?: ConfigLabPanel;

  private constructor(
    private readonly panel:   vscode.WebviewPanel,
    private readonly runner:  PromptRunner,
    private readonly root:    string,        // workspace root fsPath
    private readonly cfgUri:  vscode.Uri,    // the AI config file
    private readonly cfgPath: string,        // workspace-relative POSIX
  ) {
    panel.webview.html = buildConfigLabHtml();
    panel.onDidDispose(() => { if (ConfigLabPanel.current === this) ConfigLabPanel.current = undefined; });
    panel.webview.onDidReceiveMessage(m => this._onMessage(m));
  }

  static show(context: vscode.ExtensionContext, runner: PromptRunner) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      vscode.window.showInformationMessage('Markr: open an AI config file (CLAUDE.md, AGENTS.md, .cursorrules…) first, then run AI Config Lab.');
      return;
    }
    const cfgUri = editor.document.uri;
    const folder = vscode.workspace.getWorkspaceFolder(cfgUri) ?? vscode.workspace.workspaceFolders?.[0];
    const root = folder?.uri.fsPath ?? path.dirname(cfgUri.fsPath);
    const cfgPath = path.relative(root, cfgUri.fsPath).replace(/\\/g, '/');

    if (ConfigLabPanel.current) {
      ConfigLabPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      // Re-target if a different config is active.
      if (ConfigLabPanel.current.cfgUri.fsPath !== cfgUri.fsPath) {
        ConfigLabPanel.current = new ConfigLabPanel(ConfigLabPanel.current.panel, runner, root, cfgUri, cfgPath);
        ConfigLabPanel.current._sendState();
      }
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'markrConfigLab', 'AI Config Lab', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true },
    );
    ConfigLabPanel.current = new ConfigLabPanel(panel, runner, root, cfgUri, cfgPath);
  }

  // ── Messages ────────────────────────────────────────────────────────────
  private async _onMessage(msg: Record<string, unknown>) {
    try {
      switch (msg.type) {
        case 'ready':       return this._sendState();
        case 'addTest':     return this._addTest();
        case 'saveTest':    return this._saveTest(msg.test as ConfigTestCase);
        case 'deleteTest':  return this._deleteTest(String(msg.id));
        case 'runTest':     return this._runTest(String(msg.id), String(msg.provider), String(msg.model));
        case 'runAll':      return this._runAll();
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Markr Config Lab: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private _post(m: Record<string, unknown>) {
    try { this.panel.webview.postMessage(m); } catch { /* disposed */ }
  }

  private async _sendState() {
    const tests = getTestsForConfig(loadTestsFile(this.root), this.cfgPath);
    let providers: Provider[] = [];
    try { providers = await this.runner.configuredProviders(); } catch { /* none */ }
    const configHash = hashConfig(await this._currentConfigText());
    this._post({
      type: 'state',
      state: {
        configPath: this.cfgPath,
        configHash,                 // webview marks a test "stale" if its lastRun hash differs
        tests,
        providers,
        models: MODELS.map(m => ({ id: m.id, label: m.label, provider: m.provider })),
        hasKey: providers.length > 0,
      },
    });
  }

  private _addTest() {
    const test: ConfigTestCase = {
      id: crypto.randomUUID(), name: 'New test', prompt: '',
      expectedBehavior: '', mustInclude: [], mustNotInclude: [],
    };
    const file = upsertTest(loadTestsFile(this.root), this.cfgPath, test);
    saveTestsFile(this.root, file);
    this._sendState();
  }

  private _saveTest(test: ConfigTestCase) {
    if (!test || !test.id) return;
    const file = upsertTest(loadTestsFile(this.root), this.cfgPath, test);
    saveTestsFile(this.root, file);
    this._sendState();
  }

  private _deleteTest(id: string) {
    const file = deleteTest(loadTestsFile(this.root), this.cfgPath, id);
    saveTestsFile(this.root, file);
    this._sendState();
  }

  /** Read the CURRENT config text (incl. unsaved editor edits if open). */
  private async _currentConfigText(): Promise<string> {
    try {
      const doc = await vscode.workspace.openTextDocument(this.cfgUri);
      return doc.getText();
    } catch {
      return '';
    }
  }

  private async _runTest(id: string, provider: string, model: string): Promise<'regressed' | 'fixed' | 'unchanged' | 'new' | null> {
    const test = getTestsForConfig(loadTestsFile(this.root), this.cfgPath).find(t => t.id === id);
    if (!test) return null;
    const prevStatus = test.lastRun?.status;

    const providers = await this.runner.configuredProviders();
    if (!providers.length) {
      this._post({ type: 'runError', id, error: 'No AI provider key configured. Add one via the ▶ Run button in a Markr preview.' });
      return null;
    }
    const prov = (providers.includes(provider as Provider) ? provider : providers[0]) as Provider;
    const mdl = model || MODELS.find(m => m.provider === prov)?.id || '';

    const configText = await this._currentConfigText();
    const built = buildMessages(configText, this.cfgPath, test);

    this._post({ type: 'runStart', id });
    let output = '';
    await new Promise<void>((resolve) => {
      this.runner.streamRun(
        { provider: prov, model: mdl, systemPrompt: built.systemPrompt, messages: built.messages },
        (chunk) => { output += chunk; this._post({ type: 'runChunk', id, text: chunk }); },
        () => resolve(),
        (err) => { this._post({ type: 'runError', id, error: err }); resolve(); },
      ).catch((e) => { this._post({ type: 'runError', id, error: String(e) }); resolve(); });
    });

    if (!output) return null;

    const checks = evaluateChecks(output, test);
    const { status, summary } = summarizeResult({ output, checks });
    const delta = regressionDelta(prevStatus, status);

    // Persist the result + the config it ran against (for stale/regression UI).
    const configHash = hashConfig(configText);
    test.lastRun = { status, at: Date.now(), configHash };
    saveTestsFile(this.root, upsertTest(loadTestsFile(this.root), this.cfgPath, test));

    this._post({ type: 'runDone', id, output, status, summary, redactions: built.redactions, regression: delta, configHash });
    return delta;
  }

  private async _runAll() {
    const tests = getTestsForConfig(loadTestsFile(this.root), this.cfgPath);
    let regressed = 0, fixed = 0;
    for (const t of tests) {
      const delta = await this._runTest(t.id, t.provider ?? '', t.model ?? '');
      if (delta === 'regressed') regressed++;
      else if (delta === 'fixed') fixed++;
    }
    this._post({ type: 'runAllDone', total: tests.length, regressed, fixed });
  }
}
