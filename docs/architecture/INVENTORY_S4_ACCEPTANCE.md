# S4 operational acceptance — isolated synthetic pilot

2026-10-03: **S4 ACCEPTED / CLOSED** by explicit Owner decision INV-056. Accepted implementation `14fb9a0`; migration `20261003085252_inventory_s4_preparation_reservations.sql` on isolated pilot `kwpyukofofoaqhmxndlc`. G0 DONE; S1–S3 remain ACCEPTED / CLOSED. Prior runtime evidence below is retained, not rerun by this documentation closure.

| Gate                      | Status             |
| ------------------------- | ------------------ |
| S4 Implementation         | DONE               |
| S4 Remote Pilot Migration | DONE               |
| S4 Targeted Acceptance    | PASS               |
| S4 Owner Acceptance       | ACCEPTED           |
| S4                        | ACCEPTED / CLOSED  |
| P1 Real Operational Stock | NOT AUTHORIZED     |
| Production Cutover        | NOT AUTHORIZED     |
| S5 Implementation         | NOT YET AUTHORIZED |

Owner accepts all operational capabilities below, including revision/lock/re-review, explicit mapping, multi-source quantity/exact-asset reservations, absolute adjustments with stale rejection, health/shortfall, reallocation, strict physical-compensation reversal and corresponding concurrency/RLS/audit. PROVISIONAL / TESTABLE UI is intentional flow-first scope, not an S4 blocker; full UI/UX/WCAG is not required for closure. Do not reopen S4 without a new functional/data/security blocker.

## Delivery boundary

- Target: `baonguyen-kobe/eiu-medlabs-pilot`, branch `main`; isolated Supabase pilot `kwpyukofofoaqhmxndlc` only.
- Migration: `20261003085252_inventory_s4_preparation_reservations.sql`.
- Remote migration and verification: **DONE / targeted acceptance PASS**. Owner acceptance **ACCEPTED**.
- No production database mutation, deployment, P1 real stock, Basic Medical Inventory cutover, S5 handover/return/signature/recovery, or OPS remote changes.
- Preparation UI is **PROVISIONAL / TESTABLE**. Redesign, polish, detailed responsive refinement, final navigation organization and full visual parity belong to a separate UI/UX round, not the S4 gate.

## Implemented operational contract

- Stable request-line IDs, immutable registered baseline, soft removal and optimistic revisions. Shared Skills/Basic Medical editors submit persisted identity/revision; Basic Medical remains outside Inventory preparation.
- Draft/tab lock, inactivity expiry, explicit override, line re-review and private draft history. Draft/start/save do not reserve stock or emit intermediate participant notifications.
- Explicit commercial-to-physical mapping, exact decimal conversion, multiple single-source allocations, quantity commitments and unique exact-asset commitments only on confirmed PREPARED.
- Absolute proposed/approved targets: pending proposals do not mutate current targets or commitments; approval replaces backing atomically. Registered baseline remains immutable.
- Physical damage/expiry can make backing deficient without silently reducing targets or releasing reservations. Shortfall is visible and notifications remain scope/participant constrained; explicit reallocation preserves targets.
- Preparation transfers reuse S2/S3 physical authorities. Reversal retains commitments until linked real compensating transfers restore the original physical sources. An unrelated historical S2 retry cannot discharge reversal debt.
- Confirmed PREPARED emits aggregate notification. Participant-readable approval history excludes unpublished warehouse plans. RLS/RPC checks enforce authority; TA receives existing request access, not new warehouse or class-creator privileges.
- Existing Inventory stock/asset read models distinguish reserved backing and availability without changing physical on-hand or double-counting exact assets as quantity stock.

## Exercised evidence

- **RUN AND PASS:** production compilation (`npm run build`), including TypeScript and route generation. No deployment performed.
- **RUN AND PASS:** regenerated `lib/database.types.ts` from the effective local Supabase schema, then `npm run typecheck`.
- **RUN AND PASS:** effective database function lint (`supabase db lint --local --level error`), no reported SQL errors.
- **RUN AND PASS:** changed-file preflight after formatting; zero ESLint errors, one existing unused-import warning in `components/inventory/stock-table.tsx`.
- **RUN AND PASS:** remote pilot S1–S4 database acceptance: 5 files, **121 assertions**, all successful. Initial runs could not resolve pgTAP because the temporary CLI login lacked schema `extensions` USAGE. The final harness supplied transaction-local test privileges; all tests and grants rolled back.
- **RUN AND PASS:** remote migration history contains `20261003085252`; all eight inspected preparation/reservation tables have RLS enabled. Effective S4/impacted SQL function fingerprint matches local: `a14e08acea0e7db3fa40083f6143c463`.
- **RUN AND PASS:** after remote rollback, zero S4 fixture actors, preparations, reservations and S4R stock items remained; CLI login schema-USAGE grant did not persist.
- **RUN AND PASS:** S4 reservation regression and preparation regression, including notification boundaries, participant history privacy and physical-transfer replay protection; S1–S3 database regressions exercised alongside them.
- **RUN AND PASS:** Node S4 operational scenario, including simultaneous independent requests for the last quantity pool and the same exact asset: one winner, atomic loser, one committed reservation set.
- **RUN AND PASS:** shared request-writer regression: Basic Medical repeated edits preserve line identity and registered baseline; stale edit rejects atomically; semester/source authority remains enforced.
- **RUN AND PASS:** real local browser operations: source selector pagination to page 3/4, draft with zero reservation, confirmed PREPARED, absolute target adjustment, strict reversal back to NEW with zero active reservations, and operations queue rendering.
- **RUN AND PASS:** real browser physical-damage/health/reallocation path. Damage left `0.400000` committed with a `0.100000` source deficit. Explicit reallocation to healthy Warehouse B retained registered/planned quantity `4`, retained commitment `0.400000`, and cleared health to `[]`.
- **RUN AND PASS:** functional desktop/narrow smoke. Preparation controls use the existing design-token stylesheet; 390px viewport had document width 390px without horizontal overflow. This is not final visual acceptance.
- **RUN AND PASS:** independent focused source review findings closed by source corrections and executable regressions: stable-line UI reconciliation, private approval history, transfer replay provenance and migration assembly. Independent source review is not represented as independent runtime execution.
- **RUN AND PASS:** React Doctor advisory command executed. It reported repository-wide diagnostics; this is not a clean audit or a visual/accessibility certification. No dependency installation or unrelated remediation performed.

## Deferred/non-blocking

- **NOT RUN — NOT REQUIRED FOR CURRENT IMPACT:** full repository test suite and full end-to-end suite; targeted database, compatibility, concurrency and browser paths are the S4 evidence.
- **NOT RUN — NOT REQUIRED FOR CURRENT IMPACT:** complete UI/UX, cross-browser and WCAG certification, explicitly deferred under INV-055.
- OPS remains local-only. Stop S4. Next: identify actual S5 delta for actual handover, signature, return, recovery and late return against current source and approved contracts; do not rebuild S1–S4 or begin S5 implementation.
