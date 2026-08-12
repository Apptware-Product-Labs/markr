# Markr UI Modernization — plan (v6.7 "Design System" → v6.8 "Studio")

**Goal:** elevate Markr from "functional / common-looking" to "modern, clean,
premium (Raycast-grade)" and **cohesive** across every surface. This addresses the
retention lever (it feels premium) and the downloads lever (each batch is a
demo-able "modern UI" update).

**Aesthetic direction (locked):** Raycast — layered surfaces, soft elevation,
subtle gradients, rounded cards, refined type, tasteful micro-interactions. One
restrained accent (Markr orange), not gradient-everywhere.

**Status legend:** ☐ todo · ◐ in progress · ✅ done

---

## Phase 0 — Design foundation (build once; everything inherits it)
✅ Extracted the Raycast tokens → `src/webview/markrUI.ts` (MARKR_UI_TOKENS + MARKR_UI_COMPONENTS).
   Original todo below.

☐ Extract the Raycast tokens (already prototyped inline in the Context Bridge) into
a shared module `src/webview/markrUI.ts`:
- **Tokens:** layered surfaces `--s0/1/2`, lines `--line`/`--line-soft`, radii
  `--r`/`--r-sm`/`--r-pill`, soft shadows `--sh-1/2`, `--accent`/`--accent-2`,
  focus `--ring`, motion timings, a **type scale** (sizes / weights / tracking).
- **Component CSS library** reused everywhere: buttons (primary/secondary/ghost),
  cards, chips/badges, inputs, **segmented control**, tabs, tooltips, empty +
  loading states, focus rings.
- **Adaptive:** all colors via `color-mix()` on the host theme → correct in
  light / dark automatically.

This is the single biggest "it's one premium product" lever.

## Batches (each: build → screenshot-verify → install → react)

- ✅ **Batch 1 — Context Bridge.** Migrated onto `markrUI`: surfaces, header,
  session cards, action buttons, segmented scope toggle, filter chips, search
  input, view tabs. (Memory/History/tool-health/handoff-panel inherit the tokens;
  fine-polish deferred if needed.)
- ◐ **Batch 2 — Preview (biggest, most-seen).** *(done: theme-safe structural pass
  — calmer toolbar chrome; softer rounded code blocks (10px + subtle shadow);
  rounded tables; rounded images w/ soft shadow; refined blockquotes; inline-code
  radius. Deferred: a deeper per-theme typography/color pass — needs theme-by-theme
  verification since the preview is a 4.3k-line themed surface.)*
- ✅ **Batch 3 — Config Lab + Handoff editor.** Both migrated onto `markrUI`:
  refined notice/test cards + result panels, gradient primary buttons, ring-focus
  inputs; the handoff editor's hint/textarea/buttons aligned. Verified dark + light.
- ☐ **Batch 4 — Agent Map + Scoreboard.** Already Markr-themed → retune node
  cards / chips / toolbar / legend and Scoreboard panels + chart palette.
- ☐ **Batch 5 — Workbench launcher + sidebar.** Refined rows, consistent
  iconography, tighter spacing.
- ☐ **Batch 6 (capstone) — "Markr Studio" home + status-bar presence.** A
  command-center dashboard (live sessions, agent map, health, handoffs) + an
  always-visible status-bar entry (`✦ Markr · 3 live · 2⚠`). Ships as **v6.8**.

## Cross-cutting polish (applied throughout, not a separate batch)
- **Iconography:** unify mixed emoji + codicon + inline-SVG into one crisp line-icon
  set (emoji → refined icons reads far more premium).
- **Typography & density:** one type scale + a 4px spacing grid across all webviews.
- **Motion:** consistent, subtle micro-interactions; respect `prefers-reduced-motion`.
- **States:** unified empty / loading skeletons.
- **Light/dark parity + a11y:** verify every surface in both themes; carry forward
  the keyboard / focus work already in the Context Bridge.

## Sequence & shipping
Order: **Phase 0 → Batch 1 → Batch 2 (Preview) → 3 → 4 → 5 → 6.** Each batch is
independently shippable under **6.7.x**, capped by the **6.8 "Markr Studio"**
release for the home + status bar.

## Verification
Each webview has (or gets) a `scripts/preview-*.mjs` render harness — render it with
stubbed `acquireVsCodeApi`, screenshot in dark + light at real widths, and assert
DOM/interactions before packaging. (See existing `preview-agentmap.mjs`,
`preview-bridge.mjs`, `preview-handoff.mjs`, etc.)
