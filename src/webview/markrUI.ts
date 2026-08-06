/**
 * markrUI.ts — Markr's shared webview design system (Raycast-flavored).
 *
 * One visual language across every webview: layered surfaces, soft elevation,
 * subtle gradients, rounded cards, refined type, tasteful micro-interactions.
 * Everything is adaptive — colors derive from the host theme via color-mix(), so
 * a surface stays correct in light / dark / high-contrast automatically.
 *
 * A webview sets `--ui-bg` / `--ui-fg` to its base (editor bg by default; the
 * Context Bridge uses the sidebar bg), then includes MARKR_UI (tokens + optional
 * component classes). Custom-property references resolve lazily, so declaration
 * order doesn't matter.
 */

/** :root design tokens. Surfaces, lines, radii, shadows, accent, motion, type. */
export const MARKR_UI_TOKENS = `
:root {
  --ui-bg: var(--vscode-editor-background, #1e1e1e);
  --ui-fg: var(--vscode-foreground, #ccc);
  --muted: var(--vscode-descriptionForeground, #9d9d9d);

  /* Layered surfaces (elevate by tinting the foreground into the base). */
  --s0: var(--ui-bg);
  --s1: color-mix(in srgb, var(--ui-fg) 4%, var(--ui-bg));
  --s2: color-mix(in srgb, var(--ui-fg) 8%, var(--ui-bg));
  --s3: color-mix(in srgb, var(--ui-fg) 12%, var(--ui-bg));

  --line: color-mix(in srgb, var(--ui-fg) 12%, transparent);
  --line-soft: color-mix(in srgb, var(--ui-fg) 7%, transparent);

  --r: 10px; --r-sm: 7px; --r-lg: 14px; --r-pill: 999px;

  --sh-1: 0 1px 2px rgba(0,0,0,.18);
  --sh-2: 0 1px 2px rgba(0,0,0,.16), 0 8px 24px rgba(0,0,0,.20);

  --accent: #FB923C; --accent-2: #F97316; --accent-fg: #fff;
  --ring: 0 0 0 3px color-mix(in srgb, var(--accent) 26%, transparent);

  --ease: .14s cubic-bezier(.2,.7,.2,1);
}
@media (prefers-reduced-motion: reduce) { :root { --ease: 0s; } }
`;

/** Reusable component classes (opt-in; prefixed `mui-` to avoid collisions). */
export const MARKR_UI_COMPONENTS = `
.mui-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:5px 11px;
  border-radius:var(--r-sm); border:1px solid var(--line); background:var(--s2); color:var(--ui-fg);
  font:inherit; font-size:12px; line-height:1.4; cursor:pointer;
  transition:background var(--ease), border-color var(--ease), transform .08s, box-shadow var(--ease); }
.mui-btn:hover { background:var(--s3); }
.mui-btn:active { transform:translateY(1px); }
.mui-btn:focus-visible { outline:none; box-shadow:var(--ring); }
.mui-btn:disabled { opacity:.5; cursor:default; }
.mui-btn.primary { background:linear-gradient(135deg,var(--accent),var(--accent-2)); color:var(--accent-fg);
  border-color:transparent; font-weight:650; box-shadow:0 2px 8px color-mix(in srgb,var(--accent-2) 35%,transparent); }
.mui-btn.primary:hover { background:linear-gradient(135deg,#FDBA74,var(--accent)); }
.mui-btn.ghost { background:transparent; border-color:transparent; }
.mui-btn.ghost:hover { background:var(--s2); }

.mui-card { background:var(--s1); border:1px solid var(--line-soft); border-radius:var(--r); box-shadow:var(--sh-1);
  transition:background var(--ease), border-color var(--ease), transform var(--ease), box-shadow var(--ease); }
.mui-card.interactive { cursor:pointer; }
.mui-card.interactive:hover { background:var(--s2); border-color:var(--line); box-shadow:var(--sh-2); transform:translateY(-1px); }

.mui-chip { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:var(--r-pill);
  font-size:10.5px; font-weight:600; background:var(--s3); color:var(--muted); }

.mui-input { width:100%; background:var(--s1); color:var(--ui-fg); border:1px solid var(--line);
  border-radius:var(--r-sm); padding:6px 10px; font:inherit; font-size:12.5px; outline:none;
  transition:border-color var(--ease), box-shadow var(--ease); }
.mui-input::placeholder { color:var(--muted); }
.mui-input:focus { border-color:color-mix(in srgb,var(--accent) 60%,transparent); box-shadow:var(--ring); }

/* Segmented control (Raycast-style pill toggle). */
.mui-seg { display:inline-flex; background:var(--s2); border:1px solid var(--line); border-radius:var(--r-sm); padding:2px; gap:2px; }
.mui-seg > button { border:none; background:transparent; color:var(--muted); padding:3px 11px;
  border-radius:calc(var(--r-sm) - 1px); font:inherit; font-size:11.5px; cursor:pointer;
  transition:background var(--ease), color var(--ease); white-space:nowrap; }
.mui-seg > button:hover { color:var(--ui-fg); }
.mui-seg > button.active { background:var(--s0); color:var(--ui-fg); box-shadow:var(--sh-1); font-weight:600; }

/* Refined scrollbar. */
::-webkit-scrollbar { width:8px; height:8px; }
::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-thumb { background:color-mix(in srgb, var(--ui-fg) 18%, transparent); border-radius:var(--r-pill); border:2px solid transparent; background-clip:padding-box; }
::-webkit-scrollbar-thumb:hover { background:color-mix(in srgb, var(--ui-fg) 30%, transparent); background-clip:padding-box; }
`;

/** Everything, ready to drop into a `<style>` block. */
export const MARKR_UI = MARKR_UI_TOKENS + MARKR_UI_COMPONENTS;
