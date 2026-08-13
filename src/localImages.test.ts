/**
 * localImages.test.ts — resolving local image paths in rendered Markdown.
 */
import { describe, it, expect } from 'vitest';
import { marked } from 'marked';
import * as os from 'os';
import * as nodePath from 'path';
import * as fs from 'fs';
import { resolveLocalImagePath, rewriteImageSources, parentDirs, toDataUri } from './localImages';

const ctx = { docDir: '/repo/docs', workspaceRoot: '/repo', exists: () => false };

describe('resolveLocalImagePath', () => {
  it('resolves ./relative paths against the document folder', () => {
    expect(resolveLocalImagePath('./images/a.png', ctx)).toBe('/repo/docs/images/a.png');
  });

  it('resolves bare relative paths', () => {
    expect(resolveLocalImagePath('images/a.png', ctx)).toBe('/repo/docs/images/a.png');
  });

  it('resolves ../ paths above the document folder', () => {
    expect(resolveLocalImagePath('../assets/a.png', ctx)).toBe('/repo/assets/a.png');
  });

  it('decodes percent-escaped spaces', () => {
    expect(resolveLocalImagePath('my%20shot.png', ctx)).toBe('/repo/docs/my shot.png');
  });

  it('strips a query string or fragment', () => {
    expect(resolveLocalImagePath('a.png?v=2', ctx)).toBe('/repo/docs/a.png');
    expect(resolveLocalImagePath('a.png#frag', ctx)).toBe('/repo/docs/a.png');
  });

  it('expands ~ to the home directory', () => {
    expect(resolveLocalImagePath('~/pics/a.png', ctx)).toBe(nodePath.join(os.homedir(), 'pics/a.png'));
  });

  it('accepts file:// URLs', () => {
    expect(resolveLocalImagePath('file:///tmp/a.png', ctx)).toBe('/tmp/a.png');
  });

  it('prefers the workspace root for /root-relative paths that exist there', () => {
    const found = { ...ctx, exists: (p: string) => p === nodePath.join('/repo', 'images/a.png') };
    expect(resolveLocalImagePath('/images/a.png', found)).toBe('/repo/images/a.png');
  });

  it('falls back to a filesystem absolute path when not in the workspace', () => {
    expect(resolveLocalImagePath('/tmp/a.png', ctx)).toBe('/tmp/a.png');
  });

  it('treats a Windows drive letter as a path, not a URL scheme', () => {
    expect(resolveLocalImagePath('C:/pics/a.png', ctx)).toBe(nodePath.normalize('C:/pics/a.png'));
    expect(resolveLocalImagePath('C:\\pics\\a.png', ctx)).toBe(nodePath.normalize('C:/pics/a.png'));
  });

  it('leaves remote and inline sources alone', () => {
    for (const src of [
      'https://example.com/a.png',
      'http://example.com/a.png',
      'data:image/png;base64,AAAA',
      'blob:abc',
      '//example.com/a.png',
      '#anchor',
      '',
      '   ',
    ]) {
      expect(resolveLocalImagePath(src, ctx)).toBeUndefined();
    }
  });

  it('gives up on relative paths with no document folder and no workspace', () => {
    expect(resolveLocalImagePath('a.png', { exists: () => false })).toBeUndefined();
  });

  it('falls back to the workspace root for untitled documents', () => {
    expect(resolveLocalImagePath('a.png', { workspaceRoot: '/repo', exists: () => false })).toBe('/repo/a.png');
  });
});

describe('rewriteImageSources', () => {
  const toUrl = (p: string) => `vscode-resource://${p}`;

  it('rewrites images produced by marked', () => {
    const html = marked.parse('![shot](./images/a.png)') as string;
    const out = rewriteImageSources(html, toUrl, ctx);
    expect(out.html).toContain('src="vscode-resource:///repo/docs/images/a.png"');
    expect(out.html).toContain('alt="shot"');
    expect(out.files).toEqual(['/repo/docs/images/a.png']);
  });

  it('rewrites raw HTML <img> tags, quoted or not', () => {
    const html = `<img src='a.png'><img src=b.png width=10><img alt="x" src="c.png" />`;
    const out = rewriteImageSources(html, toUrl, ctx);
    expect(out.html).toContain('src="vscode-resource:///repo/docs/a.png"');
    expect(out.html).toContain('src="vscode-resource:///repo/docs/b.png" width=10');
    expect(out.html).toContain('src="vscode-resource:///repo/docs/c.png"');
    expect(out.files).toHaveLength(3);
  });

  it('leaves remote images untouched', () => {
    const html = '<img src="https://example.com/a.png" alt="remote">';
    const out = rewriteImageSources(html, toUrl, ctx);
    expect(out.html).toBe(html);
    expect(out.files).toEqual([]);
  });

  it('decodes HTML entities in the src before resolving', () => {
    const out = rewriteImageSources('<img src="a&amp;b.png">', toUrl, ctx);
    expect(out.html).toContain('src="vscode-resource:///repo/docs/a&amp;b.png"');
  });

  it('keeps the original src when the URL builder declines', () => {
    const html = '<img src="./a.png">';
    expect(rewriteImageSources(html, () => undefined, ctx).html).toBe(html);
  });

  it('does not touch non-img tags that mention src', () => {
    const html = '<p>use src="a.png"</p><a href="./a.png">link</a>';
    expect(rewriteImageSources(html, toUrl, ctx).html).toBe(html);
  });

  it('dedupes repeated images', () => {
    const out = rewriteImageSources('<img src="a.png"><img src="./a.png">', toUrl, ctx);
    expect(out.files).toEqual(['/repo/docs/a.png']);
  });

  it('handles empty input', () => {
    expect(rewriteImageSources('', toUrl, ctx)).toEqual({ html: '', files: [] });
  });
});

describe('parentDirs', () => {
  it('returns each distinct parent directory once', () => {
    expect(parentDirs(['/a/b/1.png', '/a/b/2.png', '/a/c/3.png'])).toEqual(['/a/b', '/a/c']);
  });
});

describe('toDataUri', () => {
  it('inlines a real image file', () => {
    const png = nodePath.join(__dirname, '..', 'icon.png');
    const uri = toDataUri(png);
    expect(uri?.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('declines files over the size limit', () => {
    expect(toDataUri(nodePath.join(__dirname, '..', 'icon.png'), 10)).toBeUndefined();
  });

  it('declines missing files and unknown types', () => {
    expect(toDataUri('/nope/missing.png')).toBeUndefined();
    const txt = nodePath.join(os.tmpdir(), `markr-img-test-${process.pid}.txt`);
    fs.writeFileSync(txt, 'x');
    try {
      expect(toDataUri(txt)).toBeUndefined();
    } finally {
      fs.unlinkSync(txt);
    }
  });
});
