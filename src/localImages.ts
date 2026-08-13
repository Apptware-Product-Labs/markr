/**
 * localImages.ts — resolve local image references in rendered Markdown.
 *
 * Markdown is parsed in the extension host, so `![](./img/a.png)` reaches the
 * webview as a *relative* `<img src>`. The webview's base URI is
 * `vscode-webview://<guid>/`, not the document's folder, so every local image
 * 404s. This module maps those references back to real files on disk; the
 * caller turns the resulting path into something the target document can load
 * (a webview URI for the preview, `file://` or a data URI for exports).
 *
 * Deliberately free of any `vscode` import so it stays unit-testable.
 */
import * as nodePath from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

export interface ResolveContext {
  /** Absolute directory of the Markdown document (undefined for untitled/clipboard docs). */
  docDir?: string;
  /** Workspace folder root — base for `/root-relative` references, fallback for untitled docs. */
  workspaceRoot?: string;
  /** Injectable for tests; defaults to the real filesystem. */
  exists?: (absPath: string) => boolean;
}

/**
 * Scheme test that requires 2+ characters, so Windows drive letters (`C:/x.png`)
 * are treated as paths rather than as a `c:` URL scheme.
 */
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|#x27);/gi, m => ENTITIES[m.toLowerCase()] ?? m);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function safeDecodeURI(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Map one `<img src>` value to an absolute path on disk.
 * Returns undefined for anything the browser can already load (http(s), data,
 * blob, protocol-relative, in-page anchors) or that cannot be resolved.
 */
export function resolveLocalImagePath(src: string, ctx: ResolveContext = {}): string | undefined {
  const exists = ctx.exists ?? ((p: string) => { try { return fs.existsSync(p); } catch { return false; } });

  let raw = decodeEntities((src ?? '').trim());
  if (!raw || raw.startsWith('#') || raw.startsWith('//')) return undefined;

  if (/^file:/i.test(raw)) {
    try { return nodePath.normalize(fileURLToPath(raw)); } catch { return undefined; }
  }
  if (URL_SCHEME.test(raw)) return undefined;   // http:, https:, data:, vscode-resource: …

  raw = raw.replace(/[?#].*$/, '');             // drop any query/fragment
  if (!raw) return undefined;

  // Percent-escapes are a URL convention; the filesystem wants the decoded form.
  const p = safeDecodeURI(raw).replace(/\\/g, '/');

  if (p.startsWith('~/')) return nodePath.normalize(nodePath.join(os.homedir(), p.slice(2)));

  // Windows absolute (C:/…)
  if (/^[a-zA-Z]:\//.test(p)) return nodePath.normalize(p);

  if (p.startsWith('/')) {
    // GitHub-style root-relative paths mean "workspace root"; fall back to a
    // real filesystem absolute path when that file doesn't exist.
    if (ctx.workspaceRoot) {
      const inWorkspace = nodePath.join(ctx.workspaceRoot, p.slice(1));
      if (exists(inWorkspace)) return inWorkspace;
    }
    return nodePath.normalize(p);
  }

  const base = ctx.docDir ?? ctx.workspaceRoot;
  if (!base) return undefined;
  return nodePath.resolve(base, p);
}

export interface RewriteResult {
  html: string;
  /** Absolute paths of every local image that was rewritten (deduped). */
  files: string[];
}

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /(\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/**
 * Rewrite the `src` of every local image in `html` via `toUrl`.
 * Remote images, data URIs and unresolvable references are left untouched, as
 * are images whose `toUrl` returns undefined (e.g. a file that failed to read).
 */
export function rewriteImageSources(
  html: string,
  toUrl: (absPath: string) => string | undefined,
  ctx: ResolveContext = {},
): RewriteResult {
  const files: string[] = [];
  if (!html) return { html, files };

  const out = html.replace(IMG_TAG, tag => {
    const attr = tag.match(SRC_ATTR);
    if (!attr) return tag;
    const src = attr[2] ?? attr[3] ?? attr[4] ?? '';
    const abs = resolveLocalImagePath(src, ctx);
    if (!abs) return tag;
    const url = toUrl(abs);
    if (!url) return tag;
    if (!files.includes(abs)) files.push(abs);
    return tag.replace(SRC_ATTR, `${attr[1]}"${escapeAttr(url)}"`);
  });

  return { html: out, files };
}

/** Distinct parent directories of the given files — used for webview localResourceRoots. */
export function parentDirs(files: string[]): string[] {
  const dirs: string[] = [];
  for (const f of files) {
    const d = nodePath.dirname(f);
    if (!dirs.includes(d)) dirs.push(d);
  }
  return dirs;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.apng': 'image/apng',
};

/** Max bytes we are willing to inline into an exported HTML file, per image. */
export const INLINE_LIMIT = 5 * 1024 * 1024;

/**
 * Read a local image as a data URI so exported HTML stays self-contained.
 * Returns undefined for unreadable or oversized files, letting the caller fall
 * back to a `file://` URL.
 */
export function toDataUri(absPath: string, limit = INLINE_LIMIT): string | undefined {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size > limit) return undefined;
    const mime = MIME_BY_EXT[nodePath.extname(absPath).toLowerCase()];
    if (!mime) return undefined;
    return `data:${mime};base64,${fs.readFileSync(absPath).toString('base64')}`;
  } catch {
    return undefined;
  }
}
