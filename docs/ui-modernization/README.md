# EIU MedLabs UI Modernization — Start Here

This directory is the authoritative, Git-tracked continuity system for the EIU MedLabs UI/UX, responsive-design, accessibility, design-system, and frontend-modernization effort. Chat history is not required to resume work.

The system is agent/model-independent. Any agent that can read the repository can resume by reading:

1. `docs/ui-modernization/README.md`
2. `docs/ui-modernization/CURRENT.md`
3. `docs/ui-modernization/TRACKER.md`
4. `docs/ui-modernization/DECISIONS.md`

Git-tracked project state is authoritative. Continuity must not depend on a ChatGPT account, Codex session, OMP model, GPT-5.6 Sol/Terra, Gemini, terminal lifetime, or chat memory.

## Source-of-truth hierarchy

This hierarchy governs UI modernization continuity. It does NOT override repository business/security contracts, the canonical UI Master (`docs/UI_DESIGN_SYSTEM_V2_MASTER.md`), effective source code truth, or production truth under `docs/DOCUMENTATION_AUTHORITY.md`.

Highest to lowest for UI continuity:

1. Explicit current user instruction
2. Repository business/security contracts and canonical UI Master
3. `docs/ui-modernization/DECISIONS.md`
4. `docs/ui-modernization/CURRENT.md`
5. `docs/ui-modernization/TRACKER.md`
6. `docs/ui-modernization/MASTER-PLAN.md`
7. Audit evidence in `docs/ui-modernization/audits/`

When two continuity sources disagree, follow the higher-authority source. Do not silently rewrite history. Record deliberate changes in `DECISIONS.md` or append them to `WORKLOG.md`.
## Session startup protocol

For any session working on UI modernization:

1. Read repository `AGENTS.md`.
2. Read `docs/ui-modernization/README.md` once per task.
3. Read `docs/ui-modernization/CURRENT.md`.
4. Read the relevant `docs/ui-modernization/TRACKER.md` row.
5. Read `docs/ui-modernization/DECISIONS.md` for relevant architectural decisions.
6. Consult `MASTER-PLAN.md` or audit evidence only as needed for the active scope.

Inspect branch and working tree state at execution start:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
```

Rules:

- UI tasks follow the `ui-modernization` branch; release tasks follow `main`.
- Do not fetch or switch branches merely at session startup or during unrelated documentation audits.
- Do not switch branches when unrelated dirty working tree changes exist; report the conflict rather than stashing or resetting.
- Reuse already-read context when files have not changed.
- Do not redo tasks whose tracker status is `DONE`.
- If `CURRENT.md` identifies an active task, inspect existing source and `git diff`, then continue that task.
- If there is no active task, select the first eligible `READY` task by dependency order, phase order, then priority unless the user explicitly requests another task.
- Do not put unrelated tasks `IN_PROGRESS` together.
## Explicit user-request rule

An explicit current user request takes precedence. If the user requests work unrelated to UI modernization, perform that task. Do not hijack unrelated work merely because modernization remains active.

## Generic resume requests

When the user says only `continue`, `resume`, `proceed`, `tiếp tục`, `làm tiếp`, `đọc repo rồi tiếp tục`, or equivalent:

```text
read CURRENT
↓
read TRACKER
↓
inspect git status and diff
↓
verify branch and commit
↓
resume the IN_PROGRESS task
or take the first eligible READY task
```

Do not ask the user to reconstruct prior work. If `CURRENT.md` and Git disagree, reconcile Git history, the current diff, `WORKLOG.md`, and `TRACKER.md`; report the inconsistency before any destructive action.

## Task claiming protocol

Update `CURRENT.md` when claiming a task, changing status/blocker, handing off, or completing a coherent batch—not on every chat turn:

```text
Active task: <ID>
Status: IN_PROGRESS
Starting commit: <sha or uncommitted working tree>
```

A coherent batch may contain tightly coupled parent/child tasks only when documented. Normally, only one primary implementation batch is `IN_PROGRESS`.

## Task completion protocol

Before changing a task to `DONE`, record applicable verification evidence in `TRACKER.md`:

- Record the relevant verification command or scenario, observed result, and scope/limitations.
- Do not force all viewports, keyboard tests, or DB tests for localized edits where those facets are outside the touched scope.
- A commit SHA is recorded only when a commit actually exists; otherwise record uncommitted state and affected files without manufacturing commits to fill fields.
- Shorthand matrix values (`PASS`, `FAIL`, `PARTIAL`, `BLOCKED(reason)`, `NOT_RUN`, `N/A`) are compact cell shorthands for tracking tables; implementation reports use the 5 gate labels (`RUN AND PASS`, `RUN AND FAIL`, `REUSED PRIOR PASS — UNCHANGED IMPACT`, `NOT RUN — NOT REQUIRED FOR CURRENT IMPACT`, `NOT RUN — BLOCKED`).
- Do not rewrite historical statuses to match wording changes.

If implementation exists but required verification is incomplete or awaiting user visual review, keep the task `VERIFY`, not `DONE`. Never turn an unavailable check into `PASS`. Keep known local test-environment limitations distinct from code regressions.
## Interruption recovery

### Case A — Uncommitted source changes exist

Read `CURRENT.md` and inspect `git diff`. Determine whether the changes belong to the recorded active task. Continue them; do not restart from scratch.

### Case B — Working tree is clean

Compare:

- the baseline/last-known commit in `CURRENT.md`
- `git rev-parse HEAD`
- `WORKLOG.md`
- `TRACKER.md`

If HEAD is newer than `CURRENT.md`, inspect intervening commits and update tracking state before implementation.

### Case C — Tracking update is incomplete

Use Git commit evidence and recorded verification. Do not mark work `DONE` without evidence.

## Session end protocol

Before ending a UI-modernization session:

1. Run applicable targeted verification.
2. Update `CURRENT.md` and `TRACKER.md` if status, blocker, or evidence changed.
3. Update `QA-MATRIX.md` only when matrix evidence is actually executed or changed.
4. Update `DECISIONS.md` only if a durable architectural decision changed.
5. Append `WORKLOG.md` only for major milestones or handoffs without duplicating command outputs.
6. Review `git diff`.
7. **Never commit, push, merge, or deploy without explicit current authorization.** If authorized, commit only when task and tracking state form a coherent batch.

This protocol works locally without requiring chat history.
## Commit convention

Prefer stable task IDs in implementation commit subjects:

```text
fix(AUTH-01): unify password recovery auth shell
fix(A11Y-03): add combobox keyboard navigation
feat(TABLE-01): add accessible table scroll viewport
fix(TOUCH-01): enlarge staff shift action targets
```

Implementation, verification evidence, and tracking updates for the same task should normally be committed together. Avoid separate tracker-only commits unless necessary.

## Branch strategy

- Durable tracking foundation: writable fork `main`.
- UI implementation: long-lived `ui-modernization` branch.
- Do not merge or open a pull request automatically unless explicitly authorized.
- Explicit user direction may change this strategy.

## Key files

- `CURRENT.md` — concise active checkpoint and next action
- `TRACKER.md` — authoritative stable-ID task registry
- `DECISIONS.md` — durable accepted and pending decisions
- `MASTER-PLAN.md` — goals, phase order, dependencies, and Definition of Done
- `QA-MATRIX.md` — route-by-route rendered verification evidence
- `WORKLOG.md` — append-only historical record
- `audits/` — immutable historical audit evidence
