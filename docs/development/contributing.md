# Contributing to Markr

We welcome contributions! Here's how to get started.

## Workflow

1. Fork the repository
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes and run `npm run build` to verify
4. Open a pull request with a clear description

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/short-name` | `feat/token-warnings` |
| Bug fix | `fix/short-name` | `fix/mermaid-gantt-syntax` |
| Docs | `docs/short-name` | `docs/update-readme` |
| Chore | `chore/short-name` | `chore/bump-version` |

## Commit Messages

Follow conventional commits:

```
feat: add token budget warning thresholds
fix: Mermaid re-renders on theme switch
docs: update README for v3.9.0
chore: bump to v3.9.0
```

## What to Work On

Check the [roadmap](https://github.com/Apptware-Product-Labs/markr/issues) for open issues.

> [!TIP]
> The easiest first contribution is adding a new AI config filename to `AI_CONFIG_NAMES` in both `markrExplorer.ts` and `preview.ts`.

## Testing

There are no automated tests yet (planned). Manual testing steps:

- [ ] Open a `.md` file → preview renders correctly
- [ ] Open `CLAUDE.md` → auto-opens in Markr, split-edit activates
- [ ] Edit in textarea → split preview updates live
- [ ] Switch themes → Mermaid diagrams re-render immediately
- [ ] Click "Copy table" → paste into Slack looks correct
- [ ] Click "📷 Image" → PNG copied to clipboard
