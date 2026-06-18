/**
 * workbenchHtml.ts — the Markr Workbench launcher (sidebar webview view).
 *
 * A clean, theme-respecting launcher that lists every workbench tool as a
 * full-width action row (icon chip + label + hint). Single-column by design so
 * it stays readable and never overflows at any sidebar width — it simply gets
 * wider/narrower as the user resizes the panel. Every color is a VS Code theme
 * token, so it adapts to light / dark / high-contrast automatically.
 *
 * Pure string builder. Clicking a row posts { type:'cmd', id } → the provider
 * runs the matching command ('focus:<viewId>' focuses a sidebar view instead).
 */

export interface LauncherTile {
  id:    string;   // command id, or 'focus:<viewId>'
  label: string;
  hint:  string;   // one-line subtitle
  icon:  string;   // inline SVG markup (uses currentColor)
}

export interface LauncherGroup { title: string; tiles: LauncherTile[]; }

/** Minimal 18px line icons (stroke = currentColor) — no font/codicon dependency. */
const I = {
  map:    '<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  beaker: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/><path d="M7.5 14h9"/>',
  pulse:  '<path d="M3 12h4l2 6 4-14 2 8h6"/>',
  chart:  '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  bridge: '<path d="M3 8v8M21 8v8M3 12h18M7 12v4M12 12v4M17 12v4"/><path d="M3 11a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4"/>',
  clip:   '<path d="M9 4h6v3H9zM7 5H5v15h14V5h-2"/>',
  plus:   '<path d="M6 3h8l4 4v14H6zM14 3v4h4M10 13h4M12 11v4"/>',
};
const ico = (m: string) =>
  `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${m}</svg>`;

// Only the agent-tooling actions live here — the launcher's reason to exist.
// Session/sharing tools (Context Bridge, Scoreboard, Paste, New Config) already
// have their own panel or title-bar buttons, so duplicating them here is noise.
export const LAUNCHER_GROUPS: LauncherGroup[] = [
  {
    title: 'Agent tooling',
    tiles: [
      { id: 'markr.openAgentMap',    label: 'Agent Map',     hint: 'Understand & lint .claude/ agents', icon: ico(I.map) },
      { id: 'markr.openAiConfigLab', label: 'Config Lab',    hint: 'Test config files with prompts',     icon: ico(I.beaker) },
      { id: 'markr.openAiHealth',    label: 'Config Health', hint: 'Audit your AI config files',         icon: ico(I.pulse) },
    ],
  },
];

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function buildWorkbenchHtml(groups: LauncherGroup[] = LAUNCHER_GROUPS): string {
  const section = (g: LauncherGroup) => `
    <div class="grp" role="group" aria-label="${esc(g.title)}">
      <div class="grp-t">${esc(g.title)}</div>
      ${g.tiles.map(t => `
        <button class="row" data-cmd="${esc(t.id)}" title="${esc(t.label)} — ${esc(t.hint)}">
          <span class="ic" aria-hidden="true">${t.icon}</span>
          <span class="txt"><span class="lbl">${esc(t.label)}</span><span class="hint">${esc(t.hint)}</span></span>
          <span class="go" aria-hidden="true">›</span>
        </button>`).join('')}
    </div>`;

  return /* html */`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; padding: 6px 8px 12px; font-family: var(--vscode-font-family, system-ui);
    color: var(--vscode-foreground, #ccc); font-size: 12px; -webkit-font-smoothing: antialiased;
    overflow-x: hidden; }
  .grp { margin-top: 8px; }
  .grp:first-child { margin-top: 2px; }
  .grp-t { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em;
    color: var(--vscode-descriptionForeground, #9d9d9d); padding: 0 6px; margin-bottom: 4px; opacity: .9; }
  .row { display: flex; align-items: center; gap: 10px; width: 100%; margin: 1px 0;
    padding: 7px 8px; border-radius: 7px; cursor: pointer; text-align: left;
    color: var(--vscode-foreground, #ccc); background: transparent;
    border: 1px solid transparent; transition: background .1s ease, border-color .1s ease; }
  .row:hover { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.14)); }
  .row:active { background: var(--vscode-list-activeSelectionBackground, rgba(127,127,127,.22)); }
  .row:focus-visible { outline: none; border-color: var(--vscode-focusBorder, #4a9eff); }
  .ic { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px;
    color: var(--vscode-textLink-foreground, #4a9eff);
    background: color-mix(in srgb, var(--vscode-textLink-foreground, #4a9eff) 15%, transparent); }
  .txt { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.25; }
  .lbl { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint { color: var(--vscode-descriptionForeground, #9d9d9d); font-size: 10.5px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .go { flex: none; color: var(--vscode-descriptionForeground, #9d9d9d); font-size: 15px;
    opacity: 0; transform: translateX(-3px); transition: opacity .1s ease, transform .1s ease; }
  .row:hover .go { opacity: .8; transform: translateX(0); }
</style></head><body>
  ${groups.map(section).join('')}
<script>
  (function () {
    var vsc = acquireVsCodeApi();
    document.querySelectorAll('.row').forEach(function (b) {
      b.addEventListener('click', function () { vsc.postMessage({ type: 'cmd', id: b.getAttribute('data-cmd') }); });
    });
  }());
</script>
</body></html>`;
}
