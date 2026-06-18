/**
 * preview-workbench.mjs — renders the Workbench launcher into a static review
 * page with simulated VS Code theme tokens, at several sidebar widths in dark
 * and light, so the UI can be eyeballed before packaging. Output: _wb-preview.html
 */
import esbuild from 'esbuild';
import { writeFileSync } from 'fs';
import { pathToFileURL } from 'url';

// Bundle the pure HTML builder to a temp module and import it.
const out = await esbuild.build({
  entryPoints: ['src/webview/workbenchHtml.ts'],
  bundle: true, format: 'esm', write: false, platform: 'node',
});
const mod = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
const inner = mod.buildWorkbenchHtml();

// Realistic VS Code theme variable sets.
const THEMES = {
  dark: {
    bg: '#1e1e1e', sidebar: '#252526',
    vars: `--vscode-font-family:-apple-system,system-ui,sans-serif;--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editorWidget-background:#252526;--vscode-panel-border:#2b2b2b;--vscode-list-hoverBackground:#2a2d2e;--vscode-list-activeSelectionBackground:#37373d;--vscode-focusBorder:#007fd4;--vscode-textLink-foreground:#3794ff;`,
  },
  light: {
    bg: '#ffffff', sidebar: '#f3f3f3',
    vars: `--vscode-font-family:-apple-system,system-ui,sans-serif;--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#717171;--vscode-editorWidget-background:#f3f3f3;--vscode-panel-border:#e0e0e0;--vscode-list-hoverBackground:#e8e8e8;--vscode-list-activeSelectionBackground:#dcdcdc;--vscode-focusBorder:#0090f1;--vscode-textLink-foreground:#006ab1;`,
  },
};
const WIDTHS = [220, 300, 380]; // narrow → wide sidebar

const frame = (theme, w) => {
  const t = THEMES[theme];
  const doc = inner.replace('<body>', `<body style="${t.vars}background:${t.sidebar};">`);
  return `<div class="frame">
    <div class="cap">${theme} · ${w}px</div>
    <div class="pane" style="width:${w}px;background:${t.sidebar};">
      <iframe srcdoc="${doc.replace(/"/g, '&quot;')}" style="width:${w}px;height:430px;border:0;"></iframe>
    </div>
  </div>`;
};

const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:24px;background:#0b0b0c;font-family:system-ui;display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start;}
  .frame{display:flex;flex-direction:column;gap:8px;}
  .cap{color:#888;font-size:12px;font-family:ui-monospace,monospace;}
  .pane{border:1px solid #333;border-radius:8px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.4);}
  iframe{display:block;}
</style></head><body>
  ${['dark','light'].flatMap(th => WIDTHS.map(w => frame(th, w))).join('')}
</body></html>`;

writeFileSync('_wb-preview.html', page);
console.log('wrote', pathToFileURL('_wb-preview.html').href);
