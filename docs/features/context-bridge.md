# Context Bridge & Conditional Residual Handoff (CRH)

> _Status: beta (shipped in 5.0.0). Decision/dead-end extraction is heuristic and improving._

The **Context Bridge** lets you switch between AI coding tools without losing context. It reads the session transcripts your tools already write to disk and, on request, generates a high-fidelity handoff to continue the work in a different tool.

Everything is **local-only**: Markr reads files already on your machine and sends nothing anywhere.

---

## What it reads

| Tool | Source on disk |
| --- | --- |
| Claude Code | `~/.claude/projects/<slug>/<uuid>.jsonl` |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` + `archived_sessions/` |
| Cursor | `…/Cursor/User/workspaceStorage/<hash>/state.vscdb` |
| Augment | `…/Code/User/workspaceStorage/<hash>/Augment.vscode-augment/augment-kv-store/` (LevelDB WAL + SSTable) |
| Aider | `.aider.chat.history.md` in the workspace |

The sidebar shows each session's project, title, token count, last activity, and a live indicator for sessions active in the last 2 hours. Open-workspace sessions are never dropped by the session cap.

---

## Conditional Residual Handoff (CRH)

The handoff is **not** a chat dump. It is built on two proven foundations:

1. **Slepian–Wolf conditional source coding** — if the decoder already holds side information `Y`, you only need to transmit `H(X | Y)`. The receiving agent's side information *is the repository* — it can read every file. So CRH transmits only the **residual**: what the repo can't tell the next agent.
2. **I-PASS clinical handoff protocol** — the empirically validated structure for loss-resistant handoffs, including **synthesis by the receiver** (the receiver restates the handoff before acting).

### What CRH transmits

- **🧠 Decision log** — decisions + rationale mined from the full transcript (the "why" behind the current code).
- **🛑 Dead-ends** — failed approaches the next agent must not retry.
- **📌 Constraints** — hard requirements the user stated (with a pasted-content reject filter to drop review-bot/log noise).
- **🔀 In-flight delta** — `git branch` + `git status` + `git diff --stat HEAD` captured at handoff time (the uncommitted work reading committed code can't show).
- **📁 Pointers, not payload** — modified-file lists are emitted as "read these" pointers for repo-aware targets.
- **✅ Receiver synthesis** — the paste block ends by requiring the receiver to restate the task + the one constraint before acting.

### Repo-aware vs repo-less targets

Repo-aware targets (Claude Code, Cursor, Codex, Augment) get residual + pointers. Repo-less targets (web ChatGPT) get a different framing telling them to ask for files, because the side-information assumption doesn't hold there.

### Task de-contamination

A long session often ends on a throwaway follow-up ("give me a commit message"). CRH detects these and leads the handoff with the real task instead of the throwaway.

---

## Tests

Pure functions (title derivation, task de-contamination, mining, document structure) are covered by `src/sessionReader.test.ts` — run with `npm test`.

## Known limitations (beta)

- Decision / dead-end / constraint extraction is regex-heuristic; expect occasional misses or false positives.
- Claude Desktop / claude.ai chats are **not** read (cache-only, no repo association).
- No measured accuracy number yet — an eval harness is the GA gate.
