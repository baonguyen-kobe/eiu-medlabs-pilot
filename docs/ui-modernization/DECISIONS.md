# EIU MedLabs UI Modernization Decisions

This file records durable accepted and pending decisions. Do not silently rewrite accepted history. Add a new decision or explicitly supersede an existing decision when direction changes.

## DEC-UI-20261104 — Workflow skill refinement

**Status:** APPLIED FOR DESIGN REVIEW — owner requested the skill; visual
acceptance pending. Frontend rollout is outside this Figma task.

UI Master Section 1 records the design direction: functional text at least
14px, phone inputs at least 16px, bounded list record regions with pagination
outside the scroller, visible drawer dismissal and bounded body/footer, clear
load/save states and distinct dismissal/destructive wording. Preserve the
existing palette, typeface, two-word labels and no horizontal phone scrolling.
`control-border` strengthens field boundaries without changing card dividers.
Personnel checkbox types/eligibility and the 42-cell month calendar mirror
current source; this creates no new role, capability or business transition.
Evidence: [workflow review](FIGMA_WORKFLOW_APP_UI_2026-11-04.md).

## DEC-UI-20261030 — Concise labels and phone reflow

**Status:** ACCEPTED owner direction for Figma refinement; frontend implementation pending.

The owner approved the polish proposal, requested labels under three words,
and prohibited horizontal scrolling on mobile. The canonical rule is recorded
in UI Master Section 1. At the existing mobile breakpoint up to 920px, this supersedes Strategy A
and the historical permission to scroll tables horizontally. Select a vertical
summary/detail, record or stacked-control presentation per family; retain all
business fields. Desktop/tablet scrolling remains permitted. Names, stored
business content and necessary explanatory sentences are not truncated to
satisfy the label limit. This does not advance prior implementation tasks.

## DEC-UI-001 — Preserve MedLabs identity

**Status:** ACCEPTED

Keep:

- Be Vietnam Pro
- EIU blue/gold/cream
- existing navigation direction
- existing table/card family
- approved sidebar, topbar, KPI, form, calendar, import, evidence, and login directions

**Reason:** The audit found a coherent, deliberately branded operational product.

## DEC-UI-002 — No major frontend redesign

**Status:** ACCEPTED

**Decision:** Improve and consolidate incrementally. Do not replace the frontend visual language, framework, Tailwind, or component architecture wholesale.

**Reason:** The audit found a functional product that needs consistency, accessibility, responsive refinement, and maintainability work rather than replacement.

## DEC-UI-003 — Mobile tables use per-table strategies

**Status:** ACCEPTED

Do not convert all tables to cards. Use the audit strategy appropriate to the table's information architecture:

- A — horizontal scrolling acceptable
- B — hide lower-priority columns
- C — transform rows into cards
- D — expandable/detail row
- E — split summary/detail
- F — mobile-specific condensed table

Record each family decision in the tracker and QA evidence.

## DEC-UI-004 — No new component or UI library

**Status:** ACCEPTED

Build only evidence-justified structural primitives around existing MedLabs styling. Do not introduce a second visual/component system.

## DEC-UI-005 — ConfirmDialog is the focus-management reference

**Status:** ACCEPTED

Use `ConfirmDialog` behavior as the reference for shared dialog/drawer foundations: initial focus, Escape handling when safe, focus trapping, focus return, pending handling, accessible title/description, and stable actions.

This decision does not require every overlay to use identical visual content or size.

## DEC-UI-006 — Global CSS cleanup must be incremental

**Status:** ACCEPTED

Never perform one giant `globals.css` rewrite. Execute the stable `DS-02.N` batches only after required baseline, foundation, pilot, and visual evidence exist.

## DEC-UI-007 — Accessible signature interaction

**Status:** PENDING

**Question:** What business-approved non-pointer method should satisfy equipment handover/return and Basic Medical confirmation/signature workflows?

Do not invent the answer. `DEC-01` and `A11Y-01` remain blocked until the user/business owner accepts a behavior.
