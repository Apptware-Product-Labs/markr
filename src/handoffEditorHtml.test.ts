import { describe, it, expect } from 'vitest';
import { buildHandoffEditorHtml, type HandoffEditorView } from './webview/handoffEditorHtml';

const base: HandoffEditorView = {
  text: 'hello', sourceLabel: 'Claude Code', targetLabel: 'Cursor', isClipboard: false, redactions: 0,
};

describe('buildHandoffEditorHtml', () => {
  it('always renders an editable textarea seeded with the handoff text', () => {
    const html = buildHandoffEditorHtml({ ...base, text: 'my handoff body' });
    expect(html).toContain('<textarea');
    expect(html).toContain('my handoff body');
  });

  it('shows a Deliver button for a native-file target', () => {
    expect(buildHandoffEditorHtml({ ...base, isClipboard: false })).toContain('id="deliver"');
  });

  it('hides the Deliver button for the clipboard target (Copy only)', () => {
    const html = buildHandoffEditorHtml({ ...base, isClipboard: true, targetLabel: 'Clipboard' });
    expect(html).not.toContain('id="deliver"');
    expect(html).toContain('id="copy"');
  });

  it('notes redaction count only when > 0', () => {
    expect(buildHandoffEditorHtml({ ...base, redactions: 0 })).not.toContain('redacted');
    expect(buildHandoffEditorHtml({ ...base, redactions: 2 })).toContain('2 secrets redacted');
  });

  it('escapes HTML in the handoff text so it cannot break out of the textarea', () => {
    const html = buildHandoffEditorHtml({ ...base, text: '</textarea><script>x()</script>' });
    expect(html).not.toContain('</textarea><script>');
    expect(html).toContain('&lt;/textarea&gt;&lt;script&gt;');
  });
});
