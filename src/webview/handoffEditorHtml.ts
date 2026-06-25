/**
 * handoffEditorHtml.ts — the "Review & edit handoff" panel.
 *
 * A handoff is generated heuristically, so the user shouldn't have to copy it
 * blind. This panel shows the generated brief in an editable textarea — trim
 * what the next agent doesn't need, then Copy (or Deliver to the target's native
 * file). The EDITED text is what gets finalized. Pure string builder; themed
 * with VS Code variables.
 */
export interface HandoffEditorView {
  text:        string;
  sourceLabel: string;   // e.g. "Claude Code"
  targetLabel: string;   // e.g. "Cursor" / "Clipboard"
  isClipboard: boolean;  // clipboard target → no separate "Deliver" button
  redactions:  number;
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(v: string): string {
  return esc(v).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function buildHandoffEditorHtml(v: HandoffEditorView): string {
  const chars = v.text.length;
  const tokens = Math.max(1, Math.round(chars / 4));
  const redNote = v.redactions > 0
    ? ` · <span class="red">${v.redactions} secret${v.redactions === 1 ? '' : 's'} redacted</span>`
    : '';
  const deliverBtn = v.isClipboard ? '' :
    `<button class="btn" id="deliver">📨 Deliver to ${escAttr(v.targetLabel)}</button>`;

  return /* html */`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { font-family: var(--vscode-font-family, system-ui); color: var(--vscode-foreground);
    background: var(--vscode-editor-background); margin: 0; padding: 16px 20px 14px;
    display: flex; flex-direction: column; font-size: 13px; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 10px; }
  .red { color: var(--vscode-charts-orange, #e0843a); }
  .hint { font-size: 11.5px; color: var(--vscode-descriptionForeground);
    background: var(--vscode-textBlockQuote-background, rgba(127,127,127,.08));
    border-left: 3px solid var(--vscode-textLink-foreground, #4a9eff);
    padding: 7px 10px; border-radius: 0 6px 6px 0; margin-bottom: 10px; line-height: 1.45; }
  textarea { flex: 1; width: 100%; resize: none; min-height: 220px;
    background: var(--vscode-input-background, var(--vscode-editor-background));
    color: var(--vscode-input-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-input-border, rgba(127,127,127,.3)); border-radius: 8px;
    padding: 11px 13px; font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
    font-size: 12.5px; line-height: 1.5; outline: none; }
  textarea:focus { border-color: var(--vscode-focusBorder, #4a9eff); }
  .bar { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .count { color: var(--vscode-descriptionForeground); font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace); }
  .toast { color: var(--vscode-charts-green, #3fb950); font-size: 11.5px; font-weight: 600;
    opacity: 0; transition: opacity .15s; }
  .toast.show { opacity: 1; }
  .spacer { flex: 1; }
  .btn { padding: 5px 13px; border-radius: 6px; cursor: pointer; font-size: 12px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.14));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,.24)); }
  .btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
  .btn.primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
</style></head><body>
  <h1>Review &amp; edit handoff</h1>
  <div class="sub">${escAttr(v.sourceLabel)} → ${escAttr(v.targetLabel)}${redNote}</div>
  <div class="hint">Trim anything the next agent can re-derive by reading the repo — pointers beat payload. Your edits are what get copied.</div>
  <textarea id="ho" spellcheck="false" aria-label="Handoff text, editable">${esc(v.text)}</textarea>
  <div class="bar">
    <span class="count" id="count"></span>
    <span class="toast" id="toast"></span>
    <span class="spacer"></span>
    ${deliverBtn}
    <button class="btn primary" id="copy">📋 Copy handoff</button>
  </div>
<script>
  (function () {
    var vsc = acquireVsCodeApi();
    var ta = document.getElementById('ho');
    var count = document.getElementById('count');
    var toast = document.getElementById('toast');
    function fmt() {
      var n = ta.value.length;
      count.textContent = n.toLocaleString() + ' chars · ~' + Math.max(1, Math.round(n / 4)).toLocaleString() + ' tokens';
    }
    ta.addEventListener('input', function () { fmt(); vsc.setState({ text: ta.value }); });
    fmt();
    var prev = vsc.getState();
    if (prev && typeof prev.text === 'string' && prev.text.length) { ta.value = prev.text; fmt(); }
    function flash(msg) { toast.textContent = msg; toast.classList.add('show'); setTimeout(function () { toast.classList.remove('show'); }, 2200); }
    document.getElementById('copy').addEventListener('click', function () { vsc.postMessage({ type: 'finalize', mode: 'copy', text: ta.value }); });
    var del = document.getElementById('deliver');
    if (del) del.addEventListener('click', function () { vsc.postMessage({ type: 'finalize', mode: 'deliver', text: ta.value }); });
    window.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'done') flash(e.data.mode === 'deliver' ? '✓ Delivered + copied' : '✓ Copied to clipboard');
    });
  }());
</script>
</body></html>`;
}
