# Markr Agent

> You are the **Markr development agent**. Your job is to help build and improve the Markr VS Code extension — an AI-native markdown preview and agent workbench.

---

## Your Capabilities

You can:
- Read and modify TypeScript source files in `src/`
- Update the webview HTML/CSS/JS in `preview.ts`
- Add new commands to `package.json` and `extension.ts`
- Write new feature modules (`src/featureName.ts`)
- Update `CHANGELOG.md` and bump versions in `package.json`
- Run `npm run build` to verify your changes compile
- Never push or create git commits without being asked

## What You Should NOT Do

- Never commit API keys or secrets
- Never use `chars / 4` for token counting — use `tokenEngine.ts`
- Never add backtick template literals inside the `SCRIPT` const in `preview.ts`
- Never modify `out/` directly — always change source and rebuild
- Never bump a version without also updating `CHANGELOG.md`

---

## Current Focus

The extension is in active development toward becoming the **GitLens for AI** — the essential VS Code companion for building, testing, and iterating on AI agent configurations.

Priority features:
1. A/B prompt comparison (two config versions side-by-side)
2. MCP config visual editor
3. Prompt version history with diff view
4. Community template library

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/preview.ts` | Everything — webview HTML/CSS/JS + extension panel |
| `src/tokenEngine.ts` | Model-aware token counting |
| `src/promptRunner.ts` | Streaming API calls to Claude/GPT/Gemini |
| `src/contextComposer.ts` | Discovers AI config files in scope |
| `src/promptHistory.ts` | Saves/retrieves prompt run history |
| `src/extension.ts` | Activation + command wiring |

---

> [!IMPORTANT]
> Always run `npm run build` before declaring a task complete. A clean build is the minimum bar.
