/**
 * agentMapRunner.ts — AI Agent Map panel (vscode glue).
 *
 * Locates a `.claude/` agent project, reads agents/ + capabilities.yml + schemas/,
 * runs the pure analyzer (agentMap.ts), and renders the map. Read-only: it never
 * modifies the project; clicking an item opens the file.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseAgentFrontmatter, parseCapabilities, analyzeAgentProject, summarizeIssues,
  type AgentDef, type Capability,
} from './agentMap';
import { buildAgentMapHtml, type AgentMapView } from './webview/agentMapHtml';
import { isMarkrTheme, type MarkrTheme } from './webview/markrTheme';

const THEME_KEY = 'markr.agentMap.theme';

export class AgentMapPanel {
  private static current?: AgentMapPanel;

  private _theme: MarkrTheme;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private claudeDir: string,
    private readonly context: vscode.ExtensionContext,
  ) {
    const saved = context.globalState.get<string>(THEME_KEY);
    this._theme = isMarkrTheme(saved) ? saved : 'dark';
    panel.onDidDispose(() => { if (AgentMapPanel.current === this) AgentMapPanel.current = undefined; });
    panel.webview.onDidReceiveMessage(m => this._onMessage(m as Record<string, unknown>));
    this._render();
  }

  static show(context: vscode.ExtensionContext) {
    const dir = AgentMapPanel._findClaudeDir();
    if (!dir) {
      vscode.window.showInformationMessage('Markr: no .claude/ agent project found in this workspace.');
      return;
    }
    if (AgentMapPanel.current) {
      AgentMapPanel.current.claudeDir = dir;
      AgentMapPanel.current.panel.reveal(vscode.ViewColumn.Active);
      AgentMapPanel.current._render();
      return;
    }
    const panel = vscode.window.createWebviewPanel('markrAgentMap', 'AI Agent Map', vscode.ViewColumn.Active, { enableScripts: true });
    AgentMapPanel.current = new AgentMapPanel(panel, dir, context);
  }

  /** Nearest .claude dir: the active file's workspace folder first, then any folder. */
  private static _findClaudeDir(): string | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const active = vscode.window.activeTextEditor?.document.uri;
    const ordered = active
      ? [vscode.workspace.getWorkspaceFolder(active), ...folders].filter(Boolean) as vscode.WorkspaceFolder[]
      : folders;
    for (const f of ordered) {
      const dir = path.join(f.uri.fsPath, '.claude');
      try { if (fs.statSync(dir).isDirectory()) return dir; } catch { /* skip */ }
    }
    return undefined;
  }

  private _read(): AgentMapView {
    const agentsDir = path.join(this.claudeDir, 'agents');
    const schemasDir = path.join(this.claudeDir, 'schemas');
    const capFile = path.join(this.claudeDir, 'capabilities.yml');

    const agents: AgentDef[] = [];
    try {
      for (const f of fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'))) {
        try { agents.push(parseAgentFrontmatter(fs.readFileSync(path.join(agentsDir, f), 'utf-8'), f)); } catch { /* skip */ }
      }
    } catch { /* no agents dir */ }

    let capabilities: Capability[] = [];
    try { capabilities = parseCapabilities(fs.readFileSync(capFile, 'utf-8')); } catch { /* no capabilities.yml */ }

    let schemaFiles: string[] = [];
    try { schemaFiles = fs.readdirSync(schemasDir).filter(f => f.endsWith('.json')); } catch { /* no schemas */ }

    const issues = analyzeAgentProject({ agents, capabilities, schemaFiles });
    const nameOf = (a: AgentDef) => a.name || a.file.replace(/\.md$/, '');
    const agentNames = new Set(agents.map(nameOf));
    const descByName = new Map(agents.map(a => [nameOf(a), a.description]));
    // Each agent's tier (and whether it's wired) comes from the capability that runs it.
    const tierByAgent = new Map<string, string | undefined>();
    for (const c of capabilities) if (c.agent && !tierByAgent.has(c.agent)) tierByAgent.set(c.agent, c.tier);

    return {
      rootLabel: vscode.workspace.asRelativePath(this.claudeDir) || '.claude',
      summary: summarizeIssues(issues),
      issues,
      agents: agents.map(a => ({
        file: a.file, name: a.name, description: a.description, model: a.model,
        tools: a.tools, schemaRefs: a.schemaRefs,
        tier: tierByAgent.get(nameOf(a)),
        wired: tierByAgent.has(nameOf(a)),
      })),
      capabilities: capabilities.map(c => ({
        id: c.id, agent: c.agent, tier: c.tier, enabled: c.enabled,
        agentExists: !!c.agent && agentNames.has(c.agent),
        description: c.agent ? descByName.get(c.agent) : undefined,
      })),
    };
  }

  private _render() {
    this.panel.webview.html = buildAgentMapHtml(this._read(), this._theme);
  }

  private async _onMessage(msg: Record<string, unknown>) {
    if (msg.type === 'open' && typeof msg.file === 'string') {
      const uri = vscode.Uri.file(path.join(this.claudeDir, msg.file));
      try { await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside }); }
      catch { vscode.window.showWarningMessage(`Markr: could not open ${msg.file}.`); }
    } else if (msg.type === 'setTheme' && isMarkrTheme(msg.theme)) {
      // The webview already recolored itself instantly; just persist the choice
      // so it sticks on the next open. No re-render needed (avoids a flash).
      this._theme = msg.theme;
      this.context.globalState.update(THEME_KEY, msg.theme);
    } else if (msg.type === 'refresh') {
      this._render();
    }
  }
}
