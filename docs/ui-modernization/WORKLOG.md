# EIU MedLabs UI Modernization Worklog

Append new entries. Do not rewrite or delete historical entries merely because `CURRENT.md` changes.

## 2026-08-25 — Tracking foundation

### Work

- Archived the original UI/UX responsive audit.
- Created `MASTER-PLAN`, `TRACKER`, `CURRENT`, `DECISIONS`, and `QA-MATRIX`.
- Added persistent agent continuity instructions.

### Application source changed

NO

### Current next task

AUTH-01

### Blockers

- BASE-01: protected-route environment/authentication.
- DEC-01 / A11Y-01: signature accessibility business decision.

### Verification

- Audit hash preserved.
- Documentation paths verified.
- Git diff reviewed before commit.
- Foundation commit: `507e08c869049f38882e7129ad47fb319df4ad50`.
- Foundation pushed to `baonguyen-kobe/eiu-medlabs` `main`.
- `ui-modernization` created from the foundation commit and pushed with upstream tracking.

## 2026-10-28 — Isolated pilot deep review

### Work

- Followed the user's explicit request to switch this workspace to the pilot and review workflows, Inventory next steps, hosting/database options, and design consistency.
- Preserved prior production-branch documentation edits in a named Git stash and `D:/Orca/eiu-medlabs-pre-pilot-review-20261028.patch`; preserved the original local environment outside the repository.
- Created local branch `codex/pilot-deep-review-20261028` from pilot `main@c42abf669222b81fadd2595d64de19c4a135ac2d`; `origin` is pilot, with original/historical remotes fetch-only via local push guards.
- Created external review package `D:/Orca/MedLabs-Deep-Review-2026-10-28/00-README.md` plus separate workflow, Inventory plan, infrastructure comparison, and design backlog reports.
- Recorded that `D:/Orca/medlabs-OPs` is missing and the inherited August UI tracker needs reconciliation. The advisory reports do not supersede approved contracts or mark UI work accepted.

### Application source changed

NO. Only these continuity documents changed in the tracked repository. No commit, push, merge, remote migration, subscription, or deployment was performed.

### Verification

- Fresh local pilot stack: 139 migration files replayed; synthetic seed; loopback-only application configuration and email off.
- Typecheck PASS; lint PASS with 9 baseline warnings; 37 focused logic/contract/PDF tests PASS.
- Inventory Node integration: 56 tests PASS, including multi-connection races. Inventory pgTAP: 9 files / 192 tests PASS.
- Legacy workflow pgTAP: 27 files / 726 reported tests; 4 suites fail or abort on stale fixtures/payloads against current guards. Full workflow SQL verification is not green.
- Production dependency audit FAIL: 1 critical / 3 high affected packages. No automatic dependency changes made.
- Confirmed correction-preview precision loss through the source formatter; confirmed legacy-only handover export path by source review. Other risks are explicitly labelled in the report.
- Read-only cloud metadata/public bindings verified distinct app/backend targets and pilot deployment SHA; server-side environment, remote migration parity, restore, billing, and full production workflow acceptance remain unverified.
- Public auth and local Inventory overview rendered; no full protected-route visual/accessibility/UAT acceptance. Full browser journeys and a new production build were not run for this documentation-only review.
- Final report formatting and diff checks are recorded in the external handoff after execution.

### Next action

Reconcile the authority/environment matrix, then select a scoped Inventory readiness/security/correctness batch from the advisory plan. Preserve approved S1–S5 behavior and the separate production application; do not automatically restart historical UI tasks.

## 2026-10-28 — Workflow/product planning follow-up

- User requested a more thorough plan before implementation and clarified: registrant/TA returns, warehouse Staff receives; quantity management is urgent; instructors change requests suddenly; reusable issue/return accounting is difficult; daily volume is variable.
- Added external `05-WORKFLOW-PRODUCT-PLAN.md`: 16 improvement areas, stage matrix, reusable quantity example, 8 proposed decisions, bounded urgent V1, planning outputs and 28 future acceptance scenarios. Updated the existing plan/index and separate design backlog (DES-17–20).
- Verified from effective source that initial handover releases all preparation reservations even below plan, and that existing supplement does not by itself support adding a new SKU after handover. Recorded these as current semantics/capability gaps to reconcile, not unapproved changes to accepted S4/S5.
- Distinguished existing DB pg_cron minute-level preparation warnings/health from daily Vercel personnel/email recovery; no new scheduler proposed without need.
- Source-only follow-up: no new runtime test execution, app/schema/UI change, commit, push, cloud mutation or deployment. Prior runtime evidence remains historical at the unchanged source SHA. U01–U28 are planned tests, not PASS claims.
- Next action: reconcile scope and proposed decisions with current authority, freeze stage/quantity contracts, then select a bounded implementation batch. Urgent quantity workflows take precedence over broad polish or automatic historical AUTH-01 continuation.

## 2026-10-28 — Inventory operational V1 implementation

- Owner explicitly authorized implementation. Created scoped OpenSpec
  `inventory-operational-v1`; implemented incremental return entry, zero-stock
  mapped supplemental lines, operational worklist, readable actual-event
  evidence/PDF, exact decimal previews, preparation/transfer retry recovery,
  location-discard/reload stocktake protection and Inventory child headers.
- Preserved S1–S5/P1, original registration/signatures, signer authority,
  release-all initial handover and separate physical receipt/signing effects.
- Fixed scoped context defects in authorized NEW request full-edit/quick-add/
  remove RPCs. Kept direct table writes revoked. Added positive/denial,
  stable-baseline, duplicate, replay, late-return/waiver, P1 stage and
  concurrent-receiver regression evidence.
- Rebased stale CI pilot isolation, semester and legacy fixtures/payloads;
  retained negative business/security checks. Historical legacy staging
  refuses Inventory preparation/fulfillment history and restores triggers
  before authenticated actions.
- RUN AND PASS: fresh replay140 migrations; full `npm run check`432 tests,
  431 pass / 1 skip / 0 fail, typecheck and lint0 errors/9 baseline warnings;
  all36 pgTAP files / 943 tests; build; production audit0 vulnerabilities;
  touched-file Prettier and diff checks. Exact final logs in external handoff.
- RUN AND PASS: read-only independent risk review and follow-up verification;
  uncertain-edit-loss and historical-fixture guards corrected. React Doctor
  advisory completed with repository-wide findings retained for later triage.
- RUN AND PASS for bounded browser UAT: admin local login,390px Inventory
  header, actual asset receipt1→returned/due0 with carrier metadata and pending
  signatures, authenticated PDF download/render, mapped new SKU with
  registered/planned0 and unchanged physical history, count-location cancel
  preserving0.7, and worklist return filter3 rows/URL state.
- Current status VERIFY; owner visual/operational acceptance is pending.
  Preview remains at `http://127.0.0.1:4000/equipment/operations`, local email
  off, synthetic demo retained. Viewport override reset. No commit/push,
  remote migration, production stock activation or deployment.
- Handoff: `D:/Orca/MedLabs-Deep-Review-2026-10-28/06-IMPLEMENTATION-HANDOFF.md`.
  Separate design backlog updated with remaining phone KPI/header and ID-label
  work. Persistent count drafts/client navigation, real-opening schema drift,
  missing authority pack and production cutover remain explicit follow-ups.

## 2026-10-28 — Whole-application language correction

Owner clarified that VI/EN is a switch, with VI default, and confirmed scope across the whole app. Recorded the rule in UI Master first; implemented shared cookie/SSR/context preference and explicit static-copy translation at presentation. Preserved business/user data, option values and unsaved form state. Independent review found and resolved calendar View identity and template matching/capture defects; targeted regressions6/6 pass. Browser verified VI↔EN retained exact note bytes and HK2, remembered preference across routes and correct month/week/list parameters. Full historical plan/design is not complete; see external07 item matrix. Final source is still uncommitted, no push/deployment/cloud mutation.

Final APP-I18N checkpoint: VERIFY. Build/typecheck, full lint0 errors/9 baseline warnings,64 non-DB test files297 tests (296 pass/1 skip), targeted final regressions and formatting verified. Independent reviewer confirmed template precedence/capture, canonical View identity and own-key fallback fixes;7 language tests pass. Representative browser checks at390/820/1440px, keyboard selector, metadata/HTML language, preference persistence and draft preservation recorded in external07. Local email setting restored to off after fixtures; no provider send or cloud operation. Screenshots saved alongside report, localhost kept on port4000. Owner visual acceptance remains pending; no commit/push.

## 2026-10-28 — Owner-authorized pilot source publication

Owner explicitly requested updating `eiu-medlabs-pilot` after being told the changes were local only. Delivery targets `origin/main` from `codex/pilot-deep-review-20261028`; this bounded authorization supersedes earlier no-push checkpoint statements. Preserve VERIFY pending owner acceptance; do not mark the full plan/design backlog DONE. Portable publication handoff is `docs/PILOT_IMPLEMENTATION_STATUS_2026-10-28.md`. Reuse prior unchanged-impact functional evidence and run publication hygiene/targeted regression. No original-repo push or cloud migration/manual deployment is part of this operation.
