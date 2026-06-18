/**
 * agentMap.test.ts — frontmatter/capabilities parsing + cross-file consistency lint.
 */
import { describe, it, expect } from 'vitest';
import {
  parseAgentFrontmatter, parseCapabilities, analyzeAgentProject, summarizeIssues,
} from './agentMap';

describe('parseAgentFrontmatter', () => {
  it('parses name/description/model/tools and schema refs', () => {
    const text = [
      '---',
      'name: pr-analyzer',
      'description: Grades a PR file.',
      'tools: Read, Glob, Grep, Bash',
      'model: claude-sonnet-4-6',
      '---',
      '# PR Analyzer',
      'Emit ANALYSIS_JSON conforming to .claude/schemas/analysis-json.schema.json.',
    ].join('\n');
    const d = parseAgentFrontmatter(text, 'pr-analyzer.md');
    expect(d.name).toBe('pr-analyzer');
    expect(d.model).toBe('claude-sonnet-4-6');
    expect(d.tools).toEqual(['Read', 'Glob', 'Grep', 'Bash']);
    expect(d.schemaRefs).toContain('analysis-json.schema.json');
  });

  it('handles a file with no frontmatter', () => {
    const d = parseAgentFrontmatter('# just a heading', 'x.md');
    expect(d.name).toBeUndefined();
    expect(d.schemaRefs).toEqual([]);
  });
});

describe('parseCapabilities', () => {
  const yaml = [
    '# registry',
    'capabilities:',
    '  - id: label-quality',
    '    agent: label-quality-checker',
    '    tier: parallel',
    '    enabled: true',
    '  - id: env-var-parity',
    '    agent: env-var-parity',
    '    enabled: false  # planned',
  ].join('\n');

  it('parses the list of capability maps', () => {
    const caps = parseCapabilities(yaml);
    expect(caps).toHaveLength(2);
    expect(caps[0]).toMatchObject({ id: 'label-quality', agent: 'label-quality-checker', tier: 'parallel', enabled: true });
    expect(caps[1].enabled).toBe(false);
  });
});

describe('analyzeAgentProject', () => {
  const agents = [
    parseAgentFrontmatter('---\nname: pr-analyzer\ndescription: x\nmodel: m\n---\nuses analysis-json.schema.json', 'pr-analyzer.md'),
  ];

  it('flags a capability that references a missing agent file', () => {
    const issues = analyzeAgentProject({
      agents,
      capabilities: [{ id: 'cap1', agent: 'does-not-exist', schemaRefs: [] }],
      schemaFiles: ['analysis-json.schema.json'],
    });
    expect(issues.some(i => i.kind === 'missing-agent' && i.severity === 'error')).toBe(true);
  });

  it('flags a missing schema referenced by an agent', () => {
    const issues = analyzeAgentProject({ agents, capabilities: [], schemaFiles: [] });
    expect(issues.some(i => i.kind === 'missing-schema' && i.file === 'pr-analyzer.md')).toBe(true);
  });

  it('is clean when everything wires up', () => {
    const issues = analyzeAgentProject({
      agents,
      capabilities: [{ id: 'cap1', agent: 'pr-analyzer', schemaRefs: ['analysis-json.schema.json'] }],
      schemaFiles: ['analysis-json.schema.json'],
    });
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('warns on frontmatter name ≠ filename and missing fields', () => {
    const a = [parseAgentFrontmatter('---\nname: wrong\n---\nbody', 'real-name.md')];
    const issues = analyzeAgentProject({ agents: a, capabilities: [], schemaFiles: [] });
    expect(issues.some(i => i.kind === 'name-mismatch')).toBe(true);
    expect(issues.some(i => i.kind === 'missing-description')).toBe(true);
    expect(issues.some(i => i.kind === 'missing-model')).toBe(true);
  });

  it('treats a disabled capability with a missing agent as planned (info), not an error', () => {
    const issues = analyzeAgentProject({
      agents,
      capabilities: [{ id: 'planned', agent: 'not-written-yet', enabled: false, schemaRefs: [] }],
      schemaFiles: ['analysis-json.schema.json'],
    });
    expect(issues.some(i => i.kind === 'missing-agent' && i.severity === 'error')).toBe(false);
    expect(issues.some(i => i.kind === 'planned-capability' && i.severity === 'info')).toBe(true);
  });

  it('flags duplicate capability ids', () => {
    const issues = analyzeAgentProject({
      agents, capabilities: [{ id: 'dup', schemaRefs: [] }, { id: 'dup', schemaRefs: [] }], schemaFiles: [],
    });
    expect(issues.some(i => i.kind === 'duplicate-capability')).toBe(true);
  });

  it('summarizeIssues counts by severity', () => {
    const s = summarizeIssues([
      { severity: 'error', kind: 'a', message: '' },
      { severity: 'warning', kind: 'b', message: '' },
      { severity: 'warning', kind: 'c', message: '' },
    ]);
    expect(s).toEqual({ errors: 1, warnings: 2, infos: 0 });
  });
});
