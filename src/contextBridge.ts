/**
 * contextBridge.ts — VS Code sidebar WebviewViewProvider for Context Bridge
 *
 * Architecture:
 *   • The HTML shell is set ONCE on resolveWebviewView — no page reloads.
 *   • Session data is delivered via postMessage so the UI updates in-place.
 *   • User's scope/filter preference is persisted via vsc.getState/setState
 *     so it survives the 30 s auto-refresh without resetting.
 *   • getStatusSummary() reads this._sessions for the status-bar item.
 */

import * as vscode   from 'vscode';
import * as nodePath from 'path';
import {
  readAllSessions, readAllSessionsWithHealth, ToolHealth, SessionInfo, AiTool,
  generateHandoff, summariseSession, mineSessionResiduals, gatherSessionText, TargetTool,
} from './sessionReader';
import { MarkdownPreviewPanel } from './preview';
import { MemoryStore, MemoryItem } from './memoryStore';
import {
  buildAddSuggestions, detectDeadRules, splitConfigSections, ConfigSuggestion,
} from './configSuggester';
import { PromptRunner } from './promptRunner';
import { detectModel, countTokens } from './tokenEngine';
import { computeScoreboard, scoreboardToMarkdown, MemoryFact } from './scoreboard';
import { buildScoreboardHtml } from './webview/scoreboardHtml';
import {
  targetFileFor, upsertHandoffBlock, markBlockConsumed, markWholeConsumed, shapeWholeFile,
} from './handoffTargets';
import * as nodeFs from 'fs';
import * as nodeOs from 'os';

// ─── Context-window limits per tool (conservative) ───────────────────────────
const CTX_LIMITS: Record<AiTool, number> = {
  'claude-code': 200_000,
  codex:         128_000,
  cursor:        200_000,
  aider:         128_000,
  augment:       200_000,
  cline:         200_000,
  'roo-code':    200_000,
  windsurf:      200_000,
  'gemini-cli':  1_000_000,
};
const TOOL_COLOR: Record<AiTool, string> = {
  'claude-code': '#F97316',
  codex:         '#16a34a',
  cursor:        '#EA580C',
  aider:         '#d97706',
  augment:       '#B45309',
  cline:         '#0ea5e9',
  'roo-code':    '#8b5cf6',
  windsurf:      '#06b6d4',
  'gemini-cli':  '#4285F4',
};
const TOOL_LABEL: Record<AiTool, string> = {
  'claude-code': 'Claude',
  codex:         'Codex',
  cursor:        'Cursor',
  aider:         'Aider',
  augment:       'Augment',
  cline:         'Cline',
  'roo-code':    'Roo',
  windsurf:      'Windsurf',
  'gemini-cli':  'Gemini',
};
const HANDOFF_TARGETS: TargetTool[] = ['claude-code', 'cursor', 'augment', 'codex', 'chatgpt', 'clipboard'];

function isTargetTool(value: unknown): value is TargetTool {
  return typeof value === 'string' && HANDOFF_TARGETS.includes(value as TargetTool);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class ContextBridgeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'markrContextBridge';

  private _view?:         vscode.WebviewView;
  private _sessions:      SessionInfo[] = [];
  private _refreshTimer?: ReturnType<typeof setInterval>;
  private _memory:        MemoryStore;
  private _runner:        PromptRunner;
  private _context:       vscode.ExtensionContext;
  private _suggestions:   ConfigSuggestion[] = [];

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    this._memory  = new MemoryStore(vscode.Uri.joinPath(context.globalStorageUri, 'memory').fsPath);
    this._runner  = new PromptRunner(context.secrets);
  }

  resolveWebviewView(
    webviewView:   vscode.WebviewView,
    _ctx:          vscode.WebviewViewResolveContext,
    _token:        vscode.CancellationToken,
  ) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    // ── Set the shell HTML exactly once. Never replace it again. ──────────
    // Sessions arrive via postMessage so the page never reloads, and the
    // user's selected scope/filter (persisted in vsc.getState) survive refreshes.
    webviewView.webview.html = buildShellHtml();

    // ── DO NOT call _loadAndPost() here. ─────────────────────────────────
    // The webview JS may not have registered window.addEventListener('message')
    // yet when we set webview.html — the message would be dropped silently.
    // Instead the webview fires { type: 'ready' } as its very first postMessage,
    // and we send the first batch of data only then.

    // Auto-refresh every 30 s — sends new data without touching the page
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = setInterval(() => this._loadAndPost(), 30_000);

    webviewView.onDidDispose(() => {
      if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = undefined; }
      this._view = undefined;
    });

    // ── Messages from the webview ─────────────────────────────────────────
    webviewView.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      // 'ready' fires when the webview JS has finished bootstrapping and its
      // message listener is live — safe to send the first data payload now.
      if (msg.type === 'ready' || msg.type === 'refresh') {
        this._loadAndPost();
        return;
      }
      if (msg.type === 'getMemory') {
        this._postMemory();
        return;
      }
      if (msg.type === 'dismissMemory' && typeof msg.id === 'string') {
        this._memory.setStatus(msg.id, 'dismissed');
        this._postMemory(typeof msg.query === 'string' ? msg.query : '');
        return;
      }
      if (msg.type === 'searchMemory') {
        this._postMemory(typeof msg.query === 'string' ? msg.query : '');
        return;
      }
      if (msg.type === 'dismissSuggestion' && typeof msg.id === 'string') {
        this._memory.setSuggestionStatus(msg.id, 'dismissed');
        this._suggestions = this._suggestions.filter(s => s.id !== msg.id);
        this._postMemory();
        return;
      }
      if (msg.type === 'acceptSuggestion' && typeof msg.id === 'string') {
        await this._acceptSuggestion(msg.id);
        return;
      }
      if (msg.type === 'getHistory') {
        this._postHistory();
        return;
      }
      if ((msg.type === 'copyHandoff' || msg.type === 'viewHandoff') && typeof msg.ts === 'number') {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const entry = this._memory.getHandoffs(ws).find(h => h.timestamp === msg.ts);
        if (!entry) return;
        if (msg.type === 'copyHandoff') {
          await vscode.env.clipboard.writeText(entry.text);
          vscode.window.showInformationMessage('Markr: handoff copied again.');
        } else {
          await MarkdownPreviewPanel.showClipboard(entry.text);
        }
        return;
      }
      if (msg.type === 'openAiHealth') {
        vscode.commands.executeCommand('markr.openAiHealth');
        return;
      }
      if (msg.type === 'copyAiConfigBundle') {
        vscode.commands.executeCommand('markr.copyAiConfigBundle');
        return;
      }
      if (msg.type === 'handoff') {
        const session = this._sessions.find(s => s.id === msg.id);
        if (!session) {
          this._post({ type: 'handoffFailed', error: 'Session not found. Refresh and try again.' });
          return;
        }
        if (!isTargetTool(msg.target)) {
          this._post({ type: 'handoffFailed', id: session.id, error: 'Unsupported handoff target.' });
          return;
        }

        const target = msg.target;
        try {
          // Seed the handoff from persisted memory of earlier sessions in this
          // project: active dead-ends/constraints seen ≥2× or in this session.
          const seed = this._seedFor(session);
          const ctx  = summariseSession(session, seed);
          const meta: { redactions?: number } = {};
          const text = generateHandoff(ctx, session.tool, target, meta);
          await vscode.env.clipboard.writeText(text);
          const redactions = meta.redactions ?? 0;
          this._post({ type: 'handoffDone', id: session.id, target, chars: text.length, redactions });

          // Phase 3: record to history + offer native file delivery.
          try { this._memory.addHandoff(session.projectPath, { timestamp: Date.now(), sourceTool: session.tool, target, text }); } catch { /* best-effort */ }
          await this._writeHandoffToTarget(target, text);

          const LABELS: Record<string, string> = {
            cursor: 'Cursor', 'claude-code': 'Claude Code',
            codex: 'Codex CLI', chatgpt: 'ChatGPT', augment: 'Augment', clipboard: 'Clipboard',
          };
          const redMsg = redactions > 0
            ? ` — ${redactions} secret${redactions > 1 ? 's' : ''} redacted`
            : '';
          const action = await vscode.window.showInformationMessage(
            `Markr handoff copied for ${LABELS[target] ?? target}${redMsg}`,
            'Preview',
          );
          if (action === 'Preview') {
            await MarkdownPreviewPanel.showClipboard(text);
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this._post({ type: 'handoffFailed', id: session.id, error });
          vscode.window.showErrorMessage(`Markr: could not create handoff. ${error}`);
        }
      }
    });
  }

  /** Force a reload (called by markr.refreshContextBridge command) */
  public refresh() { this._loadAndPost(); }

  // ─── AI Scoreboard panel (markr.openScoreboard) ────────────────────────────
  private _scorePanel?: vscode.WebviewPanel;
  private _scoreScope: 'project' | 'all' = 'all';

  public openScoreboard() {
    if (this._scorePanel) {
      this._scorePanel.reveal();
      this._renderScoreboard();
      return;
    }
    this._scorePanel = vscode.window.createWebviewPanel(
      'markrScoreboard', 'AI Scoreboard', vscode.ViewColumn.Active, { enableScripts: true },
    );
    this._scorePanel.onDidDispose(() => { this._scorePanel = undefined; });
    this._scorePanel.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      if (msg.type === 'scope' && (msg.scope === 'project' || msg.scope === 'all')) {
        this._scoreScope = msg.scope;
        this._renderScoreboard();
      } else if (msg.type === 'export') {
        const { data, scopeLabel } = this._scoreboardData();
        await vscode.env.clipboard.writeText(scoreboardToMarkdown(data, scopeLabel));
        vscode.window.showInformationMessage('Markr: scoreboard copied as Markdown (secrets redacted).');
      }
    });
    this._renderScoreboard();
  }

  private _scoreboardData() {
    const wsFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
    const currentWs = wsFolders[0] ?? '';
    // Reuse the sidebar's cached + normalized session list; only hit disk if the
    // sidebar hasn't loaded yet (avoids repeated synchronous JSONL reads on
    // open / scope toggle).
    let all = this._sessions;
    if (!all.length) {
      all = readAllSessions(undefined, wsFolders);
      this._normalizeClaudeProjects(all, wsFolders);
    }
    const inScope = this._scoreScope === 'project' && currentWs
      ? all.filter(s => s.projectPath === currentWs || s.projectPath.startsWith(currentWs + '/'))
      : all;
    const memItems = this._scoreScope === 'project' && currentWs
      ? this._memory.getForProject(currentWs)
      : this._memory.searchAll('');
    const facts: MemoryFact[] = memItems.map(i => ({ kind: i.kind, tool: i.tool }));
    const data = computeScoreboard(inScope, facts, Date.now());
    const projectName = currentWs ? nodePath.basename(currentWs) : '';
    const scopeLabel = this._scoreScope === 'project' ? (projectName || 'This project') : 'All projects';
    return { data, projectName, scopeLabel };
  }

  private _renderScoreboard() {
    if (!this._scorePanel) return;
    const { data, projectName } = this._scoreboardData();
    this._scorePanel.webview.html = buildScoreboardHtml(data, this._scoreScope, projectName);
  }

  /** Active session summary for the status-bar item in extension.ts */
  public getStatusSummary(): { activeSessions: SessionInfo[]; warnings: string[] } {
    const activeSessions = this._sessions.filter(s => s.isActive);
    const warnings: string[] = [];
    for (const s of this._sessions) {
      const limit = CTX_LIMITS[s.tool];
      if (limit && s.tokenCount > limit * 0.8) {
        const pct = Math.round((s.tokenCount / limit) * 100);
        warnings.push(`${TOOL_LABEL[s.tool]} ${pct}%`);
      }
    }
    return { activeSessions, warnings };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private _loadAndPost() {
    if (!this._view) return;
    try {
      const wsFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
      const currentWs = wsFolders[0] ?? '';
      const { sessions, health } = readAllSessionsWithHealth(undefined, wsFolders);

      this._normalizeClaudeProjects(sessions, wsFolders);
      this._sessions = sessions;

      // Update activity-bar badge with live/active session count
      const activeCount = sessions.filter(s => s.isActive).length;
      try {
        this._view.badge = activeCount > 0
          ? { tooltip: `${activeCount} active session${activeCount > 1 ? 's' : ''}`, value: activeCount }
          : undefined;
      } catch { /* badge API not available in this VS Code version */ }

      // Build the payload — keep it lean (no raw message arrays)
      const payload = sessions.map(s => ({
        id:       s.id,
        tool:     s.tool,
        slug:     s.projectSlug,
        title:    s.title,
        ago:      timeAgo(s.lastActive),
        lastActive: s.lastActive,
        tok:      fmtTok(s.tokenCount),
        msgs:     s.messages.length,
        active:   s.isActive,
        current:  currentWs
          ? s.projectPath === currentWs || s.projectPath.startsWith(currentWs + '/')
          : false,
        limitPct: CTX_LIMITS[s.tool]
          ? Math.min(100, Math.round((s.tokenCount / CTX_LIMITS[s.tool]) * 100))
          : 0,
        limitLabel: CTX_LIMITS[s.tool]
          ? `${Math.min(100, Math.round((s.tokenCount / CTX_LIMITS[s.tool]) * 100))}%`
          : '',
      }));

      this._post({
        type:        'sessionsLoaded',
        sessions:    payload,
        projectName: currentWs ? nodePath.basename(currentWs) : '',
        health:      health as ToolHealth[],
      });

      // Phase 3: context-exhaustion watch (status bar handled in extension.ts).
      this._checkExhaustion(sessions);

      // Background memory scan + stale-handoff hygiene — AFTER posting session
      // data so the sidebar is never blocked.
      setTimeout(() => {
        this._scanMemory(sessions, currentWs);
        this._markConsumedIfStale(sessions);
      }, 0);
    } catch (err) {
      // Even on total failure, replace the spinner with an error state
      this._post({
        type:     'sessionsLoaded',
        sessions: [],
        projectName: '',
        error: String(err),
      });
    }
  }

  private _post(message: Record<string, unknown>) {
    try {
      this._view?.webview.postMessage(message);
    } catch { /* view was disposed between scan and post */ }
  }

  /** Fix Claude Code projectPath/projectSlug for open workspaces (slug decoding
   *  is ambiguous for folder names with hyphens). Mutates in place. */
  private _normalizeClaudeProjects(sessions: SessionInfo[], wsFolders: string[]) {
    for (const s of sessions) {
      if (s.tool !== 'claude-code') continue;
      const sessionSlug = nodePath.basename(nodePath.dirname(s.filePath));
      for (const folder of wsFolders) {
        if (sessionSlug === folder.replace(/\//g, '-')) {
          s.projectSlug = nodePath.basename(folder);
          s.projectPath = folder;
          break;
        }
      }
    }
  }

  /** Mine + persist residuals for sessions that changed since the last scan. */
  private _scanMemory(sessions: SessionInfo[], currentWs: string) {
    try {
      let changed = false;
      for (const s of sessions) {
        if (!s.projectPath) continue;
        if (!this._memory.needsScan(s.projectPath, s)) continue;
        try {
          const mined = mineSessionResiduals(s);
          this._memory.addFromSession(s, { decisions: mined.decisions, deadEnds: mined.deadEnds, constraints: mined.constraints });
          changed = true;
        } catch { /* one bad session never breaks the scan */ }
      }
      this._computeSuggestions(currentWs, sessions);
      if (changed || this._suggestions.length) this._postMemory(currentWs);
    } catch { /* memory scan is best-effort */ }
  }

  /** Build config suggestions (add-rules from memory + dead-rule detection). */
  private _computeSuggestions(currentWs: string, sessions: SessionInfo[]) {
    this._suggestions = [];
    if (!currentWs) return;
    try {
      const existing = ['CLAUDE.md', 'AGENTS.md', '.cursorrules']
        .filter(f => { try { return nodeFs.existsSync(nodePath.join(currentWs, f)); } catch { return false; } });
      const target = existing[0] ?? 'CLAUDE.md';
      const model  = detectModel(target);

      const constraints = this._memory.getForProject(currentWs).filter(i => i.kind === 'constraint');
      const add = buildAddSuggestions(constraints, target, model);

      // Dead-rule detection: needs the primary config + ≥10 project transcripts.
      let dead: ConfigSuggestion[] = [];
      const projSessions = sessions.filter(s => s.projectPath === currentWs);
      if (existing.length && projSessions.length >= 10) {
        try {
          const cfgText = nodeFs.readFileSync(nodePath.join(currentWs, existing[0]), 'utf-8');
          const transcripts = projSessions.slice(0, 15).map(s => gatherSessionText(s)).filter(Boolean);
          dead = detectDeadRules(splitConfigSections(cfgText), transcripts, model);
        } catch { /* skip dead-rule on read error */ }
      }

      const state = this._memory.getSuggestionState();
      this._suggestions = [...add, ...dead]
        .filter(s => state[s.id] !== 'accepted' && state[s.id] !== 'dismissed');

      // Notify at most once per day per project when new suggestions appear.
      if (this._suggestions.length) this._maybeNotifySuggestions(currentWs, this._suggestions.length);
    } catch { /* suggestions are best-effort */ }
  }

  private _maybeNotifySuggestions(projectPath: string, count: number) {
    const key = `markr.suggestNotified.${projectPath}`;
    const last = this._context.globalState.get<number>(key) ?? 0;
    const now = Date.now();
    if (now - last < 24 * 60 * 60 * 1000) return;
    this._context.globalState.update(key, now);
    vscode.window.showInformationMessage(
      `Markr: ${count} config suggestion${count > 1 ? 's' : ''} from your recent sessions.`,
      'Open',
    ).then(action => {
      if (action === 'Open') vscode.commands.executeCommand('markrContextBridge.focus');
    });
  }

  /** Post the Memory tab payload (current project, or a cross-project search). */
  private _postMemory(query = '') {
    const wsFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
    const currentWs = wsFolders[0] ?? '';
    let items: Array<MemoryItem & { projectPath?: string }>;
    if (query.trim()) {
      items = this._memory.searchAll(query);
    } else if (currentWs) {
      items = this._memory.getForProject(currentWs);
    } else {
      items = this._memory.searchAll('');
    }
    const searching = !!query.trim();
    const payload = items
      .filter(i => i.status !== 'dismissed')
      .map(i => ({
        id: i.id, kind: i.kind, text: i.text, tool: i.tool, occurrences: i.occurrences,
        // Project label only matters in cross-project search results.
        project: searching && i.projectPath ? nodePath.basename(i.projectPath) : '',
      }));
    // Suggestions only when not searching (they're current-project scoped).
    const suggestions = searching ? [] : this._suggestions.map(s => ({
      id: s.id, type: s.type, ruleText: s.ruleText, targetFile: s.targetFile,
      estimatedTokens: s.estimatedTokens, sectionHeading: s.sectionHeading ?? '',
      evidence: s.evidence.slice(0, 4).map(e => ({ tool: e.tool, quote: e.quote, date: e.date })),
    }));
    this._post({ type: 'memoryLoaded', items: payload, suggestions, query });
  }

  /** Apply a config suggestion. 'add' appends a rule via WorkspaceEdit; 'remove'
   *  shows a diff then applies on confirm. Never edits without explicit accept. */
  private async _acceptSuggestion(id: string) {
    const sug = this._suggestions.find(s => s.id === id);
    if (!sug) return;
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || !wsFolders.length) {
      vscode.window.showWarningMessage('Markr: open a workspace folder to apply config suggestions.');
      return;
    }
    const root = wsFolders[0].uri;

    try {
      if (sug.type === 'add') {
        // 2c: optionally polish the rule text via the user's own LLM (opt-in).
        let ruleText = sug.ruleText;
        const enhanced = await this._maybeEnhanceRule(sug);
        if (enhanced && enhanced !== ruleText) {
          // Accept-what-you-see: the rewrite differs from the card, so confirm it
          // before writing a sentence the user never read.
          const pick = await vscode.window.showInformationMessage(
            `Markr rewrote this rule via your LLM:\n\n"${enhanced}"`,
            { modal: true, detail: `Original: "${ruleText}"` },
            'Add rewrite', 'Add original',
          );
          if (pick === 'Add rewrite') ruleText = enhanced;
          else if (pick !== 'Add original') return; // cancelled
        }

        const fileUri = vscode.Uri.joinPath(root, sug.targetFile);
        let before = '';
        try { before = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf-8'); }
        catch { /* file will be created */ }

        const edit = new vscode.WorkspaceEdit();
        const HEADING = '## Learned rules (Markr)';
        const bullet = `- ${ruleText}`;
        if (!before) {
          edit.createFile(fileUri, { ignoreIfExists: true });
          edit.insert(fileUri, new vscode.Position(0, 0), `${HEADING}\n\n${bullet}\n`);
        } else if (before.includes(HEADING)) {
          // Append under the existing heading.
          const lines = before.split('\n');
          const hIdx = lines.findIndex(l => l.trim() === HEADING);
          let insertLine = lines.length;
          for (let i = hIdx + 1; i < lines.length; i++) {
            if (/^#{1,6}\s/.test(lines[i])) { insertLine = i; break; }
          }
          const doc = await vscode.workspace.openTextDocument(fileUri);
          edit.insert(fileUri, new vscode.Position(insertLine, 0), `${bullet}\n`);
          void doc;
        } else {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          const end = new vscode.Position(doc.lineCount, 0);
          edit.insert(fileUri, end, `\n${HEADING}\n\n${bullet}\n`);
        }
        const ok = await vscode.workspace.applyEdit(edit);
        if (!ok) { vscode.window.showErrorMessage('Markr: could not apply the rule.'); return; }
        await (await vscode.workspace.openTextDocument(fileUri)).save();

        const after = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf-8');
        const model = detectModel(sug.targetFile);
        const delta = countTokens(after, model) - countTokens(before, model);
        this._memory.setSuggestionStatus(id, 'accepted');
        this._suggestions = this._suggestions.filter(s => s.id !== id);
        this._postMemory();
        vscode.window.showInformationMessage(`Markr: added rule to ${sug.targetFile} (+${delta} tokens).`);

      } else if (sug.type === 'remove' && sug.sectionHeading) {
        const existing = ['CLAUDE.md', 'AGENTS.md', '.cursorrules']
          .find(f => { try { return nodeFs.existsSync(nodePath.join(root.fsPath, f)); } catch { return false; } });
        if (!existing) return;
        const fileUri = vscode.Uri.joinPath(root, existing);
        const before = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf-8');
        const proposed = removeSection(before, sug.sectionHeading);

        // Diff preview from a temp file (read-only, no dirty buffer), cleaned up after.
        const tmpPath = nodePath.join(nodeOs.tmpdir(), `markr-proposed-${Date.now()}.md`);
        const tmpUri  = vscode.Uri.file(tmpPath);
        try {
          nodeFs.writeFileSync(tmpPath, proposed);
          await vscode.commands.executeCommand('vscode.diff', fileUri, tmpUri,
            `${existing}: remove "${sug.sectionHeading}" (Markr)`);

          const confirm = await vscode.window.showInformationMessage(
            `Remove section "${sug.sectionHeading}" from ${existing}?`, 'Apply removal', 'Cancel');
          if (confirm === 'Apply removal') {
            const edit = new vscode.WorkspaceEdit();
            const doc = await vscode.workspace.openTextDocument(fileUri);
            edit.replace(fileUri, new vscode.Range(0, 0, doc.lineCount, 0), proposed);
            await vscode.workspace.applyEdit(edit);
            await (await vscode.workspace.openTextDocument(fileUri)).save();
            this._memory.setSuggestionStatus(id, 'accepted');
            this._suggestions = this._suggestions.filter(s => s.id !== id);
            this._postMemory();
            const model = detectModel(existing);
            const saved = countTokens(before, model) - countTokens(proposed, model);
            vscode.window.showInformationMessage(`Markr: removed "${sug.sectionHeading}" (−${saved} tokens).`);
          }
        } finally {
          // Close the diff buffer and remove the temp file.
          try { await vscode.commands.executeCommand('workbench.action.closeActiveEditor'); } catch { /* ignore */ }
          try { nodeFs.unlinkSync(tmpPath); } catch { /* ignore */ }
        }
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Markr: could not apply suggestion. ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Write a handoff into the target tool's native file (zero-click continuity).
   *  Confirms once per workspace+target, then remembers via workspaceState. */
  private async _writeHandoffToTarget(target: TargetTool, text: string) {
    const spec = targetFileFor(target);
    if (!spec) return; // chatgpt / clipboard have no native file
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || !wsFolders.length) return;
    const root = wsFolders[0].uri;

    const consentKey = `markr.handoffWrite.consent.${target}`;
    if (!this._context.workspaceState.get<boolean>(consentKey)) {
      const ok = await vscode.window.showInformationMessage(
        `Also write this handoff to ${spec.relPath} so the next ${target} session picks it up automatically?`,
        { modal: true, detail: 'Markr will only touch its own delimited block / file. You can change this anytime.' },
        'Write it', 'Just the clipboard',
      );
      if (ok !== 'Write it') return;
      await this._context.workspaceState.update(consentKey, true);
    }

    try {
      const fileUri = vscode.Uri.joinPath(root, spec.relPath);
      let existing = '';
      try { existing = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf-8'); } catch { /* new file */ }
      const content = spec.mode === 'block'
        ? upsertHandoffBlock(existing, text)
        : shapeWholeFile(target, text);
      // Ensure parent dir (e.g. .cursor/rules) exists.
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(fileUri, '..'));
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
      this._context.workspaceState.update(`markr.handoffWrite.ts.${target}`, Date.now());
    } catch (err) {
      vscode.window.showWarningMessage(`Markr: could not write ${spec.relPath}. ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Mark a written handoff file consumed once a NEW session has started in that
   *  target tool since we wrote it (stale-handoff hygiene). Covers all native
   *  targets — block (CLAUDE.local.md), cursor .mdc, and HANDOFF.md. */
  private async _markConsumedIfStale(sessions: SessionInfo[]) {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || !wsFolders.length) return;
    const root = wsFolders[0].uri;
    const TARGETS: TargetTool[] = ['claude-code', 'cursor', 'codex', 'augment'];
    for (const target of TARGETS) {
      const spec = targetFileFor(target);
      if (!spec) continue;
      const tsKey = `markr.handoffWrite.ts.${target}`;
      const wroteAt = this._context.workspaceState.get<number>(tsKey) ?? 0;
      if (!wroteAt) continue;
      // A new session in this tool, for this project, started after we wrote it?
      const newer = sessions.some(s => (s.tool as string) === (target as string)
        && s.projectPath === root.fsPath && s.startedAt > wroteAt);
      if (!newer) continue;
      try {
        const fileUri = vscode.Uri.joinPath(root, spec.relPath);
        const existing = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf-8');
        const date = new Date(wroteAt).toISOString().slice(0, 10);
        const marked = spec.mode === 'block'
          ? markBlockConsumed(existing, date)
          : markWholeConsumed(target, existing, date);
        if (marked !== existing) {
          await vscode.workspace.fs.writeFile(fileUri, Buffer.from(marked, 'utf-8'));
        }
        // Clear the write marker so we don't re-mark every refresh.
        this._context.workspaceState.update(tsKey, 0);
      } catch { /* file gone / unreadable — ignore */ }
    }
  }

  /** Notify once per session when an active session crosses 75% of its limit. */
  private _checkExhaustion(sessions: SessionInfo[]) {
    for (const s of sessions) {
      if (!s.isActive) continue;
      const limit = CTX_LIMITS[s.tool];
      if (!limit) continue;
      const pct = Math.round((s.tokenCount / limit) * 100);
      if (pct < 75) continue;
      const notifiedKey = `markr.exhaustNotified.${s.id}`;
      if (this._context.workspaceState.get<boolean>(notifiedKey)) continue;
      const mutedKey = `markr.exhaustMuted.${s.id}`;
      if (this._context.workspaceState.get<boolean>(mutedKey)) continue;
      this._context.workspaceState.update(notifiedKey, true);
      vscode.window.showWarningMessage(
        `${TOOL_LABEL[s.tool]} session at ${pct}% of context — prepare a handoff?`,
        'Generate handoff', 'Mute for this session',
      ).then(action => {
        if (action === 'Generate handoff') {
          this._post({ type: 'selectSession', id: s.id });
          vscode.commands.executeCommand('markrContextBridge.focus');
        } else if (action === 'Mute for this session') {
          this._context.workspaceState.update(mutedKey, true);
        }
      });
      break; // one notification per refresh
    }
    // Prune exhaustion flags for sessions that no longer exist (bounded growth).
    try {
      const live = new Set(sessions.map(s => s.id));
      for (const key of this._context.workspaceState.keys()) {
        const m = key.match(/^markr\.exhaust(?:Notified|Muted)\.(.+)$/);
        if (m && !live.has(m[1])) this._context.workspaceState.update(key, undefined);
      }
    } catch { /* keys() unavailable in older VS Code — skip */ }
  }

  /** 2c: opt-in LLM rewrite of a suggestion's rule text. Falls back silently. */
  private async _maybeEnhanceRule(sug: ConfigSuggestion): Promise<string | null> {
    const enabled = vscode.workspace.getConfiguration('markr').get<boolean>('aiEnhance', false);
    if (!enabled || !sug.evidence.length) return null;
    try {
      const providers = await this._runner.configuredProviders();
      if (!providers.length) return null;
      const provider = providers[0];
      const CHEAPEST: Record<string, string> = {
        anthropic: 'claude-3-5-haiku-20241022', openai: 'gpt-4o-mini', google: 'gemini-2.0-flash-exp',
      };
      const quotes = sug.evidence.map(e => `- ${e.quote}`).join('\n');
      let acc = '';
      const run = new Promise<void>((resolve) => {
        this._runner.streamRun(
          {
            provider, model: CHEAPEST[provider] ?? '',
            systemPrompt: 'Rewrite these repeated user instructions as ONE concise imperative config rule. Reply with only the rule, no preamble.',
            messages: [{ role: 'user', content: quotes }],
          },
          (chunk) => { acc += chunk; },
          () => resolve(),
          () => resolve(),
        ).catch(() => resolve());
      });
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
      await Promise.race([run, timeout]);
      const cleaned = acc.trim().split('\n')[0]?.replace(/^[-*]\s*/, '').trim();
      return cleaned && cleaned.length > 3 ? cleaned : null;
    } catch {
      return null;
    }
  }

  /** Post the History tab payload (last 20 handoffs for the current project). */
  private _postHistory() {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const entries = ws ? this._memory.getHandoffs(ws) : [];
    const payload = entries.map(h => ({
      ts: h.timestamp, sourceTool: h.sourceTool, target: h.target,
      ago: timeAgo(h.timestamp), preview: h.text.split('\n').find(Boolean)?.slice(0, 80) ?? '',
    }));
    this._post({ type: 'historyLoaded', entries: payload });
  }

  /** Persisted active dead-ends/constraints to seed a handoff for this project. */
  private _seedFor(session: SessionInfo): { deadEnds: string[]; constraints: string[] } {
    const empty = { deadEnds: [] as string[], constraints: [] as string[] };
    try {
      if (!session.projectPath) return empty;
      const items = this._memory.getForProject(session.projectPath)
        .filter(i => i.status === 'active' && (i.occurrences >= 2 || i.lastSessionId === session.id));
      return {
        deadEnds:    items.filter(i => i.kind === 'deadEnd').map(i => i.text),
        constraints: items.filter(i => i.kind === 'constraint').map(i => i.text),
      };
    } catch {
      return empty;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Remove a markdown section (heading + body up to the next same-or-higher heading). */
function removeSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let skipping = false;
  let skipLevel = 0;
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      const level = m[1].length;
      if (skipping && level <= skipLevel) skipping = false;   // section ended
      if (!skipping && m[2].trim() === heading.trim()) { skipping = true; skipLevel = level; continue; }
    }
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function timeAgo(ms: number): string {
  const diff  = Date.now() - ms;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  2)  return 'just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  <  7)  return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function fmtTok(n: number): string {
  return n < 1000
    ? `${n}`
    : n < 1_000_000
      ? `${(n / 1000).toFixed(1)}K`
      : `${(n / 1_000_000).toFixed(1)}M`;
}

// ─── Static shell HTML (set once, never replaced) ────────────────────────────

function buildShellHtml(): string {
  const toolColors = JSON.stringify(TOOL_COLOR);
  const toolLabels = JSON.stringify(TOOL_LABEL);

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  background:
    radial-gradient(circle at top left, rgba(249,115,22,.10), transparent 34%),
    var(--vscode-sideBar-background);
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  line-height: 1.4;
  overflow: hidden;
}

/* ── Brand header ── */
.markr-header {
  display: flex; align-items: center; gap: 7px;
  padding: 9px 10px 8px;
  background:
    linear-gradient(135deg, rgba(249,115,22,.22), rgba(250,204,21,.10)),
    var(--vscode-sideBar-background);
  border-bottom: 1px solid rgba(249,115,22,.24);
  box-shadow: inset 0 -1px 0 rgba(255,255,255,.04);
}
.markr-logo {
  width: 17px; height: 17px; flex-shrink: 0;
  /* 4-point star / sparkle — Markr brand mark */
}
.markr-wordmark {
  font-size: 11px; font-weight: 800; letter-spacing: .55px;
  background: linear-gradient(90deg, #FDBA74, #FACC15);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}
.markr-sub {
  font-size: 10px; color: var(--vscode-descriptionForeground);
  margin-left: auto; letter-spacing: .2px;
}

/* ── Toolbar ── */
.toolbar {
  position: sticky; top: 0; z-index: 10;
  background:
    linear-gradient(180deg, rgba(249,115,22,.06), transparent 70%),
    var(--vscode-sideBar-background);
  border-bottom: 1px solid rgba(249,115,22,.16);
  box-shadow: 0 8px 22px rgba(0,0,0,.10);
}
.scope-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 8px 4px;
}
.bridge-actions {
  display: flex; gap: 4px; padding: 0 8px 6px;
}
.bridge-action {
  flex: 1; min-width: 0; border: 1px solid rgba(249,115,22,.28);
  background: linear-gradient(135deg, rgba(249,115,22,.14), rgba(250,204,21,.08));
  color: var(--vscode-foreground); border-radius: 6px;
  padding: 4px 6px; font: inherit; font-size: 10.5px; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bridge-action:hover {
  border-color: rgba(249,115,22,.60);
  background: linear-gradient(135deg, rgba(249,115,22,.24), rgba(250,204,21,.14));
}
.scope-toggle {
  display: flex; border-radius: 5px; overflow: hidden;
  border: 1px solid rgba(249,115,22,.35);
}
.scope-btn {
  padding: 2px 9px; border: none; cursor: pointer; font-size: 11px;
  background: transparent; color: var(--vscode-descriptionForeground);
  transition: background .12s, color .12s; white-space: nowrap;
}
.scope-btn + .scope-btn { border-left: 1px solid rgba(249,115,22,.22); }
.scope-btn:hover  { color: var(--vscode-foreground); }
.scope-btn.active {
  background: linear-gradient(90deg, #F97316, #EA580C);
  color: #fff;
}
.tabs-row {
  padding: 3px 6px 4px;
  border-top: 1px solid var(--vscode-sideBar-border, rgba(127,127,127,.1));
}
.time-row {
  padding: 3px 6px 4px;
  border-top: 1px solid var(--vscode-sideBar-border, rgba(127,127,127,.1));
}
.search-row {
  padding: 6px 8px 7px;
  border-top: 1px solid var(--vscode-sideBar-border, rgba(127,127,127,.1));
}
.search-input {
  width: 100%; height: 26px; border-radius: 6px;
  border: 1px solid var(--vscode-input-border, rgba(127,127,127,.28));
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  padding: 0 9px; font: inherit; font-size: 12px; outline: none;
}
.search-input:focus {
  border-color: #F97316;
  box-shadow: 0 0 0 1px rgba(249,115,22,.65), 0 0 0 4px rgba(249,115,22,.12);
}
.tabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tab, .time-btn {
  padding: 2px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap;
  font-size: 11px; border: none; background: transparent;
  color: var(--vscode-descriptionForeground); transition: all .12s;
  display: flex; align-items: center; gap: 4px;
}
.tab .tdot {
  width: 5px; height: 5px; border-radius: 50%;
  background: currentColor; opacity: 0; transition: opacity .12s;
}
.tab:hover, .time-btn:hover  { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
.tab.active, .time-btn.active { color: var(--vscode-foreground); font-weight: 600; background: rgba(127,127,127,.10); }
.tab.active .tdot { opacity: 1; }
.time-filters { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
.time-filters::-webkit-scrollbar { display: none; }

/* ── Loading state — animated brand shimmer ── */
.loading {
  padding: 32px 16px; text-align: center;
}
.loader-dots {
  display: flex; justify-content: center; gap: 6px; margin-bottom: 12px;
}
.loader-dot {
  width: 7px; height: 7px; border-radius: 50%;
  animation: pulse-dot 1.2s ease-in-out infinite;
}
.loader-dot:nth-child(1) { background: #FDBA74; animation-delay: 0s; }
.loader-dot:nth-child(2) { background: #F97316; animation-delay: .18s; }
.loader-dot:nth-child(3) { background: #FACC15; animation-delay: .36s; }
@keyframes pulse-dot {
  0%,80%,100% { transform: scale(.7); opacity: .5; }
  40%         { transform: scale(1.15); opacity: 1; }
}
.loading-text {
  font-size: 12px; color: var(--vscode-descriptionForeground);
  background: linear-gradient(90deg, #FDBA74, #FACC15, #FDBA74);
  background-size: 200% 100%;
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: shimmer-text 2s linear infinite;
}
@keyframes shimmer-text {
  0%   { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

/* ── Empty state ── */
.empty {
  padding: 28px 14px; text-align: center;
  color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.7;
}
.empty-icon { font-size: 24px; margin-bottom: 8px; display: block; }
.empty b {
  display: block; margin-bottom: 4px; font-size: 13px;
  background: linear-gradient(90deg, #FDBA74, #FACC15);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}
.btn-link {
  margin-top: 10px; display: inline-block;
  padding: 3px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;
  border: 1px solid rgba(249,115,22,.4);
  background: linear-gradient(90deg, #F9731618, #B4530918);
  color: var(--vscode-foreground);
}
.btn-link:hover { background: linear-gradient(90deg, #F9731630, #B4530930); }

/* ── Session cards ── */
.list { padding: 2px 0; }
.card {
  margin: 5px 7px;
  padding: 9px 10px 9px 12px;
  border: 1px solid rgba(127,127,127,.10);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(255,255,255,.035), transparent), rgba(127,127,127,.025);
  cursor: pointer; transition: background .1s, transform .1s, border-color .1s;
  border-left: 3px solid transparent;
}
.card:hover { background: var(--vscode-list-hoverBackground); transform: translateY(-1px); border-color: rgba(249,115,22,.20); }
.card.sel   { background: linear-gradient(135deg, rgba(249,115,22,.16), rgba(250,204,21,.07)); border-color: rgba(249,115,22,.38); }
.card.limit-hot { background-image: linear-gradient(90deg, rgba(239,68,68,.12), transparent 50%); }
.card.limit-warm { background-image: linear-gradient(90deg, rgba(245,158,11,.12), transparent 50%); }

.card-row1 { display: flex; align-items: center; gap: 5px; margin-bottom: 3px; }
.badge {
  padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 800;
  letter-spacing: .3px; color: #fff; flex-shrink: 0;
}
.dot-active {
  width: 6px; height: 6px; border-radius: 50%; background: #22c55e; flex-shrink: 0;
  box-shadow: 0 0 5px #22c55e;
  animation: pulse-live 2s ease-in-out infinite;
}
@keyframes pulse-live {
  0%,100% { box-shadow: 0 0 3px #22c55e88; }
  50%     { box-shadow: 0 0 8px #22c55e; }
}
.slug {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; color: var(--vscode-descriptionForeground);
}
.ago  { flex-shrink: 0; font-size: 10px; color: var(--vscode-descriptionForeground); }
.title {
  font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-bottom: 3px;
}
.meta { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--vscode-descriptionForeground); }
.risk {
  font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .35px;
  padding: 1px 4px; border-radius: 3px; flex-shrink: 0;
}
.risk-ok { color: #22c55e; background: rgba(34,197,94,.12); }
.risk-warm { color: #f59e0b; background: rgba(245,158,11,.14); }
.risk-hot { color: #ef4444; background: rgba(239,68,68,.14); }
.limit-bar {
  flex: 1; height: 3px; border-radius: 2px; max-width: 60px;
  background: rgba(127,127,127,.2); overflow: hidden;
}
.limit-fill { height: 100%; border-radius: 2px; transition: width .4s; }

/* ── Handoff panel ── */
.handoff-panel {
  position: sticky; top: 154px; z-index: 9;
  padding: 9px 10px 10px;
  background:
    linear-gradient(135deg, rgba(249,115,22,.18), rgba(250,204,21,.10)),
    var(--vscode-sideBar-background);
  border-bottom: 1px solid rgba(249,115,22,.25);
  box-shadow: 0 10px 28px rgba(0,0,0,.16);
  display: none;
}
.handoff-panel.show { display: block; }
.handoff-title {
  font-size: 12px; font-weight: 700; margin-bottom: 3px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.handoff-meta {
  font-size: 10px; color: var(--vscode-descriptionForeground);
  margin-bottom: 8px;
}
.handoff-label {
  font-size: 10px; margin-bottom: 5px;
  text-transform: uppercase; letter-spacing: .6px;
  background: linear-gradient(90deg, #FDBA74, #FACC15);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text; font-weight: 600;
}
.handoff-btns { display: flex; flex-wrap: wrap; gap: 4px; }
.hbtn {
  padding: 3px 9px; border-radius: 4px; cursor: pointer; font-size: 11px;
  border: 1px solid rgba(249,115,22,.35);
  background: rgba(249,115,22,.09);
  color: var(--vscode-foreground);
  transition: background .1s, border-color .1s;
}
.hbtn:hover   { background: rgba(249,115,22,.20); border-color: rgba(249,115,22,.60); }
.hbtn.primary {
  background: linear-gradient(90deg, #F97316, #EA580C);
  color: #fff; border-color: transparent;
}
.hbtn.primary:hover { background: linear-gradient(90deg, #EA580C, #C2410C); }
.hbtn:disabled { opacity: .45; cursor: default; }
.status-note {
  display: none; margin-top: 8px; padding: 6px 7px; border-radius: 5px;
  font-size: 11px; line-height: 1.35;
  background: rgba(34,197,94,.12); color: var(--vscode-foreground);
}
.status-note.show { display: block; }
.status-note.err { background: rgba(239,68,68,.13); color: #fca5a5; }

#list-root {
  height: calc(100vh - 160px);
  overflow-y: auto;
}
#handoff-panel.show + #list-root {
  height: calc(100vh - 252px);
}
.quick-actions {
  display: flex; gap: 4px; flex-wrap: wrap; margin-top: 7px;
}
.quick-btn {
  border: 1px solid rgba(127,127,127,.22);
  background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.10));
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  border-radius: 4px; padding: 2px 7px;
  font: inherit; font-size: 10.5px; line-height: 1.5;
  cursor: pointer;
}
.quick-btn:hover {
  background: var(--vscode-button-hoverBackground, rgba(127,127,127,.20));
}
.quick-btn.primary {
  background: var(--vscode-button-background, #F97316);
  color: var(--vscode-button-foreground, #fff);
  border-color: transparent;
}
.quick-btn:disabled { opacity: .55; cursor: default; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #F9731666, #B4530966);
  border-radius: 2px;
}

/* ── View tabs (Sessions | Memory) ── */
.view-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border, rgba(127,127,127,.2)); }
.view-tab {
  flex: 1; padding: 7px 10px; background: transparent; border: none; cursor: pointer;
  color: var(--text-faint, #888); font-size: 12px; font-weight: 600;
  border-bottom: 2px solid transparent;
}
.view-tab:hover { color: var(--text, #ddd); }
.view-tab.active { color: var(--text, #fff); border-bottom-color: #F97316; }

/* ── Memory items ── */
.mem-group { padding: 6px 10px 2px; }
.mem-group-title {
  font-size: 10px; text-transform: uppercase; letter-spacing: .6px;
  color: var(--text-faint, #888); margin: 8px 0 4px;
}
.mem-item {
  display: flex; align-items: flex-start; gap: 6px; padding: 6px 8px; margin-bottom: 4px;
  border-radius: 5px; background: var(--bg-subtle, rgba(127,127,127,.06));
  border-left: 2px solid var(--mem-accent, #F97316);
}
.mem-text { flex: 1; min-width: 0; font-size: 12px; line-height: 1.4; word-break: break-word; }
.mem-meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
.mem-badge { font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px; color: #fff; }
.mem-occ { font-size: 10px; color: var(--text-faint, #888); }
.mem-dismiss {
  flex-shrink: 0; background: transparent; border: none; cursor: pointer;
  color: var(--text-faint, #888); font-size: 13px; line-height: 1; padding: 2px 4px;
}
.mem-dismiss:hover { color: #ef4444; }
.mem-empty { padding: 24px 14px; text-align: center; color: var(--text-faint, #888); font-size: 12px; }

/* ── Config suggestions ── */
.sug-wrap { padding: 8px 10px 4px; }
.sug-head { font-size: 11px; font-weight: 700; color: #F97316; margin-bottom: 6px; }
.sug-card {
  padding: 8px; margin-bottom: 6px; border-radius: 6px;
  background: var(--bg-subtle, rgba(249,115,22,.06));
  border: 1px solid rgba(249,115,22,.25);
}
.sug-rule { font-size: 12px; font-weight: 600; line-height: 1.4; word-break: break-word; }
.sug-meta { font-size: 10px; color: var(--text-faint, #888); margin: 3px 0 6px; }
.sug-eviction { font-size: 10px; color: var(--text-faint, #888); cursor: pointer; }
.sug-quote { font-size: 11px; color: var(--text-muted, #aaa); margin: 4px 0 0 8px; line-height: 1.4; }
.sug-btns { display: flex; gap: 6px; margin-top: 8px; }
.sug-btn {
  padding: 3px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;
  border: 1px solid var(--border, rgba(127,127,127,.3)); background: transparent;
  color: var(--text, #ddd);
}
.sug-btn.accept { background: #F97316; border-color: #F97316; color: #fff; font-weight: 600; }
.sug-btn:hover { opacity: .85; }

/* ── Handoff history ── */
.hist-card { padding: 8px 10px; margin: 6px 10px; border-radius: 6px;
  background: var(--bg-subtle, rgba(127,127,127,.06)); border: 1px solid var(--border, rgba(127,127,127,.2)); }
.hist-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.hist-prev { font-size: 11px; color: var(--text-muted, #aaa); line-height: 1.4; word-break: break-word; margin-bottom: 6px; }

/* ── Tool-health row ── */
.tool-health { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 8px 10px;
  border-top: 1px solid var(--border, rgba(127,127,127,.2)); font-size: 10px;
  color: var(--text-faint, #888); }
.th-cell { display: inline-flex; align-items: center; gap: 4px; }
.th-dot { width: 6px; height: 6px; border-radius: 50%; opacity: .85; }
.th-none { opacity: .55; }
.th-error { color: #ef4444; }
</style>
</head>
<body>

<!-- Brand header -->
<div class="markr-header">
  <svg class="markr-logo" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 13.5V2L9.5 2L12 4.5V13.5H3Z" stroke="#FDBA74" stroke-width="1" fill="none"/>
    <path d="M9.5 2V4.5H12" stroke="#FDBA74" stroke-width="1" fill="none"/>
    <!-- sparkle -->
    <path d="M9 9.8L9.35 8.7L9.7 9.8L10.8 10.15L9.7 10.5L9.35 11.6L9 10.5L7.9 10.15Z"
          fill="#FACC15" stroke="none"/>
  </svg>
  <span class="markr-wordmark">CONTEXT BRIDGE</span>
  <span class="markr-sub" id="header-count"></span>
</div>

<div class="view-tabs" id="view-tabs">
  <button class="view-tab active" data-view="sessions">Sessions</button>
  <button class="view-tab" data-view="memory">Memory</button>
  <button class="view-tab" data-view="history">History</button>
</div>

<div class="toolbar">
  <div class="scope-row">
    <div class="scope-toggle" id="scope-btns">
      <button class="scope-btn active" data-scope="project" id="btn-scope-project">This project</button>
      <button class="scope-btn"        data-scope="all"     id="btn-scope-all">All projects</button>
    </div>
  </div>
  <div class="bridge-actions">
    <button class="bridge-action" id="btn-ai-health" title="Open AI config health dashboard">Config Health</button>
    <button class="bridge-action" id="btn-ai-bundle" title="Copy a redacted AI workspace bundle">Copy Bundle</button>
  </div>
  <div class="tabs-row">
    <div class="tabs" id="tabs">
      <button class="tab active" data-filter="all"><span class="tdot" style="background:#FDBA74"></span><span class="tab-label">All</span></button>
      <button class="tab" data-filter="claude-code"><span class="tdot" style="background:#F97316"></span><span class="tab-label">Claude</span></button>
      <button class="tab" data-filter="cursor"><span class="tdot" style="background:#EA580C"></span><span class="tab-label">Cursor</span></button>
      <button class="tab" data-filter="augment"><span class="tdot" style="background:#B45309"></span><span class="tab-label">Augment</span></button>
      <button class="tab" data-filter="codex"><span class="tdot" style="background:#16a34a"></span><span class="tab-label">Codex</span></button>
      <button class="tab" data-filter="aider"><span class="tdot" style="background:#d97706"></span><span class="tab-label">Aider</span></button>
    </div>
  </div>
  <div class="time-row">
    <div class="time-filters" id="time-filters">
      <button class="time-btn active" data-time="all">Any time</button>
      <button class="time-btn" data-time="6h">Last 6h</button>
      <button class="time-btn" data-time="today">Today</button>
      <button class="time-btn" data-time="24h">24h</button>
      <button class="time-btn" data-time="7d">7d</button>
    </div>
  </div>
  <div class="search-row">
    <input class="search-input" id="session-search" type="search" placeholder="Search session, project, or tool">
  </div>
</div>

<div id="handoff-panel" class="handoff-panel">
  <div class="handoff-title" id="handoff-title">Select a session</div>
  <div class="handoff-meta" id="handoff-meta"></div>
  <div class="handoff-label">Transfer handoff to</div>
  <div class="handoff-btns">
    <button class="hbtn"         data-target="claude-code">Claude</button>
    <button class="hbtn"         data-target="cursor">Cursor</button>
    <button class="hbtn"         data-target="augment">Augment</button>
    <button class="hbtn"         data-target="codex">Codex</button>
    <button class="hbtn"         data-target="chatgpt">ChatGPT</button>
    <button class="hbtn primary" data-target="clipboard">⎘ Copy</button>
  </div>
  <div class="status-note" id="handoff-status"></div>
</div>

<div id="list-root">
  <div class="loading">
    <div class="loader-dots">
      <div class="loader-dot"></div>
      <div class="loader-dot"></div>
      <div class="loader-dot"></div>
    </div>
    <div class="loading-text">Scanning sessions…</div>
  </div>
</div>

<div id="tool-health" class="tool-health"></div>

<div id="memory-view" style="display:none">
  <div class="search-row">
    <input class="search-input" id="memory-search" type="search" placeholder="Search memory across all projects">
  </div>
  <div id="memory-root"></div>
</div>

<div id="history-view" style="display:none">
  <div id="history-root"></div>
</div>

<script>
(function () {
  'use strict';

  const vsc    = acquireVsCodeApi();
  const COLORS = ${toolColors};
  const LABELS = ${toolLabels};
  const HANDOFF_LABELS = {
    'claude-code': 'Claude', cursor: 'Cursor', augment: 'Augment',
    codex: 'Codex', chatgpt: 'ChatGPT', clipboard: '⎘ Copy',
  };

  // ── Persistent state (survives postMessage refreshes) ──────────────────
  const _saved  = vsc.getState() || {};
  let SESSIONS   = [];
  let filter     = _saved.filter || 'all';
  let scope      = _saved.scope  || 'all';
  let timeFilter = _saved.timeFilter || 'all';
  let query      = _saved.query  || '';
  let selId      = null;
  let projectName = '';

  function saveState() { vsc.setState({ filter, scope, timeFilter, query }); }

  // ── Escape helper ──────────────────────────────────────────────────────
  function esc(v) {
    return String(v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ── Restore button active states + color the active tab dot ───────────
  function applyButtonStates() {
    document.querySelectorAll('.scope-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-scope') === scope);
    });
    document.querySelectorAll('.tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-filter') === filter);
    });
    document.querySelectorAll('.time-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-time') === timeFilter);
    });
    var pbtn = document.getElementById('btn-scope-project');
    if (pbtn) pbtn.textContent = projectName || 'This project';
    var search = document.getElementById('session-search');
    if (search && search.value !== query) search.value = query;
  }

  function sessionMatchesQuery(s) {
    if (!query.trim()) return true;
    var q = query.trim().toLowerCase();
    return [s.title, s.slug, s.tool, LABELS[s.tool], s.tok, s.ago]
      .filter(Boolean)
      .some(function(v){ return String(v).toLowerCase().indexOf(q) >= 0; });
  }

  function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function sessionMatchesTime(s) {
    if (timeFilter === 'all') return true;
    var ts = Number(s.lastActive || 0);
    if (!ts) return false;
    var now = Date.now();
    if (timeFilter === '6h') return ts >= now - 6 * 60 * 60 * 1000;
    if (timeFilter === '24h') return ts >= now - 24 * 60 * 60 * 1000;
    if (timeFilter === '7d') return ts >= now - 7 * 24 * 60 * 60 * 1000;
    if (timeFilter === 'today') return ts >= startOfToday();
    return true;
  }

  function limitClass(s) {
    if (!s.limitPct) return 'risk-ok';
    if (s.limitPct >= 85) return 'risk-hot';
    if (s.limitPct >= 65) return 'risk-warm';
    return 'risk-ok';
  }

  function limitText(s) {
    if (!s.limitPct) return 'ready';
    if (s.limitPct >= 85) return 'handoff now';
    if (s.limitPct >= 65) return 'watch';
    return 'ready';
  }

  function showStatus(text, isError) {
    var el = document.getElementById('handoff-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('err', !!isError);
    el.classList.add('show');
  }

  function requestHandoff(id, target, btn) {
    if (!id || !target) return;
    var orig = btn ? btn.textContent : '';
    if (btn) {
      btn.textContent = '...';
      btn.disabled = true;
    }
    showStatus('Building a clean handoff brief...', false);
    vsc.postMessage({ type: 'handoff', id: id, target: target });
    setTimeout(function () {
      if (!btn) return;
      btn.textContent = HANDOFF_LABELS[target] || orig || 'Copy';
      btn.disabled = false;
    }, 1500);
  }

  // ── Update tab labels with per-tool counts ────────────────────────────
  function updateTabCounts(pool) {
    var counts = {};
    pool.forEach(function(s){ counts[s.tool] = (counts[s.tool] || 0) + 1; });
    document.querySelectorAll('.tab').forEach(function(btn) {
      var f = btn.getAttribute('data-filter');
      if (f === 'all') {
        btn.querySelector('.tab-label').textContent = 'All';
        return;
      }
      var n = counts[f] || 0;
      btn.querySelector('.tab-label').textContent = (LABELS[f] || f) + (n > 0 ? ' ' + n : '');
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function render() {
    try {
      applyButtonStates();

      var root  = document.getElementById('list-root');
      var panel = document.getElementById('handoff-panel');
      var hdr   = document.getElementById('header-count');

      var scoped  = scope === 'project' ? SESSIONS.filter(function(s){ return s.current; }) : SESSIONS;
      var timed = scoped.filter(sessionMatchesTime);
      var filtered = filter === 'all'    ? timed : timed.filter(function(s){ return s.tool === filter; });
      var visible = filtered.filter(sessionMatchesQuery);

      // Show per-tool counts in tabs (using the scope-filtered pool so "This
      // project" mode shows project-specific counts, not global ones)
      updateTabCounts(timed);

      // Update header count
      var activeN = visible.filter(function(s){ return s.active; }).length;
      if (hdr) hdr.textContent = visible.length + ' session' + (visible.length !== 1 ? 's' : '') +
        (activeN > 0 ? ' · ' + activeN + ' live' : '');

      // Handoff panel visibility
      if (selId && visible.some(function(s){ return s.id === selId; })) {
        var selected = visible.find(function(s){ return s.id === selId; });
        panel.classList.add('show');
        var ht = document.getElementById('handoff-title');
        var hm = document.getElementById('handoff-meta');
        if (ht && selected) ht.textContent = selected.title || '(untitled session)';
        if (hm && selected) {
          hm.textContent = (LABELS[selected.tool] || selected.tool) + ' · ' +
            selected.slug + ' · ' + selected.msgs + ' msgs · ' + selected.tok + ' tok';
        }
      } else {
        panel.classList.remove('show');
        if (!visible.some(function(s){ return s.id === selId; })) selId = null;
      }

      if (!visible.length) {
        var hasAny     = SESSIONS.length > 0;
        var hasProject = SESSIONS.some(function(s){ return s.current; });
        var icon = '🔍';
        var title = '';
        var body  = '';
        if (scope === 'project' && hasAny && !hasProject) {
          icon  = '📁';
          title = 'No sessions for ' + esc(projectName || 'this project');
          body  = 'Open Claude Code, Cursor or Augment in this workspace.' +
                  '<br><button class="btn-link" id="btn-show-all">Show all projects</button>';
        } else if (!hasAny) {
          icon  = '✦';
          title = 'No sessions yet';
          body  = 'Run Claude Code, Cursor, Augment or Aider — sessions appear here automatically.';
        } else if (query.trim()) {
          title = 'No matching sessions';
          body  = 'Try a different project, tool, or task keyword.';
        } else if (timeFilter !== 'all') {
          title = 'No sessions in this time window';
          body  = 'Try Any time, All projects, or another tool filter.';
        } else {
          icon  = COLORS[filter] ? '' : '🔍';
          title = 'No ' + esc(filter === 'all' ? '' : (LABELS[filter] || filter) + ' ') + 'sessions';
          body  = 'Switch to "All projects" or run the tool to start a session.';
        }
        root.innerHTML = '<div class="empty"><span class="empty-icon">' + icon + '</span><b>' + title + '</b>' + body + '</div>';
        var bsa = document.getElementById('btn-show-all');
        if (bsa) bsa.addEventListener('click', function(){ switchScope('all'); });
        return;
      }

      var html = '<div class="list">';
      visible.forEach(function (s) {
        var isSel = s.id === selId;
        var color = COLORS[s.tool] || '#888';
        var limitColor = s.limitPct > 80 ? '#ef4444' : s.limitPct > 60 ? '#f59e0b' : '#22c55e';
        var cardTone = s.limitPct >= 85 ? ' limit-hot' : s.limitPct >= 65 ? ' limit-warm' : '';
        // Left border: tool color; pulse glow on active
        var borderStyle = 'border-left-color:' + color + (s.active ? ';box-shadow:inset 3px 0 6px ' + color + '33' : '');
        html += '<div class="card' + (isSel ? ' sel' : '') + cardTone + '" data-id="' + esc(s.id) + '" style="' + borderStyle + '">';
        html +=   '<div class="card-row1">';
        if (s.active) html += '<span class="dot-active" title="Live — active in last 2h"></span>';
        html +=   '<span class="badge" style="background:' + color + ';box-shadow:0 1px 4px ' + color + '66">' +
                  esc(LABELS[s.tool] || s.tool) + '</span>';
        html +=   '<span class="slug" title="' + esc(s.slug) + '">' + esc(s.slug) + '</span>';
        html +=   '<span class="ago">' + esc(s.ago) + '</span>';
        html +=   '</div>';
        html +=   '<div class="title" title="' + esc(s.title) + '">' + esc(s.title) + '</div>';
        html +=   '<div class="meta">';
        html +=     '<span>' + s.msgs + ' msgs · ' + esc(s.tok) + ' tok</span>';
        html +=     '<span class="risk ' + limitClass(s) + '">' + limitText(s) + '</span>';
        if (s.limitPct > 0) {
          html += '<div class="limit-bar" title="~' + s.limitPct + '% of context window">';
          html += '<div class="limit-fill" style="width:' + s.limitPct + '%;background:' + limitColor + '"></div>';
          html += '</div>';
          if (s.limitPct > 75) html += '<span style="color:#ef4444;font-weight:700">' + s.limitPct + '%⚠</span>';
        }
        html +=   '</div>';
        html +=   '<div class="quick-actions">';
        html +=     '<button class="quick-btn primary" data-action="handoff" data-id="' + esc(s.id) + '" data-target="clipboard">Copy</button>';
        html +=     '<button class="quick-btn" data-action="handoff" data-id="' + esc(s.id) + '" data-target="claude-code">Claude</button>';
        html +=     '<button class="quick-btn" data-action="handoff" data-id="' + esc(s.id) + '" data-target="cursor">Cursor</button>';
        html +=     '<button class="quick-btn" data-action="handoff" data-id="' + esc(s.id) + '" data-target="codex">Codex</button>';
        html +=   '</div>';
        html += '</div>';
      });
      html += '</div>';
      root.innerHTML = html;

      root.querySelectorAll('.card').forEach(function (card) {
        card.addEventListener('click', function () {
          var id = card.getAttribute('data-id');
          selId = (selId === id) ? null : id;
          render();
        });
      });
      root.querySelectorAll('[data-action="handoff"]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          requestHandoff(btn.getAttribute('data-id'), btn.getAttribute('data-target'), btn);
        });
      });
    } catch (err) {
      document.getElementById('list-root').innerHTML =
        '<div class="empty"><b>Render error</b>' + esc(String(err)) + '</div>';
    }
  }

  function switchScope(s) {
    scope = s; saveState(); applyButtonStates(); render();
  }

  // ── Event listeners ────────────────────────────────────────────────────
  document.getElementById('scope-btns').addEventListener('click', function (e) {
    var btn = e.target.closest('.scope-btn');
    if (!btn) return;
    switchScope(btn.getAttribute('data-scope'));
  });

  document.getElementById('tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.tab');
    if (!btn) return;
    filter = btn.getAttribute('data-filter');
    saveState(); applyButtonStates(); render();
  });

  document.getElementById('time-filters').addEventListener('click', function (e) {
    var btn = e.target.closest('.time-btn');
    if (!btn) return;
    timeFilter = btn.getAttribute('data-time') || 'all';
    saveState(); applyButtonStates(); render();
  });

  document.getElementById('session-search').addEventListener('input', function (e) {
    query = e.target.value || '';
    saveState(); render();
  });

  document.getElementById('btn-ai-health').addEventListener('click', function () {
    vsc.postMessage({ type: 'openAiHealth' });
  });

  document.getElementById('btn-ai-bundle').addEventListener('click', function () {
    vsc.postMessage({ type: 'copyAiConfigBundle' });
  });

  document.getElementById('handoff-panel').addEventListener('click', function (e) {
    var btn = e.target.closest('.hbtn');
    if (!btn || btn.disabled || !selId) return;
    requestHandoff(selId, btn.getAttribute('data-target'), btn);
  });

  // ── Tool-health row (no silent failures) ───────────────────────────────
  function renderToolHealth(health) {
    var root = document.getElementById('tool-health');
    root.textContent = '';
    if (!health || !health.length) return;
    var ICON = { ok: '✓', none: '—', error: '⚠', experimental: '⚙' };
    health.forEach(function (h) {
      var cell = document.createElement('span');
      cell.className = 'th-cell th-' + h.status;
      var dot = document.createElement('span');
      dot.className = 'th-dot';
      dot.style.background = COLORS[h.tool] || '#888';
      var label = document.createElement('span');
      var icon = ICON[h.status] || '';
      var suffix = h.status === 'ok' ? ' ' + h.count
        : h.status === 'error' ? ' err' + (h.count ? ' ' + h.count : '') : '';
      label.textContent = (LABELS[h.tool] || h.tool) + ' ' + icon + suffix;
      cell.appendChild(dot);
      cell.appendChild(label);
      cell.title = h.status === 'ok' ? (h.count + ' session(s) found')
        : h.status === 'none' ? 'no sessions found'
        : h.status === 'experimental' ? 'installed — Markr’s reader for this tool is experimental/unverified'
        : 'reader failed to parse';
      root.appendChild(cell);
    });
  }

  // ── Memory tab ──────────────────────────────────────────────────────────
  var currentView = 'sessions';
  var memSearchTimer = null;

  function switchView(v) {
    currentView = v;
    document.querySelectorAll('.view-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === v);
    });
    var sessions = (v === 'sessions');
    document.querySelector('.toolbar').style.display = sessions ? '' : 'none';
    document.getElementById('handoff-panel').style.display = sessions ? '' : 'none';
    document.getElementById('list-root').style.display = sessions ? '' : 'none';
    document.getElementById('tool-health').style.display = sessions ? '' : 'none';
    document.getElementById('memory-view').style.display = (v === 'memory') ? 'block' : 'none';
    document.getElementById('history-view').style.display = (v === 'history') ? 'block' : 'none';
    if (v === 'memory') vsc.postMessage({ type: 'getMemory' });
    if (v === 'history') vsc.postMessage({ type: 'getHistory' });
  }

  function renderHistory(entries) {
    var root = document.getElementById('history-root');
    root.textContent = '';
    if (!entries || !entries.length) {
      var empty = document.createElement('div');
      empty.className = 'mem-empty';
      empty.textContent = 'No handoffs yet — generate one from the Sessions tab.';
      root.appendChild(empty);
      return;
    }
    entries.forEach(function (h) {
      var card = document.createElement('div');
      card.className = 'hist-card';
      var top = document.createElement('div');
      top.className = 'hist-top';
      var badge = document.createElement('span');
      badge.className = 'mem-badge';
      badge.style.background = COLORS[h.sourceTool] || '#888';
      badge.textContent = (LABELS[h.sourceTool] || h.sourceTool) + ' → ' + (LABELS[h.target] || h.target);
      var ago = document.createElement('span');
      ago.className = 'mem-occ';
      ago.textContent = h.ago;
      top.appendChild(badge);
      top.appendChild(ago);
      card.appendChild(top);
      var prev = document.createElement('div');
      prev.className = 'hist-prev';
      prev.textContent = h.preview;
      card.appendChild(prev);
      var btns = document.createElement('div');
      btns.className = 'sug-btns';
      var copy = document.createElement('button');
      copy.className = 'sug-btn';
      copy.textContent = 'Copy again';
      copy.addEventListener('click', function () { vsc.postMessage({ type: 'copyHandoff', ts: h.ts }); });
      var view = document.createElement('button');
      view.className = 'sug-btn';
      view.textContent = 'View';
      view.addEventListener('click', function () { vsc.postMessage({ type: 'viewHandoff', ts: h.ts }); });
      btns.appendChild(copy);
      btns.appendChild(view);
      card.appendChild(btns);
      root.appendChild(card);
    });
  }

  var KIND_TITLES = { decision: 'Decisions', deadEnd: 'Dead-ends', constraint: 'Constraints' };
  var KIND_ACCENT = { decision: '#F97316', deadEnd: '#ef4444', constraint: '#B45309' };

  function renderSuggestions(root, suggestions) {
    if (!suggestions || !suggestions.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'sug-wrap';
    var head = document.createElement('div');
    head.className = 'sug-head';
    head.textContent = '✨ Config suggestions (' + suggestions.length + ')';
    wrap.appendChild(head);
    suggestions.forEach(function (s) {
      var card = document.createElement('div');
      card.className = 'sug-card';

      var rule = document.createElement('div');
      rule.className = 'sug-rule';
      rule.textContent = (s.type === 'remove' ? '➖ ' : '➕ ') + s.ruleText;
      card.appendChild(rule);

      var meta = document.createElement('div');
      meta.className = 'sug-meta';
      meta.textContent = s.type === 'add'
        ? ('→ ' + s.targetFile + ' · ~' + s.estimatedTokens + ' tok')
        : ('saves ~' + s.estimatedTokens + ' tok');
      card.appendChild(meta);

      if (s.evidence && s.evidence.length) {
        var det = document.createElement('details');
        var sum = document.createElement('summary');
        sum.textContent = 'Evidence (' + s.evidence.length + ')';
        sum.className = 'sug-eviction';
        det.appendChild(sum);
        s.evidence.forEach(function (e) {
          var q = document.createElement('div');
          q.className = 'sug-quote';
          q.textContent = '“' + e.quote + '” — ' + (LABELS[e.tool] || e.tool);
          det.appendChild(q);
        });
        card.appendChild(det);
      }

      var btns = document.createElement('div');
      btns.className = 'sug-btns';
      var accept = document.createElement('button');
      accept.className = 'sug-btn accept';
      accept.textContent = s.type === 'remove' ? 'Review & remove' : 'Accept';
      accept.addEventListener('click', function () { vsc.postMessage({ type: 'acceptSuggestion', id: s.id }); });
      var dismiss = document.createElement('button');
      dismiss.className = 'sug-btn';
      dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', function () { vsc.postMessage({ type: 'dismissSuggestion', id: s.id }); });
      btns.appendChild(accept);
      btns.appendChild(dismiss);
      card.appendChild(btns);

      wrap.appendChild(card);
    });
    root.appendChild(wrap);
  }

  function renderMemory(items, query, suggestions) {
    var root = document.getElementById('memory-root');
    root.textContent = '';
    if (!query) renderSuggestions(root, suggestions);
    if (!items || !items.length) {
      if (!root.childNodes.length) {
        var empty = document.createElement('div');
        empty.className = 'mem-empty';
        empty.textContent = query
          ? 'No memory items match "' + query + '".'
          : 'No memory yet — it builds as Markr scans your sessions.';
        root.appendChild(empty);
      }
      return;
    }
    ['decision', 'deadEnd', 'constraint'].forEach(function (kind) {
      var group = items.filter(function (i) { return i.kind === kind; });
      if (!group.length) return;
      var g = document.createElement('div');
      g.className = 'mem-group';
      var title = document.createElement('div');
      title.className = 'mem-group-title';
      title.textContent = KIND_TITLES[kind] + ' (' + group.length + ')';
      g.appendChild(title);
      group.forEach(function (i) {
        var row = document.createElement('div');
        row.className = 'mem-item';
        row.style.setProperty('--mem-accent', KIND_ACCENT[kind] || '#888');

        var main = document.createElement('div');
        main.className = 'mem-text';
        main.textContent = i.text;                 // textContent — never innerHTML
        var meta = document.createElement('div');
        meta.className = 'mem-meta';
        var badge = document.createElement('span');
        badge.className = 'mem-badge';
        badge.style.background = COLORS[i.tool] || '#888';
        badge.textContent = LABELS[i.tool] || i.tool;
        var occ = document.createElement('span');
        occ.className = 'mem-occ';
        occ.textContent = i.occurrences > 1 ? ('seen ' + i.occurrences + '×') : 'seen once';
        meta.appendChild(badge);
        meta.appendChild(occ);
        if (i.project) {
          var proj = document.createElement('span');
          proj.className = 'mem-occ';
          proj.textContent = '· ' + i.project;
          meta.appendChild(proj);
        }
        main.appendChild(meta);

        var dismiss = document.createElement('button');
        dismiss.className = 'mem-dismiss';
        dismiss.textContent = '✕';
        dismiss.title = 'Dismiss';
        dismiss.addEventListener('click', function () {
          var q = document.getElementById('memory-search').value || '';
          vsc.postMessage({ type: 'dismissMemory', id: i.id, query: q });
        });

        row.appendChild(main);
        row.appendChild(dismiss);
        g.appendChild(row);
      });
      root.appendChild(g);
    });
  }

  document.getElementById('view-tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.view-tab');
    if (btn) switchView(btn.getAttribute('data-view'));
  });
  document.getElementById('memory-search').addEventListener('input', function (e) {
    var q = e.target.value || '';
    if (memSearchTimer) clearTimeout(memSearchTimer);
    memSearchTimer = setTimeout(function () { vsc.postMessage({ type: 'searchMemory', query: q }); }, 220);
  });

  // ── Messages from extension ────────────────────────────────────────────
  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.type === 'sessionsLoaded') {
      if (msg.error) {
        document.getElementById('list-root').innerHTML =
          '<div class="empty"><span class="empty-icon">⚠</span>' +
          '<b>Could not load sessions</b>' + esc(msg.error) + '</div>';
        return;
      }
      SESSIONS    = msg.sessions || [];
      projectName = msg.projectName || '';
      render();
      renderToolHealth(msg.health || []);
    }
    if (msg.type === 'memoryLoaded') {
      renderMemory(msg.items || [], msg.query || '', msg.suggestions || []);
    }
    if (msg.type === 'historyLoaded') {
      renderHistory(msg.entries || []);
    }
    if (msg.type === 'selectSession') {
      switchView('sessions');
      selId = msg.id;
      render();
    }
    if (msg.type === 'handoffDone') {
      var n = msg.redactions || 0;
      var note = n > 0
        ? 'Copied — ' + n + ' secret' + (n > 1 ? 's' : '') + ' redacted. Paste it into the target tool.'
        : 'Copied. Paste it into the target tool to continue smoothly.';
      showStatus(note, false);
    }
    if (msg.type === 'handoffFailed') {
      showStatus(msg.error || 'Could not create handoff.', true);
    }
  });

  // ── Boot: restore UI state, then tell extension we're ready ───────────
  // The 'ready' message triggers the first _loadAndPost() in the extension.
  // This guarantees our message listener above is live before any data arrives.
  applyButtonStates();
  vsc.postMessage({ type: 'ready' });
}());
</script>
</body>
</html>`;
}
