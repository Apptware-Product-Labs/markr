/**
 * markrTheme.ts — Markr's own webview theme palette (Dark / Light / Notion /
 * Linear), independent of the active VS Code color theme. Surfaces opt in by
 * putting `data-m="<theme>"` on <html> and reading the CSS custom properties
 * below; switching is instant (JS flips the attribute, CSS does the rest).
 *
 * Base tokens mirror the Scoreboard's palette for visual consistency across
 * Markr surfaces; the `--c-*` set adds theme-aware semantic colors (used by the
 * Agent Map for tier badges / status dots).
 */
export type MarkrTheme = 'dark' | 'light' | 'notion' | 'linear';

export const MARKR_THEMES: MarkrTheme[] = ['dark', 'light', 'notion', 'linear'];

export const MARKR_THEME_TOKENS = `
[data-m="dark"]{--bg:#141210;--panel:#1b1916;--subtle:#211e1a;--elev:#201d19;--border:#2a2622;--grid:#27231f;--text:#e8e3dc;--text2:#c9c1b8;--muted:#8f877d;--faint:#5b554e;--accent:#FB923C;--link:#fb923c;--c-red:#f87171;--c-blue:#60a5fa;--c-green:#4ade80;--c-amber:#fbbf24;}
[data-m="light"]{--bg:#fbfaf8;--panel:#fff;--subtle:#f5f2ec;--elev:#fff;--border:#e6ded4;--grid:#eee8df;--text:#1c1a17;--text2:#514b45;--muted:#83786f;--faint:#b7aea4;--accent:#EA580C;--link:#c2410c;--c-red:#dc2626;--c-blue:#2563eb;--c-green:#16a34a;--c-amber:#b45309;}
[data-m="notion"]{--bg:#fff;--panel:#fff;--subtle:#f7f6f3;--elev:#fff;--border:#e8e6e2;--grid:#f0efec;--text:#37352f;--text2:#55534e;--muted:#8b8782;--faint:#bbb8b1;--accent:#37352f;--link:#337ea9;--c-red:#e03e3e;--c-blue:#337ea9;--c-green:#448361;--c-amber:#d9730d;}
[data-m="linear"]{--bg:#0d0d10;--panel:#15151b;--subtle:#1a1a22;--elev:#181820;--border:#262633;--grid:#22222d;--text:#e7e7ec;--text2:#b8b8c2;--muted:#777783;--faint:#484852;--accent:#8b92ff;--link:#8b92ff;--c-red:#f87171;--c-blue:#8b92ff;--c-green:#4cb782;--c-amber:#f2c94c;}
`;

const LABELS: Record<MarkrTheme, string> = {
  dark: 'Markr Dark', light: 'Markr Light', notion: 'Notion', linear: 'Linear',
};

/** <option> list for a theme <select>, with `selected` marked. */
export function themeOptionsHtml(selected: MarkrTheme): string {
  return MARKR_THEMES.map(t =>
    `<option value="${t}"${t === selected ? ' selected' : ''}>${LABELS[t]}</option>`).join('');
}

export function isMarkrTheme(v: unknown): v is MarkrTheme {
  return typeof v === 'string' && (MARKR_THEMES as string[]).includes(v);
}
