# Reddit launch posts — Markr 5.0 (Context Bridge)

Etiquette reminders:
- Post to ONE subreddit at a time; space them out (don't blast identical text — Reddit flags crossposts).
- Lead with the problem, disclose you built it, ask for feedback. Don't be salesy.
- Reply to every comment for the first few hours.
- r/programming is hostile to launches — skip it. Use the tool/AI subs below.

---

## r/ChatGPTCoding  — problem-led (best primary target)

**Title:** I kept losing context every time I switched between Claude Code, Cursor and Augment — so I built a handoff that isn't just a chat dump

**Body:**
The thing that kills me with multi-tool workflows: I'll do a long session in Claude Code, hit a wall or run out of context, switch to Cursor or Augment… and spend 15 minutes re-explaining what I was doing, what I already tried, and why.

Pasting the old chat doesn't really work — it's huge, and the next tool just re-reads stuff it could've figured out from the repo anyway.

So I built **Context Bridge** (a free VS Code extension, part of Markr). Two ideas behind it:

1. The receiving tool can already read your repo. So the handoff shouldn't transmit your code — it should transmit only what the repo *can't* tell it: the **decisions and why**, the **dead-ends you already tried**, the **constraints you set**, and your **uncommitted git diff**. (This is basically Slepian–Wolf conditional coding applied to handoffs, if you're into information theory.)
2. It ends the handoff with a line forcing the next tool to restate the task before acting — lifted from the I-PASS medical handoff protocol, which cut hospital handoff errors ~30% in an NEJM study.

It reads sessions from Claude Code, Cursor, Augment, Codex and Aider — all local, nothing leaves your machine.

It's in beta and the decision-extraction is heuristic (regex over the transcript), so I'd genuinely love feedback on where it misses. Does this match how you switch tools, or am I solving a problem only I have?

---

## r/vscode  — feature/announcement

**Title:** [Extension] Markr 5.0 — see all your AI coding sessions in one sidebar and hand them off between tools

**Body:**
Markr started as an AI-config editor + Markdown preview (auto-opens CLAUDE.md/.cursorrules in a split-edit view, live preview while an agent edits, copy diagrams/tables as PNG). 5.0 adds the thing I actually use most now: **Context Bridge**.

It reads the session transcripts your AI tools already write to disk — Claude Code, Cursor, Augment, Codex, Aider — and shows them in one sidebar: which project, what task, token count, which are live. Then you can generate a structured handoff to continue in a different tool (decisions, dead-ends, constraints, uncommitted diff — not a raw chat paste).

Everything is local-only — it just reads files already on your machine.

Free, beta. Would love bug reports, especially around session detection across tools. What other tools should it read?

---

## r/ClaudeAI  — Claude-Code-specific angle

**Title:** Made a free tool to carry a Claude Code session into another AI tool (or back) without re-explaining everything

**Body:**
Claude Code's `/compact` and resume are great *within* Claude Code. But when I bounce a task to Cursor or Augment (or hand a stuck session to a fresh Claude), I lose the thread — what was decided, what I tried that failed, what's still uncommitted.

Built **Context Bridge** (free VS Code extension) to fix that. It reads your `~/.claude/projects` sessions (and Cursor/Augment/Codex/Aider), and generates a handoff that carries the *residual* — decisions + reasoning, dead-ends, constraints, and your `git diff` — instead of dumping the whole conversation. The paste-ready prompt makes the receiving model restate the task before it starts.

Local-only, beta. If you live in Claude Code, I'd love to know whether the decision log actually captures the "why" from your sessions — that's the part I'm tuning.

---

## r/SideProject  — builder story

**Title:** Shipped 5.0 of my VS Code extension — the feature I almost didn't build is now the one people ask about

**Body:**
I've been building Markr (AI-config editor + Markdown preview for VS Code). For 5.0 I added a "Context Bridge" that lets you hand off an AI coding session from one tool to another without losing context.

The interesting part for me was *not* building the obvious thing (mirror the chat). The chat is mostly re-derivable — the next AI can read the repo. So I made it transmit only the irreducible stuff: decisions + why, failed approaches, constraints, and the uncommitted diff. Grounded it in two old, proven ideas (Slepian–Wolf coding + the I-PASS clinical handoff protocol).

Free + beta. Sharing partly to find out if the framing resonates or if I've over-engineered a non-problem. Honest takes welcome.
