## Why

The owner requests a G0 Design Freeze Pack bounded to S1 contracts and cross-slice invariants, not whole-system design or implementation. Business policy INV-041–046 is settled; technical approval remains separate.

## What Changes

- Canonical proposed baseline lives in [medlabs-OPs G0 pack](../../../../medlabs-OPs/plans/G0_S1_DESIGN_FREEZE_PACK.md), with operation matrix, S1 DBML/D2, Page Specs and A01–A42 traceability.
- Preserve INV-018 Staff cost visibility/reasoned adjustment and INV-019 Admin active-state controls. Proposed numeric and FK/locking/correction choices are not approved business policy.
- Supersede conflicting old intended designs by explicit pointers; do not copy the control plane here.

## Capabilities

### Proposed capability

`inventory-s1-foundation`: stable item/location/reference identity, source provenance separate from actual receipt, Admin opening, exact per-receipt conversion, cohorts/expiry, good/damaged ledger/balance, controlled S1 corrections and DB authorization.

## Impact and Authorization

Documentation/design artifacts only. Design UNDER_REVIEW; implementation NOT_STARTED. No feature/code/schema/migration/remote seed/rotation/deployment/Git delivery. Owner baseline approval and separate S1 implementation authorization are required. Detailed S2–S5 UI/workflow design is not a G0 entry prerequisite; P1/R1 gates remain separate.
