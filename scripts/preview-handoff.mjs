/**
 * preview-handoff.mjs — renders the Review & edit handoff panel so the edit→copy
 * flow can be verified (the EDITED text must be what's finalized). Two frames:
 * clipboard target (Copy only) and a file target (Copy + Deliver). Output: _ho-preview.html
 */
import esbuild from 'esbuild';
import { writeFileSync } from 'fs';
import { pathToFileURL } from 'url';

const out = await esbuild.build({ entryPoints: ['src/webview/handoffEditorHtml.ts'], bundle: true, format: 'esm', write: false, platform: 'node' });
const mod = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));

const SAMPLE = `## Handoff — markr\n\n🧠 Decisions\n- Chose pure-module + runner split for testability\n- Bundle KaTeX offline (fonts inlined)\n\n🛑 Dead-ends\n- setPointerCapture broke node clicks — removed it\n\n📌 Constraints\n- No new deps; size-sensitive bundle\n\n🔀 Uncommitted diff: src/handoffEditor.ts (new)`;

const view = (isClipboard) => ({
  text: SAMPLE, sourceLabel: 'Claude Code',
  targetLabel: isClipboard ? 'Clipboard' : 'Cursor', isClipboard, redactions: 2,
});
const STUB = `<script>window.__msgs=[];window.acquireVsCodeApi=function(){return {postMessage:function(m){window.__msgs.push(m);},setState:function(){},getState:function(){return null;}};};</script>`;
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const frame = (isClipboard, label) => {
  const doc = mod.buildHandoffEditorHtml(view(isClipboard)).replace('<body>', '<body>' + STUB);
  return `<div class="cap">${label}</div><iframe srcdoc="${esc(doc)}" style="width:640px;height:430px;border:1px solid #333;border-radius:8px;background:#1e1e1e;--vscode-foreground:#ccc;--vscode-editor-background:#1e1e1e;--vscode-descriptionForeground:#9d9d9d;--vscode-input-background:#2a2a2a;--vscode-input-foreground:#ccc;--vscode-input-border:#3c3c3c;--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;--vscode-textLink-foreground:#4daafc;--vscode-charts-green:#3fb950;--vscode-charts-orange:#e0843a;"></iframe>`;
};

const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:20px;background:#0b0b0c;font-family:system-ui;display:flex;flex-direction:column;gap:8px;}
  .cap{color:#888;font-size:12px;font-family:ui-monospace,monospace;margin-top:10px;}
</style></head><body>
  ${frame(false, 'file target (Cursor) — Copy + Deliver')}
  ${frame(true, 'clipboard target — Copy only')}
</body></html>`;

writeFileSync('_ho-preview.html', page);
console.log('wrote', pathToFileURL('_ho-preview.html').href);
