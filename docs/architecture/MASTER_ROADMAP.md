# EIU Medlabs Inventory / Equipment — Master Roadmap

## 1. Product Target

EIU Medlabs is the canonical platform. Inventory manages quantity-tracked stock and serialized physical assets. `equipment_assets` is the long-term canonical physical identity.

Existing Skills and Basic Medical workflows remain domain-owned. Their physical equipment is associated gradually through staged/strangler integration; no big-bang migration, workflow merge, catalog drop, or evidence-history rewrite.

## 2. Release Vocabulary

| Term | Meaning |
|---|---|
| FOUNDATION | Minimum reliable contracts and tracer slices required before broader operations. |
| V1 | Approved operational capability required for initial Inventory/Preparation use. |
| V1.1 | Approved next release after foundation/V1 proof. |
| LATER | Deferred capability; not necessarily optional if already a confirmed business requirement. |
| REJECTED / OUT OF SCOPE | Explicitly not built under current product ownership decisions. |

## 3. Completed Phases

| Phase | Status | Outcome |
|---|---|---|
| Phase 1 — Cross-repository architecture analysis | COMPLETE | Medlabs selected as platform/security/design authority. |
| Phase 2 v3 — Domain / authorization / database contract design | COMPLETE | Historical architecture evidence; later decisions override conditional assumptions. |
| Continuity / decision consolidation | COMPLETE | Handoff, decision log, roadmap, and business requirements are durable continuity sources. |
| Phase 3 implementation | NOT STARTED | Next work is foundation specification and small verified tracer slices. |

## 4. Phase 3 — Inventory Foundation

**Goal:** Build the minimum reliable Inventory foundation inside Medlabs. Each slice is independently specified, implemented, and verified before the next.

### Slice 0 — Foundation specification / acceptance freeze

- Confirm exact schema names/contracts.
- Write OpenSpec or GIVEN-WHEN-THEN acceptance criteria.
- Confirm local/staging verification prerequisites.
- No feature implementation in this slice.

### Slice 1 — Access + catalog foundation

- Active Admin/Staff Inventory access gate.
- Categories, catalog items, suppliers, acquisition/provenance records.
- Generated DB types and RLS/security tests.

### Slice 2 — Storage and stock ledger

- Storage locations, stock balances, immutable movements.
- Receive and adjustment operations, audit, and atomic rollback tests.

### Slice 3 — Stock-location transfer

- Source/destination transfer, correlated immutable movements, nonnegative stock, compensating reversals, and atomicity tests.
- This is Inventory **stock-location transfer**, not formal asset transfer/loan.

### Slice 4 — Serialized asset registry

- `equipment_assets`, stable asset/equipment code, serial, manufacturer/model/origin, acquisition/provenance link, warranty, location, custodian, basic lifecycle, search, and detail.

### Slice 5 — Serialized selection + reservation foundation

- QR/code lookup, eligibility validation, quantity reservation, exact asset reservation, double-reservation prevention, and reservation history/audit.

### Slice 6 — Existing Medlabs request → Inventory preparation

- Preserve immutable original request demand.
- Preparation allocations, prepared quantities, shortage quantities/reasons, independent added catalog lines, source location, required stock transfer, serialized selection, reservation creation, concurrency/version behavior, audit, and transactional NEW → PREPARED.
- Do not implement the unresolved delivery workflow.

## 5. Phase 4 — Delivery / Return Workflow

**Status: BUSINESS REQUIREMENTS INCOMPLETE.**

Target concepts eventually include:

```text
PREPARED → PARTIALLY_DELIVERED → DELIVERED → RETURN / COMPLETE
```

User decisions remain required for actual receiver/substitution, delivery QR re-scan, serial replacement, condition confirmation, signatures, partial delivery, reservation-to-issued timing, asset custody, delivery reversal, and return handling. Do not infer these requirements.

## 6. Phase 5 — Canonical Asset Integration

Gradually associate existing Skills and Basic Medical physical equipment with canonical `equipment_assets` through strangler migration.

Target: one physical device has one canonical institutional identity while Skills/Basic Medical retain their workflow and evidence contracts.

Do not drop existing catalogs, merge workflows, rewrite evidence history, or perform a big-bang migration.

## 7. Phase 6 — Equipment Lifecycle V1.1

Approved future workflows:

- repair;
- formal institutional asset transfer;
- loan;
- maintenance;
- calibration;
- inspection.

Repair and formal transfer/loan target V1.1. Service domains are confirmed requirements and begin when foundation evidence supports them. Keep each workflow independent from narrow asset lifecycle state. Preferred normalized service direction: `equipment_service_plans` and `equipment_service_events`; never use Nam Phong month-column maintenance storage.

## 8. Phase 7 — Operational Enhancements

Potential later capabilities after stable production history:

- service certificates, warranty documents, equipment photos/manuals;
- richer asset history;
- due and low-stock notifications;
- dashboards, reporting, analytics.

AI/advanced insights are not foundation priorities.

## 9. Rejected / Explicitly Not Built

- Generic Inventory request aggregate.
- Inventory purchase-order/procurement workflow.
- Second personnel/user identity.
- Nam Phong NextAuth/JWT/no-RLS architecture.
- Nam Phong role taxonomy.
- Generic merge of Skills/Basic Medical catalogs.
- One universal stock-plus-asset row model.
- Speculative V1 per-location authorization framework.

## 10. Feature Backlog Matrix

| Feature | Release | Status | Dependency | Business Requirement | Notes |
|---|---|---|---|---|---|
| Inventory access | FOUNDATION | APPROVED — NOT IMPLEMENTED | Existing active Admin/Staff roles | V1 Admin/Staff only | No location scope in V1. |
| Categories | FOUNDATION | APPROVED — NOT IMPLEMENTED | Access gate | Catalog organization | Generic Inventory only. |
| Catalog | FOUNDATION | APPROVED — NOT IMPLEMENTED | Categories/access | Stock and asset definition | Do not replace existing catalogs. |
| Suppliers | FOUNDATION | APPROVED — NOT IMPLEMENTED | Catalog | Acquisition provenance | Reference data only. |
| Acquisition provenance | FOUNDATION | APPROVED — NOT IMPLEMENTED | Catalog/supplier | External procurement references | No procurement workflow. |
| Storage locations | FOUNDATION | APPROVED — NOT IMPLEMENTED | Access/catalog | Source/pickup operations | Operational, not auth boundary. |
| Stock balance | FOUNDATION | APPROVED — NOT IMPLEMENTED | Catalog/location | Availability/reservation | Transaction-maintained. |
| Receive | FOUNDATION | APPROVED — NOT IMPLEMENTED | Balance/movement | New stock receipt | Atomic/audited. |
| Adjustment | FOUNDATION | APPROVED — NOT IMPLEMENTED | Balance/movement | Correct operational stock | Reason/audit required. |
| Stock movement | FOUNDATION | APPROVED — NOT IMPLEMENTED | Balance | Immutable history | Compensating reversal only. |
| Stock transfer | V1 | APPROVED — NOT IMPLEMENTED | Location/balance/movement | Preparation source availability | Stock-location transfer only. |
| Serialized assets | V1 | APPROVED — NOT IMPLEMENTED | Catalog/provenance | Canonical physical identity | Staged integration. |
| QR lookup | V1 | APPROVED — NOT IMPLEMENTED | Assets | Exact serialized selection | Server-side eligibility validation. |
| Reservation | V1 | APPROVED — NOT IMPLEMENTED | Balance/assets | Begins at PREPARED | Separate from movement. |
| Preparation | V1 | APPROVED — NOT IMPLEMENTED | Reservation/request integration | Fulfillment planning | Existing request remains demand. |
| Shortage handling | V1 | APPROVED — NOT IMPLEMENTED | Preparation | Derived shortage/reason | Configurable reasons. |
| NEW → PREPARED | V1 | APPROVED — NOT IMPLEMENTED | Preparation/reservation | Atomic fulfillment-plan transition | Do not overwrite demand. |
| Delivery | Phase 4 | BUSINESS REQUIREMENTS INCOMPLETE | Approved delivery rules | Actual issue/delivery | Do not implement. |
| Partial delivery | Phase 4 | BUSINESS REQUIREMENTS INCOMPLETE | Delivery rules | Partial issue | Do not infer. |
| Return | Phase 4 | BUSINESS REQUIREMENTS INCOMPLETE | Delivery rules | Return/complete | Do not infer. |
| Canonical Skills asset mapping | Phase 5 | DEFERRED | Canonical assets | Staged physical identity | No workflow merge. |
| Canonical Basic Medical asset mapping | Phase 5 | DEFERRED | Canonical assets | Staged physical identity | Preserve evidence semantics. |
| Repair | V1.1 | APPROVED — NOT IMPLEMENTED | Assets/history | Institutional repair | Separate workflow. |
| Formal transfer | V1.1 | APPROVED — NOT IMPLEMENTED | Assets/history | Institutional custody/location transfer | Not stock transfer. |
| Loan | V1.1 | APPROVED — NOT IMPLEMENTED | Assets/history | Formal loan | Separate workflow. |
| Maintenance | V1.1/LATER | APPROVED — NOT IMPLEMENTED | Assets/service model | Confirmed future requirement | Normalized plan/events. |
| Calibration | V1.1/LATER | APPROVED — NOT IMPLEMENTED | Assets/service model | Confirmed future requirement | Normalized plan/events. |
| Inspection | V1.1/LATER | APPROVED — NOT IMPLEMENTED | Assets/service model | Confirmed future requirement | Normalized plan/events. |
| Documents | LATER | DEFERRED | Stable asset history | Private evidence | Policy first. |
| Notifications | LATER | DEFERRED | Stable operations/outbox | Due/low-stock events | Reuse Medlabs outbox. |
| Reporting | LATER | DEFERRED | Production history | Operational reporting | No foundation dashboard. |
| Analytics | LATER | DEFERRED | Production history | Operational insights | No AI priority. |
