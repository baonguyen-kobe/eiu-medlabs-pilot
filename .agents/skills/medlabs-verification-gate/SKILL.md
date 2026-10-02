---
name: medlabs-verification-gate
description: MedLabs change-aware completion and evidence gate. Select the smallest sufficient verification from actual diff and blast radius, permit prior PASS reuse only when impact is demonstrably unchanged, and never call an unexecuted check PASS.
---

# MedLabs Verification Gate

## Evidence labels

Every reported verification item must use exactly one of the five literal labels:

- `RUN AND PASS` — executed against the current relevant change and passed.
- `RUN AND FAIL` — executed against the current relevant change and failed; blocks task completion.
- `REUSED PRIOR PASS — UNCHANGED IMPACT` — not rerun because covered behavior, shared/transitive dependencies, and runtime/dependency configuration remain unchanged and prior evidence still applies.
- `NOT RUN — NOT REQUIRED FOR CURRENT IMPACT` — outside the verified blast radius.
- `NOT RUN — BLOCKED` — check could not start due to missing environment, credentials, or fixtures; blocks task completion.

A check not executed against the current change must never be labeled PASS. Required checks that fail or are blocked prevent claiming task completion; they must not be converted into not-required.

## Required workflow

Follow this progression for standard tasks:

`IMPLEMENT`
→ `TARGETED VERIFY`
→ `REPORT`

Commit, push, CI, and deployment are separate delivery operations executed only with explicit current user authorization.

## Pre-push hygiene (only when push is authorized)

Before an explicitly authorized push after tracked changes:

1. **Determine actual changed files** from Git status and diff.
2. **Run Prettier `--check`** on applicable changed files only to confirm formatting. Do not perform mass `--write` on unrelated files; apply formatting fixes only to task-owned files.
3. **Reuse `npm run preflight:changed -- <base-ref>`** when the entire changed set is within delivery scope. _Note: this helper checks untracked/staged/unstaged files, runs diff check, Prettier check, and ESLint; it does NOT run behavioral tests, typecheck, DB tests, or blast radius analysis. Do not run it if it forces fixing unrelated baseline debt outside task scope._
4. **Run ESLint** on changed JS/TS files where applicable.
5. **Run `git diff --check`** to prevent whitespace and syntax conflicts.
6. **Run lightweight CHANGED/IMPACTED tests** covering the touched boundary.
7. **Inspect `git diff --stat` and `git status`** to ensure no unintended files or changes are staged.
8. **Only then permit commit and push.**

Pre-push hygiene rules:

- **Never use CI as the first formatter.** Format and check touched files locally before pushing.
- **Never globally modify unrelated files** to make a hotfix or targeted change pass formatting.
- **Global baseline debt must be classified separately** from task-owned changes.
- **Prior PASS may still be reused** only under the unchanged impact rules below.
- **An unexecuted check must never be called PASS.**

## Determine impact first

Before selecting verification:

1. inspect changed paths directly;
2. inspect the relevant behavioral and security blast radius;
3. inspect relevant shared and transitive dependencies via source and LSP (and GitNexus when materially helpful);
4. consult the canonical quality matrix in `README.md` (`Kiểm tra chất lượng`);
5. broaden verification when impact remains uncertain.
   Do not invent an impact framework or assume missing scripts exist.

## Prior PASS reuse

Prior PASS evidence may be reused only when all are true:

- the covered behavior is unchanged;
- relevant shared/transitive dependencies are unchanged;
- relevant runtime/dependency configuration is unchanged;
- the prior evidence remains applicable to the current exact state.

If these conditions cannot be demonstrated, do not reuse the evidence. When impact changes, re-run only the affected area rather than mechanically running every suite. An existing production build may only be reused for smoke testing if the corresponding source and build configuration are completely unchanged.

## Scope

Run the smallest sufficient verification.

Do not mechanically run Full E2E.

Full E2E is reserved for:

- release candidates;
- major integration;
- broad cross-cutting changes;
- unresolved impact uncertainty;
- explicit user/Reviewer request.

## Failure

Any required failing check blocks completion.

Never weaken:

- tests;
- types;
- lint;
- authorization;
- RLS;
- validation;
- security controls;

to make verification pass.

## Report

For every relevant verification item, state:

- one exact evidence label;
- what was or was not run;
- why that evidence remains sufficient.
