# Inventory / Equipment — Pilot Business Requirements Entry

Updated 2026-10-02. This replaces the stale August live summary, not its historical evidence. Detailed Inventory requirements remain canonical in `D:/orca/medlabs-OPs/requirements/INVENTORY_BUSINESS_REQUIREMENTS.md` and its decision log; detailed designs are UNDER_REVIEW and implementation NOT_STARTED.

Read [pilot review matrix and operation contracts](../architecture/INVENTORY_PILOT_RECONCILIATION.md). [Historical raw planning](evidence/LEGACY_INVENTORY_BUSINESS_PLANNING_230_360.txt) is unchanged; unanswered historical options are not new requirements. The dated source snapshot remains historical.

## Current policy index

| Decision              | Contract                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1 / INV-041          | Staff-confirmed physical return posts actual stock immediately; signature separate/pending blocks completion, never rollback/double receipt; correction for posted errors even unsigned. Handover Q1 unchanged.                |
| Q2                    | Initial actual > planned allowed with rights/revision/reason/extra eligible backing; no other request's reserved stock.                                                                                                        |
| Q3                    | One requirement may have several identified allocations, each with one physical source. No forced paper transfer for consolidation.                                                                                            |
| Q4                    | Necessary linked physical transfer-back before preparation cancellation/reversal; block if physically impossible until discrepancy is resolved.                                                                                |
| Q5                    | Receipt inspection completed as good/damaged, no quarantine. Damaged returned quantity counts as physically returned.                                                                                                          |
| Q6                    | Staff may reasonedly resolve recovery with zero warehouse delta; Admin controls asset disposition.                                                                                                                             |
| Q7                    | Late return is new physical event plus linked quantity offset; preserve signatures/history and Admin settlement consequences.                                                                                                  |
| Q8                    | Initial return confirmation/signature for every request, including consumable-only; nonreturnable recovery is not applicable, no invented returned qty.                                                                        |
| Q9                    | Fixed room equipment in-place; session consumable/chemical issue; portable reusable issue/return. Snapshot semantics, not category-name inference.                                                                             |
| Q10                   | Hard reservation only at confirmed preparation; no V1 time-window allocator or automatic clock release.                                                                                                                        |
| F1 / INV-042          | Cohort day/month precision, valid through expiry day, eligible FEFO, no manual picker/future-use-date check. Normal expiry-required receipts reject blank; unknown only opening/legacy, no reserve/issue until Admin verifies. |
| F2                    | Stable base usage UOM; purchase UOM/qty/conversion/base qty immutable per receipt; positive exact conversion, no silent rounding.                                                                                              |
| F3                    | Skills Lab first, Admin-approved opening events, quantity/reusable/chemical/serialized/QR coverage.                                                                                                                            |
| Acquisition / receipt | Contract/source record alone changes no stock; 0..n physical receipts each carry actual conversion/expiry and their own received timestamp.                                                                                    |

## Quantity and workflow semantics

- SL đăng ký: immutable original demand; warehouse-added line conceptually 0.
- SL sẽ giao: current approved/prepared absolute plan.
- SL đề nghị: pending proposed absolute value; does not change plan/reservation before approval.
- SL thực giao / SL đã giao: actual immutable posted event quantity.
- SL đã trả: cumulative physically returned quantity; updates post only incremental delta under revision/lock.
- Chênh lệch: explicit comparison, not a second authority for stock.

Keep three different notions separate: demand-versus-plan shortage, commitment-versus-eligible-stock shortfall, and outstanding return obligation. Conversions between different product representations need explicit equivalence, not addition of incompatible base units. Stable operational line IDs precede allocation/reservation integration; immutable snapshots do not justify destructive delete/reinsert.

Pinned Equipment workflow §§6–8 and §15 govern quantity/signature/participant semantics; current Q choices supersede only conflicting policy. Initial return is signed once; later recovery does not rewrite or re-sign that snapshot. Creator/assignment-scoped TA adjustment rights are not global Inventory write permission; existing registration lead time is not a reservation time window.

## Preservation and scope

Keep existing queue/review/shortage-reason and Admin lock-override requirements from canonical control-plane requirements. Lock timeout is not commitment release. Shared physical identity does not merge Skills/Basic Medical catalogs or evidence workflows. No new Inventory request, procurement engine, generic delta API, location grants or application-wide event sourcing.

INV-041–046 settle policy: Staff/Admin late intake after administrative closure, exact custody/condition plus linked quantity offset; Admin-only hold blocks reserve/issue, history retained. Replacement candidate target/port-back fallback, R1 production authority separate. S1–S5 synthetic; P1 exact single-writer scope/cutover marker/Admin opening. Rotation before real operational use, Vercel before deployed UAT/deploy. No execution now; detailed design UNDER_REVIEW, G0 OPEN.
