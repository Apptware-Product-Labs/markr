import * as vscode from 'vscode';
import * as nodePath from 'path';
import { countTokens, detectModel, fmtTokens, modelLabel } from './tokenEngine';
import { aiDocKindExplorer, isAiConfigFile } from './markrExplorer';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface AiConfigFileReport {
  uri: vscode.Uri;
  relPath: string;
  label: string;
  kind: string;
  language: 'markdown' | 'json' | 'env' | 'text';
  tokens: number;
  lines: number;
  sizeBytes: number;
  summary: string[];
  findings: AiConfigFinding[];
}

export interface AiConfigFinding {
  severity: FindingSeverity;
  title: string;
  detail: string;
  fix: string;
  relPath?: string;
  line?: number;
}

export interface AiWorkspaceReport {
  workspaceName: string;
  generatedAt: Date;
  files: AiConfigFileReport[];
  findings: AiConfigFinding[];
  score: number;
  totalTokens: number;
  readiness: {
    hasPrimaryInstructions: boolean;
    hasCommands: boolean;
    hasTestingGuidance: boolean;
    hasSafetyGuidance: boolean;
    hasMcpConfig: boolean;
    hasEnvExample: boolean;
  };
}

const MAX_FILE_BYTES = 350_000;
const MAX_CONFIG_FILES = 60;
const EXCLUDE = '{**/node_modules/**,**/.git/**,**/.next/**,**/out/**,**/dist/**,**/build/**,**/coverage/**,**/.turbo/**,**/.cache/**,**/vendor/**}';
const ROOT_CONFIG_NAMES = [
  'AGENTS.md', 'CLAUDE.md', 'claude.local.md', 'codex.md', 'agent.md', 'agents.md',
  '.cursorrules', '.windsurfrules', 'cursor.md', 'windsurf.md', 'aider.md',
  'gemini.md', 'system-prompt.md', 'prompt.md', 'prompts.md', 'instructions.md',
  'rules.md', 'context.md', 'memory.md', 'mcp.json', '.env', '.env.example',
];
const TARGETED_PATTERNS = [
  '**/{AGENTS,CLAUDE,claude.local,codex,agent,agents,gemini,cursor,windsurf,aider,system-prompt,prompt,prompts,instructions,rules,context,memory}.md',
  '**/{*.agent,*-agent,*_agent,*.skill,*-skill,*_skill,*.prompt,*-prompt,*_prompt,*.rules,*-rules,*_rules,*.instructions,*-instructions,*_instructions}.md',
  '**/.cursorrules',
  '**/.windsurfrules',
  '**/.github/copilot-instructions.md',
  '**/.cursor/**/*.{json,md,mdc}',
  '**/{mcp,mcp-config}.json',
  '**/.vscode/mcp.json',
  '**/.env',
  '**/.env.example',
];

const SECRET_RE = /\b(?:api[_-]?key|secret|token|password|private[_-]?key|access[_-]?key)\b\s*[:=]\s*['"]?([A-Za-z0-9_./+=-]{12,})/i;
const PLACEHOLDER_RE = /\b(?:todo|tbd|your project|fill this|replace me|coming soon)\b/i;

function severityWeight(severity: FindingSeverity): number {
  switch (severity) {
    case 'critical': return 30;
    case 'high': return 18;
    case 'medium': return 10;
    case 'low': return 4;
    default: return 0;
  }
}

function iconForSeverity(severity: FindingSeverity): string {
  switch (severity) {
    case 'critical': return 'Critical';
    case 'high': return 'High';
    case 'medium': return 'Medium';
    case 'low': return 'Low';
    default: return 'Info';
  }
}

function languageForPath(relPath: string): AiConfigFileReport['language'] {
  const base = nodePath.basename(relPath).toLowerCase();
  if (base.endsWith('.md') || base.endsWith('.markdown')) return 'markdown';
  if (base.endsWith('.json') || base.endsWith('.jsonc')) return 'json';
  if (base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) return 'env';
  return 'text';
}

function isKnownConfigPath(uri: vscode.Uri): boolean {
  const relPath = vscode.workspace.asRelativePath(uri);
  const label = nodePath.basename(uri.fsPath);
  const lower = relPath.toLowerCase().replace(/\\/g, '/');
  if (isAiConfigFile(label, relPath)) return true;
  if (/(^|\/)(mcp|mcp-config)\.json$/.test(lower)) return true;
  if (/(^|\/)\.vscode\/mcp\.json$/.test(lower)) return true;
  if (/(^|\/)\.cursor\/.+\.(json|md|mdc)$/.test(lower)) return true;
  if (/(^|\/)\.env(\.|$)/.test(lower)) return true;
  if (/(^|\/)\.env$/.test(lower)) return true;
  return false;
}

function finding(
  severity: FindingSeverity,
  title: string,
  detail: string,
  fix: string,
  relPath?: string,
  line?: number,
): AiConfigFinding {
  return { severity, title, detail, fix, relPath, line };
}

async function readTextFile(uri: vscode.Uri): Promise<{ text: string; sizeBytes: number }> {
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > MAX_FILE_BYTES) {
    return { text: '', sizeBytes: stat.size };
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  return { text: Buffer.from(bytes).toString('utf8'), sizeBytes: bytes.byteLength };
}

function lineOf(text: string, re: RegExp): number | undefined {
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex(line => re.test(line));
  return idx >= 0 ? idx + 1 : undefined;
}

function analyzeMarkdown(text: string, relPath: string, label: string): { summary: string[]; findings: AiConfigFinding[] } {
  const findings: AiConfigFinding[] = [];
  const summary: string[] = [];
  const lower = text.toLowerCase();
  const headingMatches = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)];
  const headings = headingMatches.map(m => m[1].trim());

  if (!headings.length) {
    findings.push(finding('medium', 'No heading structure', 'Agents scan markdown by headings. A flat instruction file is harder to chunk and hand off.', 'Add clear sections like Role, Project, Commands, Conventions, Testing, and Safety.', relPath));
  } else {
    summary.push(`${headings.length} headings`);
  }

  if (!/\b(role|persona|you are|project overview|what this project is)\b/i.test(text)) {
    findings.push(finding('medium', 'Missing role or project overview', 'The model may not know what it is optimizing for before editing code.', 'Add a short Role or Project Overview section at the top.', relPath));
  }
  if (!/\b(npm|pnpm|yarn|bun|pytest|cargo|go test|make|gradle|mvn|swift test|dotnet test)\b/i.test(text)) {
    findings.push(finding('high', 'No runnable commands documented', 'Handoffs are weaker when the next tool cannot immediately verify work.', 'Add exact build, test, lint, and dev commands.', relPath));
  } else {
    summary.push('commands documented');
  }
  if (!/\b(test|testing|typecheck|lint|verify|ci)\b/i.test(text)) {
    findings.push(finding('medium', 'Testing guidance is missing', 'Agents may ship changes without knowing the expected verification bar.', 'Add testing expectations and the minimum commands to run before finalizing.', relPath));
  } else {
    summary.push('verification guidance');
  }
  if (!/\b(secret|api key|token|password|never log|sensitive|security)\b/i.test(text)) {
    findings.push(finding('low', 'No safety guidance', 'AI coding tools benefit from explicit rules around secrets, destructive commands, and user data.', 'Add a short Safety section for secrets, destructive commands, and privacy.', relPath));
  }
  if (PLACEHOLDER_RE.test(text)) {
    findings.push(finding('low', 'Template placeholder still present', 'Placeholder text reduces trust and can confuse agents.', 'Replace TODO/TBD/template phrases with project-specific instructions.', relPath, lineOf(text, PLACEHOLDER_RE)));
  }
  if (SECRET_RE.test(text)) {
    findings.push(finding('critical', 'Possible secret in AI config', 'AI config files are often copied into model context and handoffs. Secrets should never be embedded there.', 'Move the value to SecretStorage, environment variables, or a private vault and document only the variable name.', relPath, lineOf(text, SECRET_RE)));
  }

  const repeated = repeatedInstructionLines(text);
  if (repeated.length) {
    findings.push(finding('low', 'Repeated instructions', `Repeated line: "${repeated[0].slice(0, 90)}"`, 'Keep the strongest version once. Contradictory duplicates make agents less predictable.', relPath));
  }

  if (lower.includes('do not') && lower.includes('always')) {
    summary.push('explicit constraints');
  }

  return { summary, findings };
}

function repeatedInstructionLines(text: string): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s+/, '');
    if (line.length < 28 || /^#{1,6}\s/.test(line) || /^```/.test(line)) continue;
    const key = line.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([line]) => line);
}

function analyzeJson(text: string, relPath: string): { summary: string[]; findings: AiConfigFinding[] } {
  const findings: AiConfigFinding[] = [];
  const summary: string[] = [];
  try {
    const json = JSON.parse(text);
    if (nodePath.basename(relPath).toLowerCase() === 'mcp.json') {
      const servers = json?.mcpServers;
      if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
        findings.push(finding('high', 'Invalid MCP shape', 'MCP config should expose a top-level mcpServers object.', 'Add { "mcpServers": { ... } } with named server entries.', relPath));
      } else {
        const names = Object.keys(servers);
        summary.push(`${names.length} MCP server${names.length === 1 ? '' : 's'}`);
        for (const name of names) {
          const server = servers[name];
          if (!server?.command && !server?.url) {
            findings.push(finding('medium', `MCP server "${name}" has no command or url`, 'The tool may not be launchable from this config.', 'Provide either a command for stdio servers or a url for remote servers.', relPath));
          }
          if (server?.env && typeof server.env === 'object') {
            for (const [key, value] of Object.entries(server.env)) {
              if (typeof value === 'string' && value.trim() && !/^\$\{?[A-Z0-9_]+\}?$/.test(value)) {
                findings.push(finding('critical', `MCP env "${key}" looks like an inline secret`, 'MCP configs are easy to commit or copy into context.', 'Use an environment variable reference instead of the raw value.', relPath));
              }
            }
          }
        }
      }
    } else {
      summary.push('valid JSON');
    }
  } catch (err) {
    findings.push(finding('high', 'Invalid JSON', err instanceof Error ? err.message : String(err), 'Fix JSON syntax so tools can read this config reliably.', relPath));
  }
  if (SECRET_RE.test(text)) {
    findings.push(finding('critical', 'Possible secret in JSON config', 'This value may be copied into AI context or committed by accident.', 'Replace raw secrets with environment variable references.', relPath, lineOf(text, SECRET_RE)));
  }
  return { summary, findings };
}

function analyzeEnv(text: string, relPath: string): { summary: string[]; findings: AiConfigFinding[] } {
  const findings: AiConfigFinding[] = [];
  const entries = text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
  if (!/\.example$|example/i.test(relPath) && entries.some(line => SECRET_RE.test(line))) {
    findings.push(finding('critical', 'Possible committed env secret', 'Raw .env values should not be copied into AI prompts or committed.', 'Keep .env local, add .env.example with empty placeholders, and ensure .env is ignored.', relPath, lineOf(text, SECRET_RE)));
  }
  return { summary: [`${entries.length} env keys`], findings };
}

function fileSummary(text: string, language: AiConfigFileReport['language'], relPath: string, label: string): { summary: string[]; findings: AiConfigFinding[] } {
  if (!text) {
    return {
      summary: ['too large to inspect'],
      findings: [finding('medium', 'Config file is very large', 'Large AI config files are expensive to load and hard to hand off cleanly.', 'Split evergreen instructions from task-specific context.', relPath)],
    };
  }
  if (language === 'markdown') return analyzeMarkdown(text, relPath, label);
  if (language === 'json') return analyzeJson(text, relPath);
  if (language === 'env') return analyzeEnv(text, relPath);
  return { summary: [], findings: SECRET_RE.test(text) ? [finding('critical', 'Possible secret in text config', 'Secrets should not be copied into AI context.', 'Move secrets out of config docs.', relPath, lineOf(text, SECRET_RE))] : [] };
}

async function collectConfigUris(): Promise<vscode.Uri[]> {
  const byPath = new Map<string, vscode.Uri>();
  const roots = vscode.workspace.workspaceFolders ?? [];

  await Promise.all(roots.flatMap(root => ROOT_CONFIG_NAMES.map(async name => {
    const uri = vscode.Uri.joinPath(root.uri, name);
    try {
      await vscode.workspace.fs.stat(uri);
      if (isKnownConfigPath(uri)) byPath.set(uri.fsPath, uri);
    } catch {
      // Most workspaces will not have every known config name.
    }
  })));

  const all = await Promise.all(
    TARGETED_PATTERNS.map(pattern => vscode.workspace.findFiles(pattern, EXCLUDE, Math.ceil(MAX_CONFIG_FILES / 2))),
  );
  for (const uri of all.flat()) {
    if (byPath.size >= MAX_CONFIG_FILES) break;
    if (isKnownConfigPath(uri)) byPath.set(uri.fsPath, uri);
  }
  return [...byPath.values()].sort((a, b) => vscode.workspace.asRelativePath(a).localeCompare(vscode.workspace.asRelativePath(b)));
}

export async function analyzeAiWorkspace(): Promise<AiWorkspaceReport> {
  const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'Workspace';
  const uris = await collectConfigUris();
  const files: AiConfigFileReport[] = [];
  const allFindings: AiConfigFinding[] = [];

  for (const uri of uris) {
    const relPath = vscode.workspace.asRelativePath(uri);
    const label = nodePath.basename(uri.fsPath);
    const language = languageForPath(relPath);
    let text = '';
    let sizeBytes = 0;
    try {
      const read = await readTextFile(uri);
      text = read.text;
      sizeBytes = read.sizeBytes;
    } catch (err) {
      const f = finding('high', 'Could not read config file', err instanceof Error ? err.message : String(err), 'Check file permissions and try again.', relPath);
      allFindings.push(f);
      continue;
    }

    const model = detectModel(label, relPath);
    const tokens = language === 'markdown' || language === 'text' ? countTokens(text, model) : Math.ceil(text.length / 4);
    const analyzed = fileSummary(text, language, relPath, label);
    const report: AiConfigFileReport = {
      uri,
      relPath,
      label,
      kind: aiDocKindExplorer(label, relPath) || (language === 'json' ? 'Config' : language.toUpperCase()),
      language,
      tokens,
      lines: text ? text.split(/\r?\n/).length : 0,
      sizeBytes,
      summary: analyzed.summary,
      findings: analyzed.findings,
    };
    files.push(report);
    allFindings.push(...analyzed.findings);
  }

  const joined = files.map(f => `${f.relPath}\n${f.summary.join(' ')}\n`).join('\n').toLowerCase();
  const readiness = {
    hasPrimaryInstructions: files.some(f => /(^|\/)(claude\.md|agents?\.md|\.cursorrules|copilot-instructions\.md)$/i.test(f.relPath)),
    hasCommands: /\b(npm|pnpm|yarn|bun|pytest|cargo|go test|make|gradle|mvn|typecheck|lint)\b/i.test(joined),
    hasTestingGuidance: /\b(test|testing|typecheck|lint|verify|ci)\b/i.test(joined),
    hasSafetyGuidance: /\b(secret|api key|token|password|destructive|privacy|sensitive)\b/i.test(joined),
    hasMcpConfig: files.some(f => /(^|\/)mcp\.json$/i.test(f.relPath)),
    hasEnvExample: files.some(f => /\.env\.example$/i.test(f.relPath) || /example\.env$/i.test(f.relPath)),
  };

  const workspaceFindings: AiConfigFinding[] = [];
  if (!readiness.hasPrimaryInstructions) {
    workspaceFindings.push(finding('high', 'No primary AI instruction file found', 'Markr could not find CLAUDE.md, AGENTS.md, .cursorrules, or Copilot instructions.', 'Create a primary AI config from Markr: New AI Config File.'));
  }
  if (!readiness.hasMcpConfig) {
    workspaceFindings.push(finding('info', 'No MCP config detected', 'This is fine if the workspace does not use MCP tools yet.', 'Add .vscode/mcp.json or mcp.json when the project needs tool servers.'));
  }
  if (!readiness.hasEnvExample && files.some(f => f.language === 'env')) {
    workspaceFindings.push(finding('medium', 'Env file exists without an example', 'Agents need variable names, not private values.', 'Add .env.example with safe placeholders.'));
  }

  allFindings.push(...workspaceFindings);

  const totalPenalty = allFindings.reduce((sum, f) => sum + severityWeight(f.severity), 0);
  const readinessPenalty = Object.values(readiness).filter(Boolean).length < 4 ? 12 : 0;
  const score = Math.max(0, Math.min(100, 100 - totalPenalty - readinessPenalty));

  return {
    workspaceName,
    generatedAt: new Date(),
    files,
    findings: allFindings,
    score,
    totalTokens: files.reduce((sum, f) => sum + f.tokens, 0),
    readiness,
  };
}

function severityOrder(severity: FindingSeverity): number {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[severity];
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, '\\|');
}

export function buildAiHealthMarkdown(report: AiWorkspaceReport): string {
  const findings = [...report.findings].sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
  const readiness = report.readiness;
  const checks = [
    ['Primary instructions', readiness.hasPrimaryInstructions],
    ['Commands documented', readiness.hasCommands],
    ['Testing guidance', readiness.hasTestingGuidance],
    ['Safety guidance', readiness.hasSafetyGuidance],
    ['MCP config', readiness.hasMcpConfig],
    ['Env example', readiness.hasEnvExample],
  ];

  const lines: string[] = [];
  lines.push(`# Markr AI Config Health`);
  lines.push('');
  lines.push(`Workspace: **${escapeMd(report.workspaceName)}**`);
  lines.push(`Generated: ${report.generatedAt.toLocaleString()}`);
  lines.push('');
  lines.push(`## Readiness Score`);
  lines.push('');
  lines.push(`**${report.score}/100** · ${report.files.length} config file${report.files.length === 1 ? '' : 's'} · ${fmtTokens(report.totalTokens)} across AI context docs`);
  lines.push('');
  lines.push('| Check | Status |');
  lines.push('| --- | --- |');
  for (const [label, ok] of checks) {
    lines.push(`| ${label} | ${ok ? 'Ready' : 'Needs attention'} |`);
  }
  lines.push('');
  lines.push(`## Priority Fixes`);
  lines.push('');
  if (!findings.length) {
    lines.push('No major issues found. This workspace is in strong shape for AI-assisted development.');
  } else {
    for (const f of findings.slice(0, 12)) {
      const loc = f.relPath ? ` in \`${f.relPath}${f.line ? `:${f.line}` : ''}\`` : '';
      lines.push(`- **${iconForSeverity(f.severity)}: ${f.title}**${loc}. ${f.detail} Fix: ${f.fix}`);
    }
  }
  lines.push('');
  lines.push(`## Config Inventory`);
  lines.push('');
  if (!report.files.length) {
    lines.push('No AI config files were detected yet.');
  } else {
    lines.push('| File | Kind | Size | Notes |');
    lines.push('| --- | --- | ---: | --- |');
    for (const file of report.files) {
      const notes = file.summary.length ? file.summary.join(', ') : `${file.lines} lines`;
      lines.push(`| \`${escapeMd(file.relPath)}\` | ${escapeMd(file.kind)} | ${fmtTokens(file.tokens)} | ${escapeMd(notes)} |`);
    }
  }
  lines.push('');
  lines.push(`## Recommended Next Moves`);
  lines.push('');
  lines.push('1. Fix Critical and High findings first, especially secrets and missing verification commands.');
  lines.push('2. Keep one primary instruction file as the source of truth, then link tool-specific files to it.');
  lines.push('3. Use Context Bridge when a session crosses 65% context, and hand off before 85%.');
  lines.push('4. Use Mermaid/Gantt diagrams for plans, but keep the source copyable so another tool can continue the diagram.');
  lines.push('');
  return lines.join('\n');
}

function redactConfigContent(text: string, language: AiConfigFileReport['language']): string {
  if (language === 'env') {
    return text.split(/\r?\n/).map(line => {
      if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) return line;
      const [key] = line.split('=');
      return `${key}=<redacted>`;
    }).join('\n');
  }
  return text.replace(SECRET_RE, match => {
    const idx = match.search(/[:=]/);
    return idx >= 0 ? `${match.slice(0, idx + 1)} <redacted>` : '<redacted>';
  });
}

export async function buildAiConfigBundle(report: AiWorkspaceReport): Promise<string> {
  const lines: string[] = [];
  lines.push(`# Markr AI Workspace Bundle`);
  lines.push('');
  lines.push(`Use this as a clean starting context for an AI coding tool.`);
  lines.push('');
  lines.push(`Workspace: ${report.workspaceName}`);
  lines.push(`Readiness: ${report.score}/100`);
  lines.push(`Config files: ${report.files.length}`);
  lines.push(`Approx config tokens: ${fmtTokens(report.totalTokens)}`);
  lines.push('');
  lines.push(`## Immediate Risks`);
  lines.push('');
  const urgent = report.findings
    .filter(f => f.severity === 'critical' || f.severity === 'high')
    .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
  if (!urgent.length) lines.push('- No critical or high config risks detected.');
  for (const f of urgent.slice(0, 10)) {
    lines.push(`- ${f.title}${f.relPath ? ` (${f.relPath}${f.line ? `:${f.line}` : ''})` : ''}: ${f.fix}`);
  }
  lines.push('');
  lines.push(`## Config Files`);
  lines.push('');

  for (const file of report.files.slice(0, 20)) {
    let text = '';
    try {
      const read = await readTextFile(file.uri);
      text = redactConfigContent(read.text, file.language);
    } catch {
      text = '[Could not read file]';
    }
    const clipped = text.length > 16_000 ? `${text.slice(0, 16_000)}\n\n[Truncated by Markr for handoff safety]` : text;
    const fence = file.language === 'json' ? 'json' : file.language === 'env' ? 'dotenv' : 'markdown';
    lines.push(`### ${file.relPath}`);
    lines.push('');
    lines.push(`Kind: ${file.kind} · ${fmtTokens(file.tokens)} · ${file.summary.join(', ') || `${file.lines} lines`}`);
    lines.push('');
    lines.push(`\`\`\`${fence}`);
    lines.push(clipped);
    lines.push('```');
    lines.push('');
  }

  if (report.files.length > 20) {
    lines.push(`_Markr included the first 20 config files. ${report.files.length - 20} additional files were omitted to keep the bundle usable._`);
    lines.push('');
  }

  lines.push(`## Continuation Instruction`);
  lines.push('');
  lines.push('Continue from this workspace context. First resolve any Immediate Risks, then inspect the user task and use the documented commands to verify changes before summarizing work.');
  lines.push('');
  return lines.join('\n');
}
