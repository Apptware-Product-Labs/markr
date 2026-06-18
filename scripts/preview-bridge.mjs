/**
 * preview-bridge.mjs — renders the Context Bridge webview shell with injected
 * sessions so the new keyboard/a11y layer can be verified (tabindex, arrow nav,
 * focus rings). 'vscode' is stubbed so the module bundles in node. Output: _cb-preview.html
 */
import esbuild from 'esbuild';
import { writeFileSync } from 'fs';
import { pathToFileURL } from 'url';

const stubVscode = { name: 'stub-vscode', setup(b) {
  b.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {}; export const window={}; export const workspace={};', loader: 'js' }));
} };

const out = await esbuild.build({
  entryPoints: ['src/contextBridge.ts'], bundle: true, format: 'esm', write: false,
  platform: 'node', plugins: [stubVscode], logLevel: 'silent',
});
const mod = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
const shell = mod.buildShellHtml();

const SESSIONS = [
  { id: 's1', tool: 'claude-code', slug: 'markr', title: 'Add keyboard nav to Context Bridge', ts: 1, ageMs: 1, limitPct: 42, active: true,  current: true, msgs: 30, risk: 'ok' },
  { id: 's2', tool: 'cursor',      slug: 'markr', title: 'Agent map pan/zoom canvas',          ts: 2, ageMs: 2, limitPct: 78, active: false, current: true, msgs: 80, risk: 'warm' },
  { id: 's3', tool: 'augment',     slug: 'hinton', title: 'Config lab key entry',              ts: 3, ageMs: 3, limitPct: 12, active: false, current: true, msgs: 12, risk: 'ok' },
];
const STUB = `<script>
  window.__err=[];
  window.addEventListener('error', function(e){ window.__err.push((e.message||'')+' @line '+(e.lineno||'?')); });
  window.acquireVsCodeApi=function(){return {postMessage:function(){},setState:function(){},getState:function(){return null;}};};
</script>`;
const INJECT = `<script>
  setTimeout(function(){
    window.dispatchEvent(new MessageEvent('message',{data:{type:'sessionsLoaded',sessions:${JSON.stringify(SESSIONS)},projectName:'markr',scope:'all'}}));
  }, 30);
</script>`;
const doc = shell.replace('<body>', '<body>' + STUB).replace('</body>', INJECT + '</body>');

const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:20px;background:#0b0b0c;}
  iframe{width:340px;height:560px;border:1px solid #333;border-radius:8px;background:#1e1e1e;
    --vscode-sideBar-background:#181818;--vscode-foreground:#ccc;--vscode-descriptionForeground:#9d9d9d;
    --vscode-input-background:#2a2a2a;--vscode-input-foreground:#ccc;--vscode-list-hoverBackground:#2a2d2e;}
</style></head><body>
  <iframe id="cb" srcdoc="${doc.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}"></iframe>
</body></html>`;

writeFileSync('_cb-preview.html', page);
console.log('wrote', pathToFileURL('_cb-preview.html').href);
