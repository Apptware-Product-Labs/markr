# Markr Architecture

## Overview

Markr is a VS Code extension consisting of three main components:

```mermaid
flowchart TD
    A[VS Code Extension Host] --> B[MarkdownPreviewPanel]
    A --> C[MarkrExplorerProvider]
    A --> D[Commands]
    B --> E[WebviewPanel]
    E --> F[Rendered Preview]
    E --> G[Split Edit Mode]
    B --> H[fs.watch Agent Watch]
    C --> I[Activity Bar Tree]
    I --> J[AI Configs Section]
    I --> K[Workspace Folder Tree]
```

## Component Responsibilities

### `extension.ts`
- Activates the extension
- Registers all commands (`markr.openPreview`, `markr.newAiConfig`, etc.)
- Auto-opens AI config files in Markr when activated in VS Code
- File system watcher for tree refresh

### `preview.ts`
- `MarkdownPreviewPanel` — the main webview panel
- All HTML, CSS, and JavaScript lives here as TypeScript template literals
- Handles: rendering, editing, clipboard preview, Mermaid, copy features, Agent Watch

### `markrExplorer.ts`
- `MarkrExplorerProvider` — VS Code TreeDataProvider
- Builds the Activity Bar panel with AI Configs + folder tree
- `MarkrFileItem`, `MarkrFolderItem`, `MarkrSectionItem` tree item classes

## Data Flow

```mermaid
sequenceDiagram
    participant User
    participant VSCode as VS Code
    participant Ext as Extension Host
    participant WV as Webview

    User->>VSCode: Opens CLAUDE.md
    VSCode->>Ext: onDidChangeActiveTextEditor
    Ext->>Ext: Detects AI config file
    Ext->>WV: createOrShow(document)
    WV->>User: Split edit mode opens
    Note over Ext,WV: fs.watch starts on file path

    User->>Ext: Agent edits file on disk
    Ext->>Ext: fs.watch fires (300ms debounce)
    Ext->>WV: postMessage agentUpdate
    WV->>User: Preview refreshes + green flash
```
