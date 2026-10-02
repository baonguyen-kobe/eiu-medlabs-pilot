# EIU MedLabs Pilot — Inventory Master Roadmap

Updated 2026-10-02. **UNDER_REVIEW / NOT_STARTED**. Documentation reconciliation only; no implementation, migration, deployment or production authorization.

## Authority and verdict

The August roadmap at bootstrap `e802421` is superseded as a live plan. Its useful domain boundaries remain; blanket unresolved delivery, forced single-source and old phase order do not. Historical content remains in Git and the unchanged dated source-of-truth snapshot.

Inventory architecture authority remains `D:/orca/medlabs-OPs`. Read [pilot reconciliation](INVENTORY_PILOT_RECONCILIATION.md) for approved policy and 42 acceptance scenarios; the canonical [G0 S1 Design Freeze Pack](../../../medlabs-OPs/plans/G0_S1_DESIGN_FREEZE_PACK.md) now supplies the bounded technical candidate, DBML/D2, S1 Page Specs and enforcement traceability. This pilot entry does not copy the control plane.

## Current implementation target

`baonguyen-kobe/eiu-medlabs-pilot`, `origin/main`, bootstrap `e8024212edd4b9c179055ad5c9490832f42944ea`. Original MedLabs is `upstream` fetch/reference only, with push disabled locally. Existing production is not a pilot target. Supabase pilot ref `kwpyukofofoaqhmxndlc`; Vercel pilot project not yet verified/created. Never use production credentials or live notification recipients in pilot.

## Sequence and observable gates

| Gate                | Scope                                                                                                                                             | Required result before progression                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 (old Step 0)     | S1 contracts plus cross-slice invariants that avoid destructive redesign                                                                          | Owner review/approval of bounded pack; no detailed S2–S5 UI/workflow freeze or resource creation required.                                                        |
| S1 (Step 1)         | Identity/access/location/reference, sources, minimal condition/header-lines/balance, opening/receipt, conversion/cohorts/expiry and S1 correction | Source delta zero; receipt/opening/correction reconciliation, exact decimals, permission/retry/business-duplicate/concurrency/atomicity evidence; synthetic only. |
| S2 (Step 2)         | Extend same quantity ledger with transfer, condition, expiry eligibility, count/correction                                                        | Quantity conservation and no fake movement; no second ledger.                                                                                                     |
| S3 (Step 3)         | Serialized identity, lifecycle/condition/custody, QR                                                                                              | Exact unique asset and no double-count; live reservation races belong to S4.                                                                                      |
| S4 (Step 4)         | Stable request-line cutover, absolute adjustment, preparation/allocation/reservation, fulfillment health and strict Q4 reversal                   | Last-stock/asset races and stale revisions protected; damage does not free commitments.                                                                           |
| S5 (Step 5)         | Actual handover/signature, initial return, recovery, waiver, late return and corrections                                                          | Effect once; signature/waiver zero stock delta; Q8 every request; immutable evidence.                                                                             |
| P1 (Step 6)         | Skills Lab operational pilot                                                                                                                      | Admin opening; all required archetypes; authorized single-writer stock scope; reconciled UAT.                                                                     |
| M1 (Step 7)         | Scoped Basic Medical integration rehearsal                                                                                                        | Fixed in-place vs consumables vs portable; all writers mapped, no dual-write or fake history.                                                                     |
| R1 (promotion gate) | UAT, data/Auth/Storage/evidence parity, migration/cutover rehearsal, rollback/fix-forward                                                         | Separate owner delivery decision and release authorization; no automatic replacement.                                                                             |

Minimum ledger/condition/expiry representation belongs to S1, not after receipts already exist. S3 exact identity precedes S4 reservations. Stable request IDs must precede live operational references. Synthetic data precedes any separately authorized real-stock pilot.

## Unchanged boundaries

Q1–Q10/F1–F3 remain settled as described in the [review matrix](INVENTORY_PILOT_RECONCILIATION.md#3-accept--modify--reject-matrix). In particular Q4 transfer-back prerequisites, Q8 signatures for all requests and no quarantine/business-lot/time-window module remain. No generic Inventory Request/procurement engine/microservice/full-app event sourcing. Repair/formal transfer/loan remain V1.1; maintenance/calibration/inspection remain future required domains, not pilot blockers.

INV-041–046 settle return/expiry/late-intake/strategy/single-writer/security policy. Replacement candidate target, port-back fallback; R1 production permission separate. S1–S5 synthetic only; P1 scoped single writer/Admin opening and mandatory rotation before operational use. Vercel before deployed UAT/deploy. G0 policy closed; bounded design candidate UNDER_REVIEW, G0 OPEN. Exact S1 criteria: canonical pack §16, owner baseline approval plus separate implementation authorization.
