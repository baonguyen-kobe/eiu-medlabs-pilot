# Pilot implementation handoff — 2026-10-28

## Delivery and acceptance

The owner explicitly authorized publishing the current implementation to
`baonguyen-kobe/eiu-medlabs-pilot`. The delivery target is `origin/main`, from
the local `codex/pilot-deep-review-20261028` branch. Check Git history and the
remote ref for the published SHA; this document does not certify deployment.

APP-I18N and INV-OPS-V1 remain **VERIFY** pending owner visual/operational
acceptance. Publishing source does not mark the full Inventory plan or design
backlog complete. The original `baonguyen-kobe/eiu-medlabs` application is a
reference only and is not a delivery target for this update.

## Included behavior

- Incremental returns with good/damaged quantities, before/after/due preview
  and separate metadata for the person carrying the return.
- Mapped supplemental equipment lines after handover, preserving original,
  planned and actual history.
- Operational worklist with bounded reads and URL filters.
- Human-readable actual-event evidence and handover PDF; signing remains
  separate from stock posting.
- Exact decimal correction previews, preparation/transfer recovery for
  uncertain or committed-but-refresh-failed outcomes, and dirty stocktake guards.
- Authorized NEW Skills request edits preserve the stable-line writer contract
  while direct public table writes remain denied.
- Application-wide VI/EN preference, Vietnamese default, one interface language
  at a time. Cookie/SSR/context initialization agrees; switching does not reload
  or remount forms. IDs, quantities, enum payloads, notes, names and historical
  evidence retain their values. Business time remains Asia/Ho_Chi_Minh.
- Dependency and local/CI fixture compatibility updates accompanying V1.

## Verification evidence

Evidence below was obtained during implementation before source publication.
Publication checks use the change-aware gate; unchanged-impact checks are not
presented as newly executed.

| Check                             | Evidence label                       | Result and limits                                                                                                                                                        |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Final application build/typecheck | REUSED PRIOR PASS — UNCHANGED IMPACT | Next16.4.3 build succeeded after the final language/UI edits. Publication adds documentation and formatting only.                                                        |
| Inventory migration replay        | REUSED PRIOR PASS — UNCHANGED IMPACT | 140 migrations replayed on isolated Docker pilot. No cloud migration was applied.                                                                                        |
| Database history tests            | REUSED PRIOR PASS — UNCHANGED IMPACT | 36 pgTAP files / 943 assertions passed; language changes do not change database behavior.                                                                                |
| V1 full application check         | REUSED PRIOR PASS — UNCHANGED IMPACT | 432 tests:431 passed,1 skipped on a fresh local database before the subsequent UI-only language work.                                                                    |
| Language/non-DB tests             | REUSED PRIOR PASS — UNCHANGED IMPACT | 64 files / 297 tests:296 passed,1 skipped; related final label changes received targeted regression.                                                                     |
| Language regression               | REUSED PRIOR PASS — UNCHANGED IMPACT | 7/7: strict default/cookie, interpolation, nested validator messages, preserved data bytes, canonical calendar modes and explicit option values.                         |
| Independent read-only review      | REUSED PRIOR PASS — UNCHANGED IMPACT | Database/auth/retry boundaries and shared localization were reviewed. Findings were fixed and checked again.                                                             |
| Rendered checks                   | REUSED PRIOR PASS — UNCHANGED IMPACT | Representative390/820/1440px views; VI↔EN retained exact draft text/HK2, metadata and calendar route values; preference persisted across navigation. Not full owner UAT. |

Publication preflight output and detailed dated logs are retained locally in
`D:/Orca/MedLabs-Deep-Review-2026-10-28/`. They are not required runtime files.
Run `npm run preflight:changed -- origin/main` before publishing changes.

Publication checks: **RUN AND PASS** — changed-file preflight (formatting,
ESLint0 errors/9 existing warnings, diff checks),32 targeted regressions, and
changed-path/credential-pattern screening. No local environment or demo artifacts
are included in the source update.

The pre-existing main commit `c42abf6` already has a failed repository-wide
formatting check in [CI run37265311000](https://github.com/baonguyen-kobe/eiu-medlabs-pilot/actions/runs/37265311000).
This baseline is separate from the passing changed-file preflight. Do not
describe a new cloud CI run as passing until its actual result is available,
or bulk-format unrelated files to conceal the baseline.

## Cloud readiness and remaining work

The update includes
`supabase/migrations/20261028070607_inventory_operational_readiness.sql` and its
declarative schemas. **The new migration has only been applied locally.** A
Git push or successful Vercel build does not apply it to cloud Supabase. New
Inventory endpoints require the corresponding backend contract before online
workflow acceptance. Do not apply it to another backend implicitly.

Still open:

- DB-01: reconcile real-opening declarative schema and shadow diff.
- Complete representative operational UAT, including actors, all item types,
  stale/uncertain outcomes, late returns, holds and signatures.
- Restore/reconcile the unavailable `D:/Orca/medlabs-OPs` authority pack before
  broader Inventory policy/cutover decisions.
- Auth-family parity, typography/table/action/focus polish and other remaining
  design backlog items. Language support does not close those items.
- Persistent stocktake drafts and complete client-navigation guards.
- Real physical opening count, approved manifest/cutoff, outstanding custody,
  writer exclusion, backup/restore and activation/release preflight.

Do not copy synthetic pilot data into production. Current signer permissions,
reservation-release rules and business/security contracts remain in force.
The eight implementation batches and design IDs DES-00–20 are individually
reconciled in the external dated status report; the overall plan remains partial.
