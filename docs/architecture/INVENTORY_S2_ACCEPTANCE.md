# S2 acceptance evidence — isolated synthetic pilot

## Scope and authority

Owner-authorized S2: atomic cohort-preserving transfer, physical good-to-damaged movement, evidence-backed counted reconciliation, standalone held stocktake surplus, Admin verification and append-only evidence. [API contract](INVENTORY_S2_API.md); [approved implementation proposal](../../openspec/changes/inventory-s2-physical-operations/proposal.md). S1 remains accepted with its previously accepted limitations. No S3 or production authorization.

**Owner decision — 2026-10-03: S2 ACCEPTED / CLOSED for the isolated synthetic pilot.** Accepted implementation commit: `a450117`; migration: `20261003030000_inventory_s2_operations.sql`, applied to `kwpyukofofoaqhmxndlc`.

| Gate                      | Status             |
| ------------------------- | ------------------ |
| G0                        | DONE               |
| S1                        | ACCEPTED / CLOSED  |
| S2 Implementation         | DONE               |
| S2 Remote Pilot Migration | DONE               |
| S2 Targeted Acceptance    | PASS               |
| S2 Owner Acceptance       | ACCEPTED           |
| P1 Real Operational Stock | NOT AUTHORIZED     |
| Production Cutover        | NOT AUTHORIZED     |
| S3 Implementation         | NOT YET AUTHORIZED |

Accepted scope includes atomic stock transfer, good-to-damaged physical condition change, server-computed stocktake/reconciliation delta, stale/ABA protection and explicit recount, separate surplus origin, held/non-issueable surplus, Admin verification/release, immutable evidence append, paginated operational history, and corresponding authorization/atomicity/rollback/reconciliation.

Owner accepts these limits as **NON-BLOCKING**: no full UI/accessibility certification; CLI pg-delta cache warning with effective migration/RPC independently verified; inaccessible canonical `medlabs-OPs` remote with local-only continuity. Do not reopen S2 for these alone unless a new functional/data/security blocker appears.

This closure changes documentation only. Prior executed evidence below is retained, not a claim of fresh runtime checks. S2 work stops. The only authorized next activity is identifying the actual S3 Serialized Asset + QR delta against current roadmap and S1/S2 implementation, without rebuilding the quantity-stock foundation or starting S3 implementation.

## Database verification executed

- Local migration compiled and applied; complete final migration additionally executed inside a rollback transaction.
- S1: all 16 targeted integration scenarios passed after the S2 dispatcher/read replacements.
- S2: 14 targeted integration scenarios cover transfer conservation/overdraw, concurrent last-stock transfer, deterioration/repair denial, true ABA, count-vs-transfer contention, zero-delta evidence/count-to-zero, semantic reference duplication, UUID-case duplicate targets, exact dimensional ledger reconciliation, surplus holds/chemical expiry, authorization/replay loss/direct-DML denial, downstream intake guards, dimensional read filters and same-cohort multi-condition batches.
- Read regression initially used an incorrect fixture provenance `RECEIVE`; actual S1 provenance is `receipt:<reference>`. Corrected that fixture; split/single/depleted and provenance-filter scenario passed.
- Independent review found a later-line freshness bypass after batch revision deferral. New mixed-stock-version and mixed-fact-version assertions failed against the earlier dispatcher, then passed after validating every line while deferring one revision bump per affected cohort. Independent focused recheck found no remaining issue in this boundary.
- Six scoped pgTAP checks passed: operation constraint and privileged history/surplus/hold/evidence immutability.
- Regenerated `lib/database.types.ts` from the local database.

## Isolated pilot database delivery

Target verified from linked project reference: `kwpyukofofoaqhmxndlc` (`eiu-medlabs-pilot`). Dry run listed only `20261003030000_inventory_s2_operations.sql`; that migration was applied. Remote migration history confirms the version and all three S2 tables have RLS enabled.

The CLI emitted a nonfatal pg-delta catalog-cache warning (`cli_login_postgres` authentication failure). This was not treated as proof of migration failure or success: subsequent direct catalog queries and RPC smoke verified the effective database independently. No cache-repair or production operation was attempted.

A synthetic SQL transaction exercised the real authenticated RPC boundary: surplus immediately held/on-hand; nonexpiry release without receipt; paired transfer; good-to-damaged movement; mixed-condition count including zero evidence; ledger reconciliation; retry replay; duplicate business-reference rejection; unknown chemical expiry refusal; verified chemical release; later evidence append; split-location read. Final nonexpiry physical quantity was exactly `9.000000`. Transaction rolled back; separate queries confirmed synthetic actor and stock were absent. The temporary smoke script was removed.

## Executed local browser workflows

Synthetic namespace `S2UI_5260BB`, real localhost application, authenticated Admin:

1. Created nonexpiry surplus quantity 10 from physical count, held immediately. Transaction `826a41b9-b39c-4903-bd69-69e5e63a7dcc`.
2. Released on synthetic count evidence without inventing historical receipt.
3. Transferred 4 from warehouse A to B. Transaction `47c8de1b-d183-4b6e-950e-58502352f727`.
4. Deteriorated 1 good unit at B to damaged, conserving physical stock. Transaction `723b1a58-6758-45dd-b753-5b907847f081`.
5. Created chemical surplus quantity 2 with unknown expiry, held. Transaction `3715deb4-8f1c-47da-a71f-09a4c637f3fd` also retained two zero-delta observations.
6. Counted B good stock from 3 to 2 with evidence; transaction `cb0cf8f6-4979-4fdc-84ae-348a36bd0dc7`. Database dimensions observed: A good 6, B good 2, B damaged 1.
7. Attempted chemical release with empty required expiry: native validation blocked submission and hold remained active. Validated `2027-12-31`; database then showed released/day/2027-12-31.
8. Freshness regression: captured count5 at revision6, posted a competing transfer, then refreshed/search fetched revision7/current quantity4. The observation remained5 and was marked stale; submission was disabled. Explicit Recount cleared the input and kept submission disabled until entering physical4. Zero-delta recount succeeded as `763c01c1-cec4-4ea2-b7f1-c44d03e29e8c`. No silent token rebasing or stock recreation.
9. Traversed evidence page6/6 of58 records from transaction detail. Original surplus10, Admin release, old counted delta-1 and zero-delta observations remained visible with actor, posted/count time, location, condition, tokens and transaction links.
10. Appended `S2UI_FINAL_APPEND` through the surplus UI and read it back through history. Original chemical count quantity2/evidence remained unchanged; one new evidence row was observed.
11. Released surplus remained searchable with held-only unchecked, using server-side provenance pagination. Split cohort stock displayed A5/B4 and physical9 at the checked point, rather than labeling total9 as one location. Subsequent synthetic freshness movement changed location distribution, not total.
12. Rendered desktop1440 and narrow390 surfaces after overflow corrections; measured main scroll width equal to client width on both. Evidence dialog visually inspected; no full UI/a11y certification claimed.

Browser and independent review findings were repaired, then exercised as above: preserved count snapshots with explicit recount, traversable evidence, server-side surplus filtering, correct split/depleted locations, usable responsive sizing and readable lookup surfaces.

## Delivery boundaries

Application Git delivery is separately recorded by its commit/push result. No full UI/a11y certification. No real P1 stock, production/current MedLabs mutation, Vercel deployment, repair, serialized assets/QR or S3 operations. Control-plane remains local per Owner direction; its remote is unchanged and its inaccessible remote is not an S2 blocker.

## Verification classification

- **RUN AND PASS** — final targeted mixed-snapshot/multi-condition regression; final split/single/depleted/provenance read regression; real browser workflows and final freshness/evidence/pagination/rendered checks; isolated pilot migration/catalog/RPC rollback smoke.
- **REUSED PRIOR PASS — UNCHANGED IMPACT** — remaining S1/S2 targeted scenarios after the final narrowly scoped per-line token correction; six pgTAP checks (DDL/immutability unchanged). Together,16 S1 and14 S2 scenarios are covered; no whole-repository suite claim.
- **RUN AND PASS** — TypeScript `tsc --noEmit`; scoped ESLint with0 errors and the10 accepted baseline warnings. Subsequent toolbar wrapping is class-only and does not change types/business behavior.
- **NOT RUN — NOT REQUIRED FOR CURRENT IMPACT** — whole-repository tests, full E2E/a11y certification, production preflight and Vercel validation. No deployment was requested.
- **RUN AND PASS** — `npm run preflight:changed -- HEAD`: 28 changed files, formatting/whitespace and scoped lint checks; 0 errors and 3 baseline warnings in the changed subset. Independent focused integrity and security/read rechecks report no unresolved findings.
