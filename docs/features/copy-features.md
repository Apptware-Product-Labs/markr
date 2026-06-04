# Copy Features

Markr has three layers of copy functionality, each serving a different destination.

## 1. Copy table as rich HTML

Hover any table → **"Copy table"** button appears top-right.

Copies `text/html` + `text/plain` (TSV).

| Destination | Result |
|-------------|--------|
| Slack | Renders as a real formatted table |
| Google Chat | Renders as a real formatted table |
| Google Docs | Pastes as a formatted table |
| Notion | Imports as a database table |
| Excel / Sheets | Pastes as tab-separated columns |

## 2. Copy as PNG image

Hover any **table**, **code block**, or **Mermaid diagram** → **"📷 Image"** button.

- 2× retina resolution
- Theme-aware background (white on Light/Notion, dark on Dark/Linear)
- Falls back to PNG download if clipboard API is unavailable

| Destination | Result |
|-------------|--------|
| Figma | Inserts as a high-res image layer |
| Confluence | Embeds as an image |
| Slack | Uploads and displays inline |
| Slide decks | Paste as image |

## 3. Rich copy on selection (Cmd+C)

Select any content in the preview → press **Cmd+C** (or Ctrl+C).

Markr intercepts the copy event and writes `text/html` alongside `text/plain`. A toast shows "✓ Copied with formatting" when structured content was selected.

Works for: **tables, lists, headings, bold/italic text, code blocks, blockquotes**.

## Technical: SVG foreignObject rendering

PNG export uses SVG `foreignObject` to render HTML content to a `<canvas>` element:

1. Resolve all CSS variables to actual colour values (no `var()` in SVG)
2. Wrap element HTML in an SVG with `<foreignObject>`
3. Encode as base64 data URL
4. Draw to 2× canvas
5. `canvas.toBlob()` → `ClipboardItem({ 'image/png': blob })`
