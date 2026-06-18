/**
 * agentMap.ts — analyze a `.claude/`-style multi-agent project and surface the
 * cross-file contract issues humans can't eyeball:
 *
 *   - capabilities.yml referencing an agent file that doesn't exist
 *   - capabilities.yml referencing a schema that doesn't exist
 *   - an agent that references a schema that doesn't exist
 *   - agent frontmatter problems (missing name/description/model, name ≠ filename)
 *   - duplicate capability ids / agent names
 *
 * Pure / dependency-free (hand-rolled minimal parsers — the repo is size-sensitive)
 * so the analyzer is fully unit-tested. The panel + fs glue live in agentMapRunner.ts.
 */

export interface AgentDef {
  file:         string;        // basename, e.g. "pr-analyzer.md"
  name?:        string;        // frontmatter name
  description?: string;
  tools?:       string[];
  model?:       string;
  schemaRefs:   string[];      // schema basenames referenced in the body
}

export interface Capability {
  id?:     string;
  agent?:  string;             // agent name (without .md)
  tier?:   string;
  enabled?: boolean;
  schemaRefs: string[];        // schema basenames referenced in the entry
}

export type IssueSeverity = 'error' | 'warning' | 'info';
export interface AgentIssue {
  severity: IssueSeverity;
  kind:     string;
  message:  string;
  file?:    string;
}

export interface AgentMapInput {
  agents:      AgentDef[];
  capabilities: Capability[];
  schemaFiles: string[];       // basenames present in schemas/, e.g. "analysis-json.schema.json"
}

// ─── Parsers ────────────────────────────────────────────────────────────────

const SCHEMA_REF_RE = /([\w.-]+\.schema\.json)/g;

/** Parse an agent .md file's frontmatter + schema references. */
export function parseAgentFrontmatter(text: string, file: string): AgentDef {
  const def: AgentDef = { file, schemaRefs: [] };
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(text || '');
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = /^([A-Za-z_]+)\s*:\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].replace(/^["']|["']$/g, '').trim();
      if (key === 'name') def.name = val;
      else if (key === 'description') def.description = val;
      else if (key === 'model') def.model = val;
      else if (key === 'tools') def.tools = val.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  const refs = new Set<string>();
  let r: RegExpExecArray | null;
  SCHEMA_REF_RE.lastIndex = 0;
  while ((r = SCHEMA_REF_RE.exec(text || ''))) refs.add(r[1]);
  def.schemaRefs = [...refs];
  return def;
}

/**
 * Minimal parser for the `capabilities:` list-of-maps in capabilities.yml.
 * Handles the flat `- key: value` shape this project uses; ignores comments.
 */
export function parseCapabilities(yaml: string): Capability[] {
  const lines = (yaml || '').split('\n');
  const caps: Capability[] = [];
  let inList = false;
  let cur: Capability | null = null;
  const pushCur = () => { if (cur) { caps.push(cur); cur = null; } };

  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');           // strip trailing comments
    if (/^capabilities\s*:/.test(line)) { inList = true; continue; }
    if (!inList) continue;
    if (/^\S/.test(line) && line.trim()) { pushCur(); inList = false; continue; } // dedent → end of list

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item) {
      pushCur();
      cur = { schemaRefs: [] };
      applyKv(cur, item[1]);
      continue;
    }
    if (cur) applyKv(cur, line.trim());
  }
  pushCur();
  return caps.filter(c => c.id || c.agent);
}

function applyKv(cap: Capability, kv: string) {
  const m = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(kv);
  if (!m) return;
  const key = m[1].toLowerCase();
  const val = m[2].replace(/^["']|["']$/g, '').trim();
  if (key === 'id') cap.id = val;
  else if (key === 'agent') cap.agent = val;
  else if (key === 'tier') cap.tier = val;
  else if (key === 'enabled') cap.enabled = /^true$/i.test(val);
  const sm = val.match(SCHEMA_REF_RE);
  if (sm) cap.schemaRefs.push(...sm);
}

// ─── Analyzer ───────────────────────────────────────────────────────────────

export function analyzeAgentProject(input: AgentMapInput): AgentIssue[] {
  const issues: AgentIssue[] = [];
  const agentNames = new Set(input.agents.map(a => a.name || a.file.replace(/\.md$/, '')));
  const schemaSet = new Set(input.schemaFiles);

  // Capability → agent / schema wiring
  const seenCapIds = new Set<string>();
  for (const cap of input.capabilities) {
    if (cap.id) {
      if (seenCapIds.has(cap.id)) issues.push({ severity: 'warning', kind: 'duplicate-capability', message: `Duplicate capability id "${cap.id}".` });
      seenCapIds.add(cap.id);
    }
    if (cap.agent && !agentNames.has(cap.agent)) {
      // A disabled capability is allowed to reference a not-yet-written agent
      // (the registry convention: enabled:false = planned). Only an ENABLED
      // capability pointing at a missing agent is a real wiring error.
      if (cap.enabled === false) {
        issues.push({ severity: 'info', kind: 'planned-capability', message: `Capability "${cap.id ?? '?'}" is planned (enabled: false) — agent "${cap.agent}.md" not written yet.` });
      } else {
        issues.push({ severity: 'error', kind: 'missing-agent', message: `Capability "${cap.id ?? '?'}" references agent "${cap.agent}", but .claude/agents/${cap.agent}.md does not exist.` });
      }
    } else if (cap.enabled === false) {
      issues.push({ severity: 'info', kind: 'disabled-capability', message: `Capability "${cap.id ?? '?'}" is enabled: false (planned, not active).` });
    }
    for (const s of cap.schemaRefs) {
      if (!schemaSet.has(s)) issues.push({ severity: 'error', kind: 'missing-schema', message: `Capability "${cap.id ?? '?'}" references schema "${s}", which is not in schemas/.` });
    }
  }

  // Agent frontmatter + schema references
  const seenNames = new Set<string>();
  for (const a of input.agents) {
    const expected = a.file.replace(/\.md$/, '');
    if (!a.name) issues.push({ severity: 'warning', kind: 'missing-name', message: 'Missing `name` in frontmatter.', file: a.file });
    else {
      if (a.name !== expected) issues.push({ severity: 'warning', kind: 'name-mismatch', message: `Frontmatter name "${a.name}" does not match filename "${expected}".`, file: a.file });
      if (seenNames.has(a.name)) issues.push({ severity: 'warning', kind: 'duplicate-name', message: `Duplicate agent name "${a.name}".`, file: a.file });
      seenNames.add(a.name);
    }
    if (!a.description) issues.push({ severity: 'warning', kind: 'missing-description', message: 'Missing `description` in frontmatter.', file: a.file });
    if (!a.model) issues.push({ severity: 'warning', kind: 'missing-model', message: 'Missing `model` in frontmatter.', file: a.file });
    for (const s of a.schemaRefs) {
      if (!schemaSet.has(s)) issues.push({ severity: 'error', kind: 'missing-schema', message: `Agent references schema "${s}", which is not in schemas/.`, file: a.file });
    }
  }

  return issues;
}

export function summarizeIssues(issues: AgentIssue[]): { errors: number; warnings: number; infos: number } {
  return {
    errors:   issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    infos:    issues.filter(i => i.severity === 'info').length,
  };
}
