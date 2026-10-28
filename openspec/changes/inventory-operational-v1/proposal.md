# Inventory operational V1

The owner authorized implementation of the reviewed plan on 2026-10-28. Prioritize reusable quantities, sudden request changes and receiving multiple physical returns. Reference: `D:/Orca/MedLabs-Deep-Review-2026-10-28/05-WORKFLOW-PRODUCT-PLAN.md`.

## Bounded implementation contract

- Preserve S1–S5/P1, immutable original demand/signatures, authorization and exact decimals.
- Preserve release-all on initial handover; explain the unissued remainder is not reserved.
- Preserve current signers. Record a carrier as event metadata, not delegated signing authority.
- Add explicit incremental `recover` input, retaining cumulative default for existing clients. Corrections always take replacement actuals.
- Allow Staff/Admin managing an already handed-over Skills request to append an additional mapped catalog line, before initial return. This records the request/reason without reserving or issuing. Physical supplement remains a separate existing operation. Registered/planned baseline for the added line is zero; its requested quantity remains traceable. Require existing catalog-to-stock mapping; do not infer equivalence by name or introduce mapping writes through this seam.
- Keep the public fulfillment P1 wrapper. New commands remain in the same writer lane with explicit scope classification, revision, replay and audit.
- Provide a bounded operational worklist, readable event evidence and event-aware PDF. Legacy exports retain compatibility.
- Fix exact correction previews and protect unsaved count observations. Patch audited dependencies.

No new time allocator, automatic release, generic stock delta API, broad TA rights, Basic Medical cutover, production data/remote migration or deployment is included.

## Validation

Behavioral tests cover precision, cumulative/incremental compatibility, mixed good/damaged returns, retry/stale/over-return/correction and amendment permission/stage/scope boundaries. Re-run affected S1–S5/P1 integration, build and changed-file checks. Visual work remains VERIFY until owner review; do not mark full real-stock readiness or production replacement complete.
