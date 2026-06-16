/**
 * katexMath.test.ts — the marked KaTeX extension.
 */
import { describe, it, expect } from 'vitest';
import { Marked } from 'marked';
import { katexExtension } from './katexMath';

function md() { const m = new Marked(); m.use(katexExtension()); return m; }

describe('katexExtension', () => {
  it('renders inline $…$ math to KaTeX HTML', () => {
    const out = md().parse('The area is $x^2$ today.') as string;
    expect(out).toContain('class="katex"');
    expect(out).toContain('today');
  });

  it('renders display $$…$$ math', () => {
    const out = md().parse('$$\\int_0^1 x\\,dx$$') as string;
    expect(out).toContain('katex');
    expect(out).toContain('katex-display');
  });

  it('does NOT treat prose dollar signs as math', () => {
    const out = md().parse('It costs $5 and $10 total.') as string;
    expect(out).not.toContain('class="katex"');
    expect(out).toContain('$5 and $10');
  });

  it('renders a bad expression as an error, not a crash (throwOnError:false)', () => {
    const out = md().parse('$\\frac{1}{$') as string; // malformed
    expect(typeof out).toBe('string');           // did not throw
    expect(out.length).toBeGreaterThan(0);
  });

  it('leaves $…$ inside inline code alone', () => {
    const out = md().parse('Use `$HOME` in the shell.') as string;
    expect(out).toContain('<code>$HOME</code>');
    expect(out).not.toContain('class="katex"');
  });
});
