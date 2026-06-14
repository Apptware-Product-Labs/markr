# Reddit launch posts — Markr v6

Marketplace link: https://marketplace.visualstudio.com/items?itemName=Apptware-Product-Lab.markr
(verify the itemName matches your published publisher.name)

Etiquette: post ONE sub at a time, space them out, reply to comments in the first
few hours, don't paste identical text across subs (Reddit flags crossposts),
skip r/programming. Lead with the problem, disclose you built it, ask for feedback.

**Images:** Reddit lets you attach a gallery — lead with the headline gif, then add
the supporting ones. See docs/development/gif-shotlist.md for what to record.
Recommended gallery order: gif-18-exhaustion-handoff → gif-19-memory → gif-22-scoreboard.

---

## r/ChatGPTCoding — primary

**Title:** You know that moment when a long AI session is almost full and you dread starting over? Built a thing for exactly that — want to know if it actually helps

**Body:**
The scenario that kills me: I'm hours into a session with Claude Code (or Cursor), it's been going great, and the context window is nearly full. I know quality's about to drop, but starting a fresh session means re-explaining everything — what we decided, what we already tried and ruled out, what's half-done and uncommitted.

So I made Markr (free VS Code extension). It watches your active sessions and warns you when one's near its limit, then generates a handoff with only the stuff a fresh session can't get from the repo itself — the decisions and *why*, the dead-ends so it doesn't repeat them, your uncommitted git diff. Paste it into a new session (same tool or a different one) and keep going like nothing happened.

Two things grew out of that and I use them more than I expected:

- **Memory** — those decisions, dead-ends and constraints don't disappear when the session ends. There's a Memory tab that keeps them per project (searchable across all your projects), and new handoffs get seeded from it — so a fresh session already knows what earlier ones decided and ruled out. It also notices when you repeat the same instruction and offers to write it into your CLAUDE.md.
- **Scoreboard** — since Markr can see all your AI tools at once, it shows a little cross-tool dashboard: sessions and tokens per tool per week, a rough dead-end rate, median session length, your most-worked projects. Nothing else can build this because nothing else reads every tool.

It reads the session files your tools already write locally — nothing's uploaded, secrets are stripped before anything's stored. Beta.

What I actually want to know: **when you start a fresh session from one of these handoffs, does it genuinely pick up where you left off, or what's missing?** That's the part I can't judge from my own usage.

https://marketplace.visualstudio.com/items?itemName=Apptware-Product-Lab.markr

**Images (gallery):** gif-18-exhaustion-handoff → gif-19-memory → gif-22-scoreboard

---

## r/ClaudeAI

**Title:** For when a Claude Code session is about to hit the wall — a handoff so the next session isn't starting from zero (feedback wanted)

**Body:**
`/compact` helps, but past a point a long session degrades and I want to just start clean — except starting clean means re-explaining the whole thing.

Markr (free VS Code extension) reads your `~/.claude/projects` sessions, flags when one's getting close to full, and builds a handoff out of the *residual*: decisions + reasoning, dead-ends, constraints, your git diff — not the whole transcript. Paste into a fresh session and you're back where you were.

What makes it stick over time:

- **Memory across sessions** — it remembers the decisions and dead-ends per project, so a new session can be seeded with what earlier ones already worked out (and there's a searchable Memory tab + a history of past handoffs to re-copy). It'll even suggest turning repeated instructions into CLAUDE.md rules.
- **Scoreboard** — a local dashboard across all your tools: sessions/tokens per tool per week, dead-end rate, most-worked projects.

Secrets are stripped before anything's written to disk. Beta, extraction's heuristic.

Genuinely want feedback from people who live in Claude Code: **paste one into a fresh session — does it actually carry the thread, or miss the important bits?**

https://marketplace.visualstudio.com/items?itemName=Apptware-Product-Lab.markr

**Images (gallery):** gif-18-exhaustion-handoff → gif-19-memory → gif-22-scoreboard

---

## r/vscode

**Title:** [Extension] Markr — when an AI session nears its context limit, hand off to a fresh one without re-explaining everything

**Body:**
Markr reads the session transcripts your AI coding tools write to disk — Claude Code, Cursor, Augment, Codex, Aider, Cline, Roo, Windsurf, Gemini CLI — shows them in one sidebar, and warns when an active one is filling up. When that happens it generates a handoff (decisions, dead-ends, constraints, uncommitted diff) so the next session continues cleanly.

It's grown past just the handoff:

- **Memory** — what's been decided / ruled out per project, remembered across sessions and searchable; new handoffs seed from it; repeated instructions become suggested CLAUDE.md rules.
- **History** — every handoff you've generated, ready to re-copy or view.
- **Scoreboard** — a themeable cross-tool dashboard (sessions/tokens per tool per week, dead-end rate, most-worked projects) you can export.

All local, no daemon, nothing leaves the machine. Free, beta.

Two things I'd love feedback on: does the handoff actually save you the re-explaining, and is it detecting your tools' sessions correctly?

https://marketplace.visualstudio.com/items?itemName=Apptware-Product-Lab.markr

**Images (gallery):** gif-18-exhaustion-handoff → gif-19-memory → gif-22-scoreboard (+ a Context Bridge sidebar screenshot)

---

## r/SideProject

**Title:** My VS Code extension hit ~6k installs — the feature it was really about: rescuing a near-full AI session into a fresh one

**Body:**
Markr started as a Markdown/AI-config previewer, but the thing I actually wanted was continuity. When a long Claude/Cursor session is nearly out of context, it reads your local session files and writes a handoff carrying only what the next session can't re-derive from the repo — decisions, dead-ends, constraints, the uncommitted diff. Paste, continue.

Then it compounds: it remembers decisions across sessions (a searchable Memory tab, plus a handoff history), suggests config rules from what you repeat, and has a cross-tool Scoreboard (sessions/tokens per tool, dead-end rate, most-worked projects) — possible only because it reads every tool at once. All local-only, secrets redacted, never edits a file without your OK.

Free, beta. Sharing partly to figure out if the handoff genuinely helps people or if it's a me-problem — if you try it, I'd love to hear whether it actually saved you the re-explaining.

https://marketplace.visualstudio.com/items?itemName=Apptware-Product-Lab.markr

**Images (gallery):** gif-18-exhaustion-handoff → gif-19-memory → gif-22-scoreboard
