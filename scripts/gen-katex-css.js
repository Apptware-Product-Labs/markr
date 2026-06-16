/**
 * gen-katex-css.js — regenerate src/katexAssets.ts from the installed katex dist.
 *
 * Inlines KaTeX's stylesheet with the woff2 fonts embedded as data URIs, so math
 * renders offline in the webview with zero external assets. woff/ttf are dropped
 * (Electron/Chromium supports woff2) to keep the size down.
 *
 * Run after bumping the `katex` dependency:  node scripts/gen-katex-css.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'node_modules', 'katex', 'dist');

let css = fs.readFileSync(path.join(dist, 'katex.min.css'), 'utf8');
css = css.replace(/,url\(fonts\/[^)]+\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, '');
css = css.replace(/url\(fonts\/([\w-]+\.woff2)\)/g, (_m, f) => {
  const b64 = fs.readFileSync(path.join(dist, 'fonts', f)).toString('base64');
  return 'url(data:font/woff2;base64,' + b64 + ')';
});

const version = require(path.join(dist, '..', 'package.json')).version;
const out =
  `/**\n * katexAssets.ts — GENERATED. KaTeX ${version} stylesheet with woff2 fonts inlined\n` +
  ` * as data URIs, so math renders offline in the webview with no external assets.\n` +
  ` * Regenerate via scripts/gen-katex-css.js after bumping katex.\n */\n/* eslint-disable */\n` +
  `export const KATEX_CSS = ${JSON.stringify(css)};\n`;
fs.writeFileSync(path.join(root, 'src', 'katexAssets.ts'), out);
console.log('wrote src/katexAssets.ts —', (out.length / 1024).toFixed(0) + 'KB');
