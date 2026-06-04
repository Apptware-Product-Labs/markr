#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# demo-agent-edit.sh
# Simulates an AI agent progressively editing CLAUDE.md so you can record
# the "Agent Watch" GIF without running Claude Code.
#
# Usage:
#   bash scripts/demo-agent-edit.sh
#
# Before running:
#   1. Open the markr repo folder in VS Code
#   2. Double-click CLAUDE.md in Explorer — Markr opens it automatically
#   3. Start recording your screen
#   4. Run this script in a terminal
# ─────────────────────────────────────────────────────────────────────────────

TARGET="$(dirname "$0")/../CLAUDE.md"

echo "🤖 Simulating agent edits to CLAUDE.md..."
echo "   Watch the Markr preview — it updates without saving!"
echo ""

sleep 2

# Step 1: Add a new section after a short pause
cat >> "$TARGET" << 'EOF'

---

## Agent Rules (added by Claude)

> These rules were written by Claude Code during a session on this project.

- Always prefer `const` over `let` unless reassignment is needed
- Use early returns to reduce nesting depth
- Prefer explicit types over `any` in all new code
EOF

echo "✓ Step 1: Added 'Agent Rules' section (+tokens)"
sleep 3

# Step 2: Add another block
cat >> "$TARGET" << 'EOF'

## Performance Notes

| Area | Guideline |
|------|-----------|
| Bundle size | Keep `.vsix` under 5 MB |
| Scan speed | Exclude `build/`, `coverage/`, `.turbo/` |
| Render debounce | 120ms for VS Code events, 300ms for fs.watch |
| GIF size | Optimise to < 10 MB before committing |
EOF

echo "✓ Step 2: Added 'Performance Notes' table (+tokens)"
sleep 3

# Step 3: Add a final note
cat >> "$TARGET" << 'EOF'

> [!NOTE]
> The token counter in the toolbar shows exactly how much context window this file consumes. Keep it under 4,000 tokens for best results with Claude Code.
EOF

echo "✓ Step 3: Added token warning alert (+tokens)"
echo ""
echo "Done! Stop recording. You should have seen 3 live updates with green flashes."
echo ""
echo "To reset CLAUDE.md to its original state, run:"
echo "   git checkout CLAUDE.md"
