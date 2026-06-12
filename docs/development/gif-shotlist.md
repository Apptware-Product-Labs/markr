# GIF shot list — 5.0.0 launch

Record with macOS `Cmd+Shift+5` (Record Selected Portion), keep the window ~1280px wide,
then convert with `./scripts/record-gif.sh <rec.mov> <gif-name> [start] [duration]`.

Target: each gif **≤ ~8 MB**, 10–18s, one clean take. Files go in `images/screenshots/`.
The README references them by raw GitHub URL, so commit + push and the URL resolves.

---

## gif-15-context-bridge.gif  — _headline_
**Feature:** Context Bridge + CRH handoff.
1. Open the Markr Context Bridge sidebar — sessions across Claude / Cursor / Augment / Codex, tool-colored badges, a live (green) dot.
2. Click a session → the "Transfer context to" panel appears.
3. Click a target (e.g. Claude) → toast "Markr handoff copied."
4. Paste into a chat → linger on the CRH payload: **Decision log + Dead-ends + git in-flight + SYNTHESIS** line. This is the wow moment.

```
./scripts/record-gif.sh ~/Desktop/rec.mov gif-15-context-bridge
```

## gif-16-ai-health.gif
**Feature:** AI Config Health (toolbar ❤️/pulse icon → `markr.openAiHealth`).
1. Click **Open AI Config Health** in the Markr sidebar title bar.
2. Show the report: **score /100**, file count, token total.
3. Scroll the findings — Critical/High/Medium with concrete fixes (e.g. "Testing guidance is missing", "secret in config").
4. End on the prioritized recommendations.

```
./scripts/record-gif.sh ~/Desktop/rec.mov gif-16-ai-health
```

## gif-17-config-bundle.gif
**Feature:** Copy AI Workspace Bundle (toolbar 📦 icon → `markr.copyAiConfigBundle`).
1. Click **Copy AI Workspace Bundle**.
2. Toast confirms it's copied.
3. Paste into a chat / new file → show CLAUDE.md + .cursorrules + agent.md concatenated into one readiness-scored bundle.

```
./scripts/record-gif.sh ~/Desktop/rec.mov gif-17-config-bundle
```

---

After recording all three:

```bash
git add images/screenshots/gif-15-context-bridge.gif \
        images/screenshots/gif-16-ai-health.gif \
        images/screenshots/gif-17-config-bundle.gif
```
