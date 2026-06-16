/**
 * katexMath.ts — a marked extension that renders LaTeX math with KaTeX.
 *
 *   $$ … $$   → display math (block)
 *   $ … $     → inline math
 *
 * Rendering is server-side via katex.renderToString (offline; the webview ships
 * the KaTeX CSS + fonts inline via katexAssets.ts). throwOnError:false makes a
 * bad expression render as a red inline error rather than crash the preview.
 *
 * Code spans / fenced code are tokenized by marked first, so `$x$` inside code
 * is left alone. The inline rule also guards against prose dollar signs
 * ("$5 and $10") by requiring non-space immediately inside the delimiters.
 */
import katex from 'katex';
import type { MarkedExtension } from 'marked';

function render(text: string, displayMode: boolean): string {
  return katex.renderToString(text, { displayMode, throwOnError: false, output: 'html' });
}

export function katexExtension(): MarkedExtension {
  return {
    extensions: [
      {
        name: 'blockMath',
        level: 'block',
        start(src: string) { const i = src.indexOf('$$'); return i < 0 ? undefined : i; },
        tokenizer(src: string) {
          const m = /^\$\$([\s\S]+?)\$\$/.exec(src);
          if (!m) return undefined;
          return { type: 'blockMath', raw: m[0], text: m[1].trim() };
        },
        renderer(token) { return render((token as unknown as { text: string }).text, true); },
      },
      {
        name: 'inlineMath',
        level: 'inline',
        start(src: string) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
        tokenizer(src: string) {
          // $…$ but not $$, no space just inside the delimiters (skips "$5 and $10").
          const m = /^\$(?![\s$])((?:\\.|[^$\\])+?)(?<![\s$])\$/.exec(src);
          if (!m) return undefined;
          return { type: 'inlineMath', raw: m[0], text: m[1].trim() };
        },
        renderer(token) { return render((token as unknown as { text: string }).text, false); },
      },
    ],
  };
}
