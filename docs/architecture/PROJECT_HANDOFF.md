# EIU Medlabs Inventory — Project Handoff

> **NEW AGENT / NEW SESSION:** Read this file, then `docs/architecture/DECISION_LOG.md`, `docs/architecture/MASTER_ROADMAP.md`, and `docs/business/INVENTORY_BUSINESS_REQUIREMENTS.md` before planning or implementing Inventory work. Then inspect only the phase-specific reports/source evidence needed for the requested task. Old chat history is secondary to these persisted, user-approved decisions.

## 1. Current Phase

- Phase 1 architecture analysis: **COMPLETE**.
- Phase 2 v3 domain/database design: **COMPLETE**. Later approved product decisions override conditional assumptions in the Phase 2 report.
- Phase 3 foundation implementation planning: **COMPLETE** — `docs/architecture/PHASE_3_FOUNDATION_IMPLEMENTATION_PLAN.md`.
- Phase 3 implementation: **NOT STARTED**.
- Readiness verdict: **READY FOR PHASE 3 IMPLEMENTATION WITH TECHNICAL DECISIONS**.
- Next authorized action: resolve Slice 0 technical decisions, then explicitly authorize one implementation slice; do not state or imply implementation has started.
- Master roadmap and business-requirements consolidation: **COMPLETE**.

## 2. Source of Truth Hierarchy

1. `eiu-medlabs` — canonical implementation and platform authority.
2. `eiu-inventory-tracker` — generic Inventory feature, UX, and domain reference.
3. `qltbyt-nam-phong` — medical-equipment lifecycle and product reference only.
4. Approved business-requirement decisions — product behavior authority.
5. `docs/architecture/PHASE_2_V3_REPORT.md` — architecture evidence/status companion; later approved product decisions override its older conditional assumptions.

Medlabs wins for Next.js, Supabase, Auth, profiles/personnel, roles, RLS, RPC/server actions, generated database types, UI design, branding, and testing conventions.

Do not import from Nam Phong: NextAuth, custom JWT architecture, no-RLS architecture, RPC-only gateway architecture, `nhan_vien` identity, `don_vi` tenancy model, role taxonomy, or branding.

## 3. Locked Product Decisions

### DECISION A — Inventory Content

**APPROVED / LOCKED:** Inventory manages both quantity-tracked consumable/general stock and individually serialized physical equipment assets.

```text
inventory catalog
├── quantity stock
└── serialized equipment assets
```

Do not collapse both into one universal row model.

### DECISION B — Canonical Physical Asset

**APPROVED / LOCKED:** `equipment_assets` is the long-term canonical institutional physical-asset identity for Skills Lab, Basic Medical, and generic Inventory equipment.

No big-bang migration. Initial Phase 3 must not replace or merge `equipment_catalog`, `equipment_requests`, `basic_medical_equipment_catalog`, `basic_medical_room_inventory`, or Basic Medical confirmation/check/condition evidence. Use staged/strangler integration. Shared physical identity does not imply shared workflow tables.

### DECISION C — Maintenance / Calibration / Inspection

**APPROVED / LOCKED:** Maintenance, calibration, and inspection are EIU business requirements. Foundation architecture must support later normalized `equipment_service_plans` and `equipment_service_events`, with service types `maintenance`, `calibration`, and `inspection`. Do not copy Nam Phong's month-column model.

### DECISION D — Repair / Transfer

**APPROVED / LOCKED:** Repair and formal institutional equipment transfer/loan target V1.1. They are separate from asset lifecycle and from class-equipment handover/return.

### DECISION E — Inventory Access

**APPROVED / LOCKED:** V1 Inventory access is active Admin and active Staff only. Lecturer, teaching assistant, and viewer are denied by default. V1 has no per-location, per-room, per-lab, or department Inventory grants. Locations are operational data, not a V1 authorization boundary.

Use existing Medlabs roles plus private authorization predicates. Do not create `inventory_permission_grants` in V1 unless a concrete future requirement proves it necessary. Admin has full Inventory/security-sensitive authority; Staff has normal Inventory operational authority.

### DECISION F — Procurement

**APPROVED / LOCKED:** Medlabs does not own procurement. Do not build purchase orders, purchase approval, or a procurement state machine.

Retain acquisition/provenance information that can associate one acquisition/contract event with multiple assets or stock receipts: supplier, contract number/date, external procurement reference, funding source, acquisition date/cost, warranty, manufacturer, country of origin, and notes.

### DECISION G — Generic Inventory Request

**APPROVED / LOCKED:** Do not create `inventory_requests` or `inventory_request_lines`. Existing Medlabs equipment registration/request workflows are the business-demand source. Inventory owns fulfillment consequences: reservations, balances, movements, serialized allocation, and asset history.

## 4. Approved NEW → PREPARED Business Requirements

The approved NEW → PREPARED planning is authoritative:

- Requested demand is never overwritten by preparation data.
- Preparation stores separate actual prepared quantities; shortage is derived from requested versus prepared quantity.
- Shortage/zero-prepared lines require a configured shortage reason. Default reasons: insufficient stock, currently in use, under maintenance. Admin may configure more.
- Staff/Admin may add independent active catalog items during preparation; those items do not modify shortage calculation for an original request line.
- Preparation may use different commercial products from the originally requested representation.
- Each preparation line uses one source storage location.
- If pickup stock is insufficient, transfer stock first, then prepare from the resulting pickup/source location.
- Transfer updates both balances and immutable movement history.
- Reversal creates compensating movements; historical movements are never edited or deleted to fake a reversal.

## 5. Reservation Is a V1 Requirement

- **NEW:** demand only; no reservation.
- **PREPARED:** reserve actual prepared quantity; serialized equipment reserves the exact selected asset/serial.
- Reserved serialized assets cannot be selected by another request.
- At delivery, reservation transitions to issued/fulfilled.

Reservation and stock movement are different concepts. Phase 3 must design a real reservation contract; PREPARED is not merely a request-status change.

## 6. QR Is a V1 Serialized-Preparation Requirement

The prior “QR is later” assumption is superseded.

Serialized preparation requires QR or equivalent code scanning for exact asset selection. Server-side validation must confirm at least: active, compatible catalog/equipment identity, available, not reserved by another request, and not under maintenance, damaged, or otherwise prohibited from issue.

Invalid scans are blocked with a clear reason. QR resolves stable asset identity/code server-side and must not expose security-sensitive data.

## 7. Stock Transfer Is a V1 Requirement

The prior “stock transfer is later” assumption is superseded for stock-location transfer.

Preparation may require movement to the pickup/source location. The operation is atomic:

```text
source balance debit
+ destination balance credit
+ correlated immutable movements
+ audit
= all succeed or all fail
```

This is stock-location transfer. Formal serialized-asset custody/loan/department transfer remains a V1.1 workflow.

## 8. Medlabs Request → Inventory Fulfillment Target

```text
Existing Medlabs Equipment Request
        ↓
Preparation / Fulfillment
        ├── quantity stock: reservation
        └── serialized equipment: exact asset reservation + QR selection
        ↓
PREPARED
        ↓
later delivery workflow
```

Existing request workflow owns why equipment is requested, requester, activity/course context, timing, and existing workflow state. Inventory owns source stock/location, availability, transfer, reservation, physical asset selection, movements, and asset history. Do not create a duplicate request aggregate.

## 9. Current Proposed Foundation Domain

Conceptual foundation only; exact SQL/table names are not yet approved or implemented:

- inventory categories and catalog items;
- suppliers;
- acquisition/provenance records;
- storage locations;
- stock balances and immutable movements;
- equipment assets;
- reservation contract;
- shortage-reason configuration;
- preparation/fulfillment relationship to existing Medlabs request lines.

## 10. Explicitly Deferred

Do not implement without explicit later authorization:

- Skills/Basic Medical migration into canonical assets;
- maintenance, calibration, or inspection UI/workflows;
- repair workflow;
- formal asset transfer/loan workflow;
- usage sessions;
- generic document management;
- advanced analytics/reporting.

Repair and formal asset transfer target V1.1. Maintenance/calibration/inspection are required future domains but not the first implementation tracer.

## 11. Unfinished Business Requirements

NEW → PREPARED is approved in substantial detail. The later PREPARED → PARTIALLY_DELIVERED → DELIVERED workflow remains partially unresolved. Do not infer or implement unapproved delivery behavior.

## 12. Architecture Invariants

- Medlabs profiles are canonical personnel identity; no duplicate user/personnel table.
- Medlabs Supabase Auth remains canonical; RLS remains required.
- `TO authenticated` alone is never authorization.
- Basic Medical evidence semantics must not be destroyed.
- Existing Skills/Basic Medical workflows must not be mechanically merged.
- Stock movements are immutable; reversal uses compensating movement.
- Balance mutations are transactional.
- Reservation and movement differ.
- Requested demand and prepared fulfillment differ.
- Asset lifecycle and repair/service/transfer states differ.
- No destructive Git operations.
- No production database mutation without explicit verification.

## 13. Current Phase 3 Foundation Direction

1. **Slice 0:** freeze/update handoff and acceptance criteria.
2. **Slice 1:** Admin/Staff access gate; categories; catalog; suppliers; acquisition provenance.
3. **Slice 2:** storage locations; balances; receive; adjustment; immutable movement ledger.
4. **Slice 3:** stock transfer.
5. **Slice 4:** serialized asset registry; code/serial; basic lifecycle; location/custodian; QR lookup/select validation.
6. **Slice 5:** reservation foundation for quantity and exact serialized assets.
7. **Slice 6:** existing-request preparation integration: preserve demand, preparation allocations, shortage reasons, source location, and transactional NEW → PREPARED.

This is current direction, not authorization to implement all slices together. Verify each slice before the next.

## 14. Current Evidence / Reference Files

Read first as needed:

- `docs/architecture/PROJECT_HANDOFF.md`
- `docs/architecture/DECISION_LOG.md`
- `docs/architecture/MASTER_ROADMAP.md`
- `docs/business/INVENTORY_BUSINESS_REQUIREMENTS.md`
- `docs/business/evidence/LEGACY_INVENTORY_BUSINESS_PLANNING_230_360.txt` — historical approved NEW → PREPARED planning evidence; 301–360 remains unanswered delivery planning.
- `docs/architecture/PHASE_3_FOUNDATION_IMPLEMENTATION_PLAN.md` — Phase 3 contract, migration, test, risk, and seven-slice implementation plan.
- `docs/architecture/PHASE_2_V3_REPORT.md`
- `docs/UI_DESIGN_SYSTEM_V2_MASTER.md`
- `.omp/REFERENCE_REPOS.md`
- `.omp/AGENTS.md`
- `supabase/schemas/01_app.sql` — profiles, roles, private authorization predicates, audit logs.
- `supabase/schemas/03_registration_workflows.sql` — Skills catalog and requests.
- `supabase/schemas/25_basic_medical_equipment_request_wave_1.sql` — request-domain firewall.
- `supabase/migrations/20260805160000_basic_medical_room_equipment_confirmation.sql` — Basic Medical catalog, room inventory, checks, and condition evidence.
- `supabase/schemas/10_equipment_transactional_outbox.sql` — outbox.

Repository evidence does not prove live production Supabase state.

## 15. Continuity Authority Rule

For Inventory/Equipment work:

```text
PROJECT_HANDOFF.md
= current project truth

DECISION_LOG.md
= approved decision history

MASTER_ROADMAP.md
= release/phase sequencing

INVENTORY_BUSINESS_REQUIREMENTS.md
= approved business behavior

Phase reports
= supporting architecture/repository evidence
```

If these documents disagree:

1. the newest explicit user-approved decision in `DECISION_LOG.md` wins;
2. current `PROJECT_HANDOFF.md` reflects that decision;
3. approved business behavior comes from `INVENTORY_BUSINESS_REQUIREMENTS.md`;
4. old phase reports are evidence/history and do not override later decisions.

## 16. Maintenance Rule

At the end of every substantial Inventory/Equipment architecture or implementation phase:

1. update Current Phase and next authorized work here;
2. append newly approved decisions to `DECISION_LOG.md`;
3. mark superseded assumptions explicitly;
4. update implementation slices when scope changes;
5. preserve unresolved questions separately;
6. never silently rewrite history to make old decisions disappear.

`PROJECT_HANDOFF.md` describes current truth. `DECISION_LOG.md` preserves why and when truth changed.
