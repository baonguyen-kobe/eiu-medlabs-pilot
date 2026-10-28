# Current UI Modernization State

Last updated: 2026-10-28

## Pilot source publication — current authorization

The owner explicitly authorized updating the pilot GitHub repository on2026-10-28. Deliver the current source to `origin/main` of `baonguyen-kobe/eiu-medlabs-pilot`; keep the original application unchanged. This supersedes earlier no-commit/no-push checkpoint notes below for this bounded publication only. Visual/operational acceptance remains VERIFY. No cloud database migration, production activation or manual deployment is authorized by this source-publication step.

Portable handoff and remaining cloud/backend prerequisites: [Pilot implementation status](../PILOT_IMPLEMENTATION_STATUS_2026-10-28.md). Git remote history is the publication truth.

## Current language correction checkpoint

APP-I18N — VERIFY, owner requested the whole application (VI default, one language at a time). Shared cookie/SSR/context switch and static interface migration are retained in the same pilot working tree. No form remount/route refresh on language change; business IDs, payloads, user data and historical evidence remain unchanged.

- Contract: `openspec/changes/application-language-switch/`; canonical visual rule recorded in `docs/UI_DESIGN_SYSTEM_V2_MASTER.md`.
- Current item-by-item plan/design status and language evidence: `D:/Orca/MedLabs-Deep-Review-2026-10-28/07-IMPLEMENTATION-STATUS-AND-LANGUAGE.md`. The full plan/backlog is NOT complete.
- Preserve the local synthetic demo; do not reset the database. Prior Inventory V1 remains VERIFY. Technical/rendered evidence is recorded; await owner visual acceptance. Source publication is now authorized as recorded above; cloud operations remain separate.

## Current pilot implementation checkpoint

The owner subsequently authorized implementation. INV-OPS-V1 is implemented
on the pilot implementation branch and remains VERIFY for
owner visual/operational review. The scoped contract and checklist are in
`openspec/changes/inventory-operational-v1/`; implementation handoff and logs
are indexed by `D:/Orca/MedLabs-Deep-Review-2026-10-28/06-IMPLEMENTATION-HANDOFF.md`.

- Implemented incremental multi-return, mapped supplemental lines after
  handover, operational queue, readable actual-event evidence/PDF, exact
  correction previews, preparation retry recovery and stocktake dirty guards.
- Fixed authorized NEW Skills edit/quick-add/remove writer contexts while
  preserving direct-DML denial and original stable-line history.
- RUN AND PASS: build, production dependency audit0 vulnerabilities,
  36 pgTAP files / 943 assertions and full check432 tests (431 pass / 1 skip),
  on fresh local replay. Exact evidence and bounded browser UAT are in the handoff.
- Source publication is now explicitly authorized; see the current publication note.
  No cloud migration, production activation or manual deployment has occurred.
- Local preview: `http://127.0.0.1:4000/equipment/operations`; synthetic data,
  email off. Keep this task VERIFY until owner acceptance. Do not resume the
  historical AUTH-01 automatically.

## Historical pilot advisory review checkpoint

The user initially requested a deep workflow review and Inventory implementation plan on the isolated pilot. At that earlier advisory checkpoint, no application, UI, schema, or production change was retained. The current implementation checkpoint above supersedes its next-action guidance.

- Workspace now tracks `baonguyen-kobe/eiu-medlabs-pilot` as `origin`; the live repository is fetch-only `upstream` with a disabled local push URL.
- Review source: `c42abf669222b81fadd2595d64de19c4a135ac2d` (pilot `main`).
- Review handoff: `D:/Orca/MedLabs-Deep-Review-2026-10-28/00-README.md`; separate workflow, Inventory, infrastructure, and design reports are indexed there.
- Follow-up planning: `05-WORKFLOW-PRODUCT-PLAN.md` records the user's urgent quantity/reusable-return and sudden request-change needs, stage matrix, proposed decisions and future UAT cases. Continue planning before implementation; no new business/visual rule has been approved by the advisory document.
- Local pilot Supabase is isolated on ports 58321–58324; localhost preview uses `http://127.0.0.1:4000` with synthetic data and email off. These are session resources, not guaranteed to remain running in a later session.
- Fresh local Inventory integration: 56 tests PASS; Inventory pgTAP: 192 tests PASS. Four legacy workflow pgTAP suites fail or abort on current contracts. Dependency audit also fails; this is not a release acceptance checkpoint.
- `D:/Orca/medlabs-OPs`, the pilot's canonical Inventory control plane, is unavailable here. Restore/reconcile it before approving cross-cutting implementation; the external advisory plan does not replace it.
- The August UI registry below is inherited historical state. Reconcile it against pilot source, upstream accepted UI work, and current approvals before selecting implementation tasks. No inherited task has been newly marked DONE or reopened.

## Current branch

`codex/pilot-deep-review-20261028`

## Baseline commit

Current pilot review baseline: `c42abf669222b81fadd2595d64de19c4a135ac2d`.

Historical UI tracking foundation: `507e08c869049f38882e7129ad47fb319df4ad50`.

## Current phase

Inventory operational V1 implementation authorized by the user on 2026-10-28. Pilot/local only; historical UI phase remains Phase 1 — Blocking fixes.

## Active task

APP-I18N — VERIFY for current owner language correction; INV-OPS-V1 remains VERIFY. See `openspec/changes/inventory-operational-v1/` for the bounded contract and tasks. Preserve current signer rules and release-all reservation policy; no production activation/deployment. Await owner review and record applicable final verification in the handoff.

## Next READY task

Historical next READY item: AUTH-01 — Repair forgot/reset/change-password screens using the approved current login visual family. Reconcile the pilot/upstream family and current user scope before resuming.

## Blocked tasks

- BASE-01 — requires approved authenticated local environment.
- DEC-01 — accessible signature/confirmation business decision required.
- A11Y-01 — blocked by DEC-01.

## Completed foundation

- UI/UX responsive audit completed.
- Audit archived in repository.
- Persistent tracking system created.

## Do not change

- MedLabs visual identity.
- Be Vietnam Pro.
- EIU blue/gold/cream.
- Business, security, and permission logic.
- Framework and UI stack.

## Resume protocol

A new agent should:

1. Read `README.md`.
2. Read this file.
3. Read `TRACKER.md`.
4. Inspect Git status, branch, commit, and diff.
5. Continue the active task or, if none, take the first eligible `READY` task.

If this checkpoint and Git disagree, reconcile Git history, `WORKLOG.md`, `TRACKER.md`, and the current diff before changing source.

## Next action

Review the implemented V1 at localhost using the retained synthetic demo described in the implementation handoff. Resolve owner feedback, then follow the existing visual acceptance and delivery gates. Real-opening schema parity, missing Inventory authority pack and production cutover remain separate work; do not deploy or replace production based on this checkpoint.
