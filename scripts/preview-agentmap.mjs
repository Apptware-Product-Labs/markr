/**
 * preview-agentmap.mjs — renders the Agent Map against the REAL hinton .claude/
 * project into a static review page (dark + light), so the orientation UI can be
 * eyeballed before packaging. Output: _am-preview.html
 */
import esbuild from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const CLAUDE = '/Users/Sumit/Desktop/hinton/.claude';

// Bundle the pure analyzer + html builder and import them.
const bundle = async (entry) => {
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', write: false, platform: 'node' });
  return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
};
const am  = await bundle('src/agentMap.ts');
const amh = await bundle('src/webview/agentMapHtml.ts');

// Mirror agentMapRunner._read() with node fs.
const agentsDir = join(CLAUDE, 'agents');
const agents = readdirSync(agentsDir).filter(f => f.endsWith('.md'))
  .map(f => am.parseAgentFrontmatter(readFileSync(join(agentsDir, f), 'utf-8'), f));
let capabilities = [];
try { capabilities = am.parseCapabilities(readFileSync(join(CLAUDE, 'capabilities.yml'), 'utf-8')); } catch {}
let schemaFiles = [];
try { schemaFiles = readdirSync(join(CLAUDE, 'schemas')).filter(f => f.endsWith('.json')); } catch {}

const issues = am.analyzeAgentProject({ agents, capabilities, schemaFiles });
const nameOf = a => a.name || a.file.replace(/\.md$/, '');
const agentNames = new Set(agents.map(nameOf));
const descByName = new Map(agents.map(a => [nameOf(a), a.description]));
const tierByAgent = new Map();
for (const c of capabilities) if (c.agent && !tierByAgent.has(c.agent)) tierByAgent.set(c.agent, c.tier);

const view = {
  rootLabel: '.claude',
  summary: am.summarizeIssues(issues),
  issues,
  agents: agents.map(a => ({ file: a.file, name: a.name, description: a.description, model: a.model,
    tools: a.tools, schemaRefs: a.schemaRefs, tier: tierByAgent.get(nameOf(a)), wired: tierByAgent.has(nameOf(a)) })),
  capabilities: capabilities.map(c => ({ id: c.id, agent: c.agent, tier: c.tier, enabled: c.enabled,
    agentExists: !!c.agent && agentNames.has(c.agent), description: c.agent ? descByName.get(c.agent) : undefined })),
};
// Generalization check: an agents-only repo (no capabilities.yml, no schemas/).
const agentsOnly = {
  rootLabel: '.claude', summary: { errors: 0, warnings: 0, infos: 0 }, issues: [],
  capabilities: [],
  agents: [
    { file: 'reviewer.md', name: 'reviewer', description: 'Reviews diffs for correctness and style.', model: 'claude-sonnet-4-6', tools: ['Read', 'Grep'], schemaRefs: [], wired: false },
    { file: 'doc-writer.md', name: 'doc-writer', description: 'Writes and updates documentation.', model: 'claude-haiku-4-5', tools: ['Read', 'Write'], schemaRefs: [], wired: false },
    { file: 'planner.md', name: 'planner', description: 'Breaks a task into a step-by-step plan.', model: 'claude-opus-4-8', tools: ['Read'], schemaRefs: [], wired: false },
  ],
};

const STUB = `<script>window.__msgs=[];window.acquireVsCodeApi=function(){return {postMessage:function(m){window.__msgs.push(m);},setState:function(){},getState:function(){}};};</script>`;
const frame = (v, label, theme, w) => {
  const doc = amh.buildAgentMapHtml(v, theme).replace('<body>', '<body>' + STUB);
  return `<div class="cap">${label} · ${theme} · ${w}px</div>
    <iframe srcdoc="${doc.replace(/"/g, '&quot;')}" style="width:${w}px;height:1180px;border:1px solid #333;border-radius:8px;background:#fff;"></iframe>`;
};

const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:24px;background:#0b0b0c;font-family:system-ui;display:flex;flex-direction:column;gap:10px;}
  .cap{color:#888;font-size:12px;font-family:ui-monospace,monospace;margin-top:14px;}
  iframe{display:block;}
</style></head><body>
  ${frame(agentsOnly, 'agents-only (1-col)', 'dark', 980)}
  ${frame(view, 'hinton (3-col)', 'dark', 980)}
  ${frame(view, 'hinton', 'light', 980)}
</body></html>`;

writeFileSync('_am-preview.html', page);
console.log('wrote', pathToFileURL('_am-preview.html').href, '·', agents.length, 'agents,', capabilities.length, 'caps');
