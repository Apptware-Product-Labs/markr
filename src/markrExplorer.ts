import * as vscode from 'vscode';
import * as nodePath from 'path';

// ─── AI Config detection (mirrors preview.ts — kept separate to avoid circular deps) ──

export const AI_CONFIG_NAMES = new Set([
  'claude.md', 'claude.local.md', 'codex.md', 'agents.md', 'gemini.md',
  'skills.md', 'skill.md', 'system-prompt.md', 'systemprompt.md',
  'copilot-instructions.md', '.cursorrules', 'cursor.md', 'windsurf.md',
  'aider.md', 'gpt.md', 'openai.md', 'anthropic.md', 'context.md',
  'instructions.md', 'memory.md', 'rules.md', 'prompt.md', 'prompts.md',
]);

export function aiDocKindExplorer(label: string, relPath = ''): string {
  const lower = label.toLowerCase();
  const lowerPath = relPath.toLowerCase();
  if (lower === 'agents.md' || lower === 'agent.md') return 'Agent';
  if (lower === 'skill.md' || lower === 'skills.md' || lowerPath.includes('/skills/')) return 'Skill';
  if (lower.includes('copilot')) return 'Copilot';
  if (lower.includes('claude')) return 'Claude';
  if (lower.includes('codex')) return 'Codex';
  if (lower.includes('gemini')) return 'Gemini';
  if (lower.includes('cursor') || lower === '.cursorrules') return 'Cursor';
  if (lower.includes('windsurf')) return 'Windsurf';
  if (lower.includes('aider')) return 'Aider';
  if (lower.includes('system') || lower.includes('prompt')) return 'Prompt';
  if (lower.includes('context') || lower.includes('memory')) return 'Context';
  if (lower.includes('rule') || lower.includes('instruction')) return 'Rules';
  if (AI_CONFIG_NAMES.has(lower) || /^claude(\.local)?\.md$/i.test(lower)) return 'AI Doc';
  return '';
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExplorerFileEntry {
  label: string;
  relPath: string;
  uri: vscode.Uri;
  isAiConfig: boolean;
  aiKind: string;
  dir: string;
}

// ─── Tree Items ───────────────────────────────────────────────────────────────

export class MarkrFileItem extends vscode.TreeItem {
  constructor(public readonly entry: ExplorerFileEntry, active = false) {
    super(entry.label, vscode.TreeItemCollapsibleState.None);
    this.resourceUri = entry.uri;
    this.tooltip    = entry.relPath;

    if (entry.isAiConfig) {
      // AI config files get a distinctive star icon; active ones get an eye icon
      this.iconPath    = new vscode.ThemeIcon(
        active ? 'eye' : 'star-full',
        active
          ? new vscode.ThemeColor('focusBorder')            // accent highlight when active
          : new vscode.ThemeColor('charts.yellow'),
      );
      this.description = entry.aiKind + (active ? '  ◉' : '');
    } else {
      // Regular files: DON'T set iconPath — VS Code then auto-uses the user's file icon
      // theme (same icons as in Explorer: TypeScript, Python, YAML, etc.)
      this.description = active ? '◉' : undefined;
    }

    this.contextValue = entry.isAiConfig ? 'markrAiFile' : 'markrFile';
    this.command = {
      command: 'markr.openFile',
      title:   'Open in Markr',
      arguments: [entry.uri],
    };
  }
}

export class MarkrFolderItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly folderPath: string,
    public readonly children: (MarkrFolderItem | MarkrFileItem)[],
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('folder-opened');
    this.tooltip = folderPath;
    this.contextValue = 'markrFolder';
    const total = countFolderFiles(children);
    if (total > 0) { this.description = String(total); }
  }
}

function countFolderFiles(items: (MarkrFolderItem | MarkrFileItem)[]): number {
  return items.reduce((n, item) => {
    if (item instanceof MarkrFolderItem) { return n + countFolderFiles(item.children); }
    return n + 1;
  }, 0);
}

// ─── Folder tree builder ──────────────────────────────────────────────────────

interface FolderNode {
  files: ExplorerFileEntry[];
  dirs: Map<string, FolderNode>;
}

function buildFolderNode(files: ExplorerFileEntry[]): FolderNode {
  const root: FolderNode = { files: [], dirs: new Map() };
  for (const f of files) {
    const parts = (f.dir || '').split('/').filter(Boolean);
    let node = root;
    for (const part of parts) {
      if (!node.dirs.has(part)) { node.dirs.set(part, { files: [], dirs: new Map() }); }
      node = node.dirs.get(part)!;
    }
    node.files.push(f);
  }
  return root;
}

function folderNodeToItems(
  node: FolderNode,
  basePath: string = '',
  activeUri: string = '',
): (MarkrFolderItem | MarkrFileItem)[] {
  const items: (MarkrFolderItem | MarkrFileItem)[] = [];
  for (const [name, child] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const childPath = basePath ? `${basePath}/${name}` : name;
    const children = folderNodeToItems(child, childPath, activeUri);
    items.push(new MarkrFolderItem(name, childPath, children));
  }
  for (const f of [...node.files].sort((a, b) => a.label.localeCompare(b.label))) {
    items.push(new MarkrFileItem(f, f.uri.toString() === activeUri));
  }
  return items;
}

export class MarkrSectionItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly children: (MarkrFolderItem | MarkrFileItem)[],
    collapsible?: vscode.TreeItemCollapsibleState,
    icon?: string,
  ) {
    super(
      label,
      collapsible !== undefined ? collapsible : vscode.TreeItemCollapsibleState.Expanded,
    );
    if (icon) { this.iconPath = new vscode.ThemeIcon(icon); }
    this.contextValue = 'markrSection';
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class MarkrExplorerProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _files: ExplorerFileEntry[] = [];
  private _loading = true;
  private _scanPromise: Promise<void> | null = null;
  private _activeUri = '';

  /** Mark a URI as the currently active file in Markr and refresh the tree. */
  setActiveFile(uri: string): void {
    if (this._activeUri === uri) return;
    this._activeUri = uri;
    this._onDidChangeTreeData.fire(); // re-render so the ◉ indicator updates
  }

  get activeUri(): string { return this._activeUri; }

  constructor() {
    this._scan();
  }

  /** Expose all files for the search quick-pick command. */
  getFiles(): ExplorerFileEntry[] { return this._files; }

  refresh(): void {
    this._files = [];
    this._loading = true;
    this._scanPromise = null;
    this._scan();
  }

  private _scan(): void {
    if (this._scanPromise) { return; }
    this._scanPromise = this._doScan().finally(() => {
      this._scanPromise = null;
      this._loading = false;
      this._onDidChangeTreeData.fire();
    });
  }

  private async _doScan(): Promise<void> {
    try {
      const maxFiles = vscode.workspace.getConfiguration('markr').get<number>('maxWorkspaceFiles', 500);
      const exclude = [
        '**/node_modules/**', '**/.git/**', '**/.vscode/**',
        '**/.next/**', '**/out/**', '**/dist/**', '**/build/**',
        '**/coverage/**', '**/.turbo/**', '**/.cache/**',
        '**/tmp/**', '**/temp/**', '**/.husky/**',
        '**/storybook-static/**', '**/.svelte-kit/**',
        '**/__pycache__/**', '**/.pytest_cache/**',
        '**/vendor/**', '**/public/**',
      ].join(',');

      // ── Instant Phase: stat well-known AI config names at workspace root ──
      // No filesystem traversal — shows AI configs in the tree immediately.
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (wsRoot) {
        const knownNames = ['CLAUDE.md','claude.local.md','.cursorrules','agent.md','agents.md',
          'skill.md','skills.md','system-prompt.md','copilot-instructions.md','.windsurfrules',
          'windsurf.md','deepseek.md','kimi.md','llama.md','gemini.md','mistral.md','qwen.md'];
        const instantUris: vscode.Uri[] = [];
        await Promise.all(knownNames.map(async name => {
          try {
            const uri = vscode.Uri.joinPath(wsRoot, name);
            await vscode.workspace.fs.stat(uri);
            instantUris.push(uri);
          } catch { /* not found */ }
        }));
        if (instantUris.length) {
          // Show AI configs immediately, then the full scan will replace this
          this._files = instantUris.map(uri => {
            const label = nodePath.basename(uri.fsPath);
            const relPath = vscode.workspace.asRelativePath(uri);
            const lower = label.toLowerCase();
            const isAiConfig = AI_CONFIG_NAMES.has(lower) || /^claude(\.local)?\.md$/i.test(lower);
            return { label, relPath, uri, isAiConfig, aiKind: aiDocKindExplorer(label, relPath), dir: '' };
          });
          this._onDidChangeTreeData.fire(); // show AI configs NOW
        }
      }

      const uris = await vscode.workspace.findFiles('**/*.md', `{${exclude}}`, maxFiles);
      uris.sort((a, b) =>
        vscode.workspace.asRelativePath(a).localeCompare(vscode.workspace.asRelativePath(b)),
      );
      this._files = uris.map(uri => {
        const label = nodePath.basename(uri.fsPath);
        const relPath = vscode.workspace.asRelativePath(uri);
        const dir = nodePath.dirname(relPath) === '.' ? '' : nodePath.dirname(relPath);
        const lower = label.toLowerCase();
        const isAiConfig = AI_CONFIG_NAMES.has(lower) || /^claude(\.local)?\.md$/i.test(lower);
        const aiKind = aiDocKindExplorer(label, relPath);
        return { label, relPath, uri, isAiConfig, aiKind, dir };
      });
    } catch {
      this._files = [];
    }
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    // Expand section containers
    if (element instanceof MarkrSectionItem) { return element.children; }
    // Expand folder nodes
    if (element instanceof MarkrFolderItem)  { return element.children; }

    // ── Root level ──────────────────────────────────────────────────────────
    if (this._loading) {
      const loading = new vscode.TreeItem('Scanning workspace…', vscode.TreeItemCollapsibleState.None);
      loading.iconPath = new vscode.ThemeIcon('loading~spin');
      return [loading];
    }

    if (!vscode.workspace.workspaceFolders?.length) {
      const info = new vscode.TreeItem('No workspace open — open a folder first', vscode.TreeItemCollapsibleState.None);
      info.iconPath = new vscode.ThemeIcon('info');
      return [info];
    }

    if (this._files.length === 0) {
      const info = new vscode.TreeItem('No Markdown files found', vscode.TreeItemCollapsibleState.None);
      info.iconPath = new vscode.ThemeIcon('info');
      const hint = new vscode.TreeItem('New AI Config…', vscode.TreeItemCollapsibleState.None);
      hint.iconPath = new vscode.ThemeIcon('add');
      hint.command = { command: 'markr.newAiConfig', title: 'New AI Config File', arguments: [] };
      return [info, hint];
    }

    const aiEntries  = this._files.filter(f =>  f.isAiConfig);
    const docEntries = this._files.filter(f => !f.isAiConfig);
    const sections: vscode.TreeItem[] = [];

    // ── AI Configs section (flat — these are always at repo root or well-known paths) ──
    if (aiEntries.length > 0) {
      sections.push(new MarkrSectionItem(
        `AI Configs (${aiEntries.length})`,
        aiEntries.map(f => new MarkrFileItem(f, f.uri.toString() === this._activeUri)),
        vscode.TreeItemCollapsibleState.Expanded,
        'star',
      ));
    }

    // ── Workspace section with folder tree ──────────────────────────────────
    if (docEntries.length > 0) {
      const treeItems = folderNodeToItems(buildFolderNode(docEntries), '', this._activeUri);
      sections.push(new MarkrSectionItem(
        `Workspace (${docEntries.length})`,
        treeItems,
        docEntries.length <= 20
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
        'files',
      ));
    }

    return sections;
  }
}

// ─── AI Config Templates ─────────────────────────────────────────────────────

export const AI_CONFIG_TEMPLATES: Record<
  string,
  { filename: string; kind: string; description: string; template: string }
> = {
  claude: {
    filename: 'CLAUDE.md',
    kind: 'Claude',
    description: 'Claude Code project instructions',
    template: `# Project: [Your Project Name]

## What this project is

Brief 1-2 sentence description of what the project does.

## Tech stack

- Framework / language
- Database / storage
- Key libraries

## Project structure

- \`src/\` — source code
- \`tests/\` — test files
- \`docs/\` — documentation

## Conventions

- Describe naming conventions, code style, patterns used
- Note any important file locations or path aliases
- List things the agent should always or never do

## Commands

    npm run dev       # start dev server
    npm run build     # production build
    npm run test      # run tests
    npm run lint      # lint code

## Review guidelines

- Every PR must pass lint and typecheck
- Tests required for new features
`,
  },

  cursorrules: {
    filename: '.cursorrules',
    kind: 'Cursor',
    description: 'Cursor AI coding rules',
    template: `# Cursor Rules

## General

- Write clean, readable, maintainable code
- Prefer explicit over implicit
- Add comments for non-obvious logic

## Code style

- Use consistent naming conventions (camelCase for variables, PascalCase for types)
- Keep functions small and focused on a single responsibility
- Prefer const over let; avoid var

## TypeScript

- Always type function parameters and return values
- Avoid \`any\` — use \`unknown\` and narrow types
- Use interfaces for object shapes, type aliases for unions

## Testing

- Write tests for new functions
- Test edge cases and error paths

## Errors

- Handle errors explicitly — never swallow them silently
- Provide meaningful error messages
`,
  },

  copilot: {
    filename: '.github/copilot-instructions.md',
    kind: 'Copilot',
    description: 'GitHub Copilot workspace instructions',
    template: `# GitHub Copilot Workspace Instructions

This file provides context to GitHub Copilot for this repository.

## Project overview

[Describe what this project does in 2-3 sentences.]

## Technology stack

- Language: [e.g. TypeScript]
- Framework: [e.g. Next.js, Express]
- Database: [e.g. PostgreSQL via Supabase]

## Coding standards

- Follow the existing code style in each file
- Use the established patterns (e.g. error handling, logging)
- Prefer named exports over default exports
- Keep components small and composable

## Important conventions

- [List any domain-specific conventions]
- [Note file structure rules]
- [Mention testing requirements]

## Files to avoid modifying

- \`package-lock.json\`
- Auto-generated type files
`,
  },

  agent: {
    filename: 'agent.md',
    kind: 'Agent',
    description: 'Claude agent / skill definition',
    template: `# Agent Name

## Description

What this agent does and when it should be triggered. Keep it to 1-3 sentences.

## Triggers

- Use this skill when the user asks to [action]
- Also triggers when [condition]
- Skip when [exclusion condition]

## Instructions

1. First, [step one]
2. Then, [step two]
3. Finally, [step three]

Additional notes:
- Important constraint or rule
- Another rule the agent must follow

## Output Format

Describe what the agent should return:
- Format (markdown, code, plain text, JSON)
- Length expectations
- Any required sections or structure
`,
  },

  'system-prompt': {
    filename: 'system-prompt.md',
    kind: 'Prompt',
    description: 'AI system prompt template',
    template: `# System Prompt

## Role & Persona

You are [name/role], [brief description of who/what the AI is].
Your tone is [adjective, e.g. professional, friendly, concise].

## Capabilities

You can:
- [Capability 1]
- [Capability 2]
- [Capability 3]

## Constraints

- Do NOT [constraint 1]
- Always [requirement 1]
- If asked about [topic], [how to respond]

## Response format

- Keep responses [length guideline, e.g. concise, under 200 words unless asked for detail]
- Use markdown formatting when showing code or lists
- Always confirm understanding before [action]

## Context

[Any additional background the model needs to perform well in this role.]
`,
  },

  windsurf: {
    filename: '.windsurfrules',
    kind: 'Windsurf',
    description: 'Windsurf AI rules',
    template: `# Windsurf Rules

## General principles

- Write clean, well-documented code
- Follow the existing conventions in the codebase
- Prefer readability over cleverness

## Code style

- Use consistent formatting (tabs vs spaces as per project config)
- Keep functions focused; split large functions into smaller ones
- Use descriptive variable and function names

## TypeScript / JavaScript

- Always declare types; avoid implicit \`any\`
- Use \`const\` by default, \`let\` only when reassignment is needed
- Handle promises with \`async/await\` rather than \`.then()\` chains

## Architecture

- Follow the existing module structure
- Do not introduce new global state without discussion
- Prefer pure functions where possible

## Security

- Never log secrets or sensitive values
- Validate all user input before processing
- Use parameterised queries for database access
`,
  },
};
