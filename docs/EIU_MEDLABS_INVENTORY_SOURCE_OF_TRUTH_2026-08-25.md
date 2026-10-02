# EIU Medlabs Inventory / Equipment — Project Source of Truth

**Snapshot date:** 2026-08-25  
**Purpose:** Self-contained project snapshot for continuity, review, Phase 3 execution, and future architecture diagrams.  
**Scope:** Current product decisions, business requirements, technical direction, roadmap, repository authority, risks, and unresolved items for the EIU Medlabs Inventory / Equipment initiative.

> This is a current-state snapshot. If a newer explicit user-approved decision is later recorded in the repository continuity documents, that newer decision wins.

---

# 1. Executive Summary

EIU Medlabs is the canonical application and implementation platform.

The Inventory / Equipment capability is being expanded **inside EIU Medlabs**. Two other repositories are reference sources only:

- `eiu-medlabs` — platform, security, identity, database, UI, testing, and implementation authority.
- `eiu-inventory-tracker` — generic inventory/stock/supplier/location UX and domain reference.
- `qltbyt-nam-phong` — medical-equipment lifecycle reference.

The unified Inventory capability manages two distinct inventory modes:

1. **Quantity-tracked stock** — consumables, supplies, non-serialized stock, balance by location.
2. **Serialized physical assets** — one institutional identity per device, stable asset code, serial number, location, lifecycle, operational state, exact-asset reservation.

The long-term canonical physical identity is:

`equipment_assets`

Existing Skills and Basic Medical workflows remain domain-owned during the initial rollout and are associated with canonical assets later through staged migration.

Current status:

- Phase 1 — COMPLETE
- Phase 2 v3 — COMPLETE
- Continuity / business-evidence consolidation — COMPLETE
- Phase 3 planning — COMPLETE
- Phase 3 implementation — NOT STARTED
- Current next action — finish/freeze Slice 0 technical contracts, then implement Slice 1 only

---

# 2. Repository Authority

## 2.1 Canonical repository

`D:\orca\eiu-medlabs`

Authoritative for:

- Next.js App Router
- React
- Supabase/PostgreSQL
- Auth
- `profiles`
- `user_roles`
- RLS
- private authorization predicates
- server action / RPC patterns
- generated DB types
- audit
- email outbox
- WorkspaceShell
- Medlabs UI design system
- testing conventions
- migrations/declarative schema

## 2.2 Generic Inventory reference

`D:\orca\eiu-inventory-tracker`

Reference for:

- categories
- catalog/item concepts
- suppliers
- locations
- stock movement
- balances
- inventory UX

Important:

- Runtime is mainly demo/in-memory.
- Its Supabase SQL documents are reference/proposed contracts, not current Medlabs runtime authority.
- No new unified backend should be implemented there.

## 2.3 Medical asset lifecycle reference

`D:\orca\references\qltbyt-nam-phong`

Reference for:

- serialized equipment
- QR identity
- lifecycle/history
- repair
- maintenance
- transfer
- loan
- disposal
- warranty/manufacturer/origin metadata

Do **not** copy:

- NextAuth
- custom JWT/no-RLS platform architecture
- `nhan_vien` identity
- `don_vi` tenancy
- custom role taxonomy
- application shell/branding
- mandatory Git automation rules
- denormalized month-column maintenance model

---

# 3. Current Medlabs Platform

EIU Medlabs currently uses:

- Next.js App Router
- React 19
- TypeScript
- Supabase
- PostgreSQL
- declarative Supabase schemas
- generated DB types
- Tailwind CSS 4
- Be Vietnam Pro

Canonical design identity:

- EIU Blue `#144069`
- EIU Gold `#A78656`
- EIU Cream `#F6F1E8`

Canonical design authority:

`docs/UI_DESIGN_SYSTEM_V2_MASTER.md`

Existing Medlabs security/domain infrastructure includes:

- `profiles`
- `user_roles`
- active-user predicates
- role predicates
- private authorization functions
- audited personnel operations
- Skills equipment workflows
- Basic Medical equipment workflows
- `audit_logs`
- `email_outbox_events`

Inventory must extend these contracts without damaging them.

---

# 4. Source-of-Truth Hierarchy

For Inventory / Equipment work, read in this order:

1. `docs/architecture/PROJECT_HANDOFF.md`
2. `docs/architecture/DECISION_LOG.md`
3. `docs/architecture/MASTER_ROADMAP.md`
4. `docs/business/INVENTORY_BUSINESS_REQUIREMENTS.md`
5. raw historical business evidence
6. `docs/architecture/PHASE_3_FOUNDATION_IMPLEMENTATION_PLAN.md`
7. `docs/architecture/PHASE_2_V3_REPORT.md`
8. current Medlabs source/schema
9. reference repositories

Meaning:

- `PROJECT_HANDOFF.md` = current project truth
- `DECISION_LOG.md` = approved decision history
- `MASTER_ROADMAP.md` = release/phase sequencing
- `INVENTORY_BUSINESS_REQUIREMENTS.md` = approved business behavior
- raw business evidence = historical proof
- Phase reports = architecture/repository evidence
- current source/schema = implementation reality
- reference repos = ideas only

If an older report conflicts with a newer explicit approved decision, the newer decision wins.

---

# 5. Historical Business Evidence

Raw business-planning evidence:

`docs/business/evidence/LEGACY_INVENTORY_BUSINESS_PLANNING_230_360.txt`

The raw evidence is preserved unchanged.

Boundary:

- Decisions approximately 230–300 = approved NEW → PREPARED business evidence.
- Questions approximately 301–360 = unfinished delivery planning.

Therefore:

**NEW → PREPARED = APPROVED**

**PREPARED → PARTIALLY_DELIVERED → DELIVERED / RETURN = UNRESOLVED**

Unanswered options must never be promoted to requirements.

---

# 6. Locked Product Decisions

## 6.1 Inventory modes

Inventory manages both:

- quantity-tracked stock
- individually serialized physical assets

## 6.2 Canonical physical identity

`equipment_assets` is the approved long-term canonical institutional identity for a physical device.

Long-term target:

`one physical device = one equipment_assets row`

Skills and Basic Medical keep their own workflows/evidence and later reference canonical assets through staged migration.

No big-bang merge.

## 6.3 V1 access

Allowed:

- active `admin`
- active `staff`

Denied:

- `lecturer`
- `teaching_assistant`
- `viewer`

No speculative V1 permission scope by:

- room
- lab
- department
- storage location

No `inventory_permission_grants` framework unless a concrete future need is proven.

## 6.4 Procurement

Medlabs does **not** own procurement workflow.

Do not build:

- purchase orders
- purchase-order lines
- procurement approval workflow
- purchasing state machine

Inventory stores acquisition/provenance only.

## 6.5 Generic Inventory request

Do **not** create:

- `inventory_requests`
- `inventory_request_lines`

Existing Medlabs equipment request/registration is the business demand source.

Inventory owns physical fulfillment consequences.

## 6.6 Reservation timing

`NEW`:

- demand only
- no reservation

`PREPARED`:

- reserve actual prepared quantity
- reserve exact serialized assets

Reservation is not stock movement.

## 6.7 QR

QR/code lookup for serialized preparation is a V1 requirement.

## 6.8 Stock-location transfer

Stock-location transfer is a V1 requirement.

It is not the later formal asset transfer/loan workflow.

## 6.9 V1.1

Approved V1.1 domains:

- repair
- formal asset transfer
- loan

## 6.10 Required future service domains

Confirmed future requirements:

- maintenance
- calibration
- inspection

They are not implemented in initial Phase 3.

---

# 7. Admin / Staff Operating Model

Principle:

**Staff = daily operations**

**Admin = daily operations + configuration + terminal/destructive business states + override**

| Operation | Admin | Staff |
|---|---:|---:|
| View Inventory | Yes | Yes |
| View acquisition cost | Yes | Yes |
| Create/edit category | Yes | Yes |
| Deactivate category | Yes | No |
| Create/edit catalog item | Yes | Yes |
| Deactivate catalog item | Yes | No |
| Create/edit supplier | Yes | Yes |
| Deactivate supplier | Yes | No |
| Create/edit acquisition record | Yes | Yes |
| View all acquisition data | Yes | Yes |
| Create/edit storage location | Yes | Yes |
| Deactivate location | Yes | No |
| Receive stock | Yes | Yes |
| Adjust stock | Yes | Yes |
| Stock transfer | Yes | Yes |
| Register serialized asset | Yes | Yes |
| Edit asset facts | Yes | Yes |
| Change operational status | Yes | Yes |
| Retire asset | Yes | No |
| Dispose asset | Yes | No |
| Configure shortage reasons | Yes | No |
| Prepare request | Yes | Yes |
| NEW → PREPARED | Yes | Yes |
| PREPARED → NEW | Yes | Yes |
| Override/transfer another user's preparation lock | Yes | No |
| Release own lock | Yes | Yes |

Stock adjustment:

- Admin + Staff allowed
- free-text reason mandatory
- audit mandatory
- no reason taxonomy required in V1

Recommended validation:

`trim(adjustment_reason) <> ''`

---

# 8. Asset Identity and State

## 8.1 Asset code

No existing EIU-wide convention is currently available to this project.

Approved format:

`EIU-AST-XXXXXXXX`

Examples:

- `EIU-AST-7M4K92DX`
- `EIU-AST-3F8R6WQP`

Properties:

- system generated
- immutable
- unique
- never reused
- human-readable
- no room encoded
- no department encoded
- no category encoded
- no year encoded
- independent of serial number
- independent of lifecycle

Suffix should use a human-friendly generated alphabet and avoid ambiguous characters where practical.

`asset_code` is distinct from manufacturer `serial_number`.

## 8.2 Lifecycle status

Approved:

- `registered`
- `in_service`
- `inactive`
- `retired`
- `disposed`

Lifecycle is the institutional lifecycle axis.

Do not add a redundant `active` boolean for the same meaning.

## 8.3 Operational status

Approved separate axis:

- `ready`
- `in_use`
- `under_maintenance`
- `damaged`
- `prohibited`

Use `operational_status`.

Do not use `issue_condition` as the canonical name.

Do not store a generic `availability_status` source-of-truth column.

## 8.4 Availability

Availability is derived.

Phase 3 preparation eligibility:

```text
eligible_for_preparation =
    lifecycle_status == in_service
    AND operational_status == ready
    AND no_active_reservation
```

Physical condition at handover/return remains a separate later concern.

---

# 9. Catalog Model

Target:

`inventory_catalog_items`

Catalog defines a product/equipment concept, not physical inventory.

Conceptual relationship:

```text
inventory_catalog_items
    ├── quantity-tracked
    │      └── inventory_stock_balances
    │             └── inventory_stock_movements
    │
    └── serialized
           └── equipment_assets
```

Do not create one universal row representing both a stock balance and one physical asset.

Catalog responsibilities may include:

- code/SKU
- name
- category
- unit of measure
- tracking strategy
- manufacturer/model defaults where appropriate
- active/inactive state
- optional barcode
- reorder threshold where appropriate

Asset-specific facts belong on `equipment_assets`.

---

# 10. Categories

Target:

`inventory_categories`

Admin + Staff:

- create
- edit

Admin only:

- deactivate

Avoid hard delete once referenced.

---

# 11. Suppliers

Target:

`inventory_suppliers`

Admin + Staff:

- create
- edit

Admin only:

- deactivate

Avoid hard delete once referenced.

---

# 12. Acquisition / Provenance

Target direction:

- `inventory_acquisition_records`
- `inventory_acquisition_record_lines`

This is provenance, not procurement.

Conceptual model:

```text
Acquisition record / contract
    ├── supplier
    ├── contract number
    ├── contract date
    ├── external procurement reference
    ├── funding source
    ├── notes
    │
    └── acquisition lines
           ├── product/catalog reference
           ├── quantity/value facts
           ├── serialized assets
           └── stock receipts
```

Reasons for header + lines:

- one contract can contain multiple product types
- multiple assets can originate from one contract
- stock receipts can link to the correct line
- contract metadata is not duplicated on every asset
- no PO workflow is introduced

Admin + Staff:

- read all acquisition information
- see acquisition cost
- create
- edit

Hard delete is not allowed once used historically.

Differentiate:

### Acquisition-level facts

- supplier
- contract number
- contract date
- external procurement reference
- funding source

### Asset-specific facts

May include:

- actual unit cost
- asset-specific acquisition date
- warranty start/end
- serial
- actual factual variation from a batch/header

Do not blindly duplicate all header facts onto every asset.

---

# 13. Storage Locations

Target:

`inventory_storage_locations`

Distinguish:

- request pickup location
- inventory storage location
- asset current/install location
- organizational ownership
- personnel custody

Storage locations are operational data, not V1 authorization boundaries.

Likely requirements:

- code/name
- active/inactive
- optional hierarchy
- optional mapping to Medlabs `rooms`
- cycle prevention
- no destructive deletion once referenced

Admin + Staff create/edit.

Admin only deactivate.

---

# 14. Quantity Stock Model

Targets:

- `inventory_stock_balances`
- `inventory_stock_movements`

Conceptual balance:

```text
on_hand
reserved_quantity
available = on_hand - reserved_quantity
```

Current preferred direction:

- `on_hand` stored
- `reserved_quantity` stored as transaction-maintained projection
- reservation rows explain what is reserved
- `available` derived

Hard invariants:

- stock cannot become negative
- no direct UI balance editing
- movement ledger immutable
- reversal by compensating movement
- all balance mutation through controlled transaction boundaries

---

# 15. Stock Adjustment

Admin + Staff may adjust stock.

Requirements:

- mandatory free-text `adjustment_reason`
- non-empty after trimming
- audit mandatory
- balance + movement + audit are atomic

Conceptual audit/evidence:

- actor
- catalog item
- location
- quantity before
- delta
- quantity after
- free-text reason
- timestamp
- correlation/reference

No configurable adjustment-reason framework in V1.

---

# 16. Stock Movement Ledger

Target:

`inventory_stock_movements`

Conceptual movement types:

- `receive`
- `adjustment_in`
- `adjustment_out`
- `transfer_out`
- `transfer_in`

Future delivery may add issue/return types.

Requirements:

- append-only / immutable
- actor
- timestamp
- catalog item
- quantity
- source/destination where applicable
- correlation id
- external/domain reference
- immutable metadata where justified

Never edit/delete old movements to fake rollback.

---

# 17. Stock-Location Transfer

V1 required.

Concept:

```text
Source location
     │
     │ transfer_out
     ▼
correlation_id
     ▲
     │ transfer_in
Destination location
```

Atomic requirements:

1. deterministically lock source/destination balances
2. validate source available stock
3. debit source
4. credit destination
5. create correlated immutable movements
6. audit
7. commit all or rollback all

No separate `in_transit` state required now.

Undo by compensating reverse transfer/movements only.

---

# 18. Serialized Asset Registry

Target:

`equipment_assets`

One row = one physical institutional device.

Conceptual fields:

- id
- immutable `asset_code`
- `catalog_item_id`
- serial number
- manufacturer/model facts as needed
- acquisition-line reference
- acquisition date/value facts
- funding source where asset-specific
- warranty start/end
- country of origin
- current location
- optional custodian profile
- lifecycle status
- operational status
- notes
- created/updated metadata

Do not encode these as asset lifecycle values:

- repair
- maintenance
- calibration
- inspection
- transfer
- loan
- usage

Those remain separate domain workflows.

---

# 19. Future Service Compatibility

Future normalized direction:

- `equipment_service_plans`
- `equipment_service_events`

These reference `equipment_assets.id`.

Do not add month columns to `equipment_assets`.

Do not implement maintenance/calibration/inspection workflows in initial Phase 3.

---

# 20. Reservation Model

Reservation is core V1.

Current preferred direction:

**one constrained `inventory_reservations` table**

## 20.1 Quantity reservation

Conceptually:

- catalog item
- storage location
- quantity
- owning preparation/request reference
- active/released state
- no `asset_id`

Effects:

- create reservation row
- increment balance `reserved_quantity` transactionally
- do not change `on_hand`

## 20.2 Serialized reservation

Conceptually:

- exact `equipment_assets.id`
- owning preparation/request reference
- active/released state
- no quantity balance projection

Effects:

- one active reservation per exact asset
- partial unique constraint prevents conflict
- do not change `inventory_stock_balances.reserved_quantity`

## 20.3 Timing

At NEW:

- no reservation

At PREPARED:

- quantity reservation becomes active
- exact asset reservation becomes active

At PREPARED → NEW:

- reservation released
- history preserved

Delivery/consumed semantics are Phase 4, not Phase 3.

---

# 21. Existing Request → Inventory Preparation

Existing Medlabs request remains business demand authority.

Do not overwrite original demand with fulfillment data.

Target normalized direction:

- `equipment_request_preparations`
- `equipment_request_preparation_requirements`
- `equipment_request_preparation_allocations`
- `equipment_request_preparation_asset_selections`

---

# 22. Preparation Attempt History

Preparation is attempt-based, not one mutable row forever.

Concept:

```text
Request
  ├── Preparation Attempt #1
  │      └── reversed
  │
  └── Preparation Attempt #2
         └── current
```

Each attempt may contain:

- request id
- attempt number
- source request revision
- source digest/snapshot metadata
- progress state
- lock fields
- primary preparer
- timestamps

Only one current attempt should exist.

PREPARED → NEW:

- attempt becomes `reversed`
- reservations released
- history preserved

Later re-preparation creates a new attempt.

---

# 23. Preparation Requirement Snapshot

Existing request editing may delete/reinsert `equipment_request_items`.

Therefore preparation must not depend on a mandatory long-lived FK alone.

Target `equipment_request_preparation_requirements` direction:

- immutable requirement id
- preparation attempt id
- nullable `source_equipment_request_item_id`
- source-line snapshot
- requested quantity snapshot
- prepared/allocation-derived data
- shortage/reason
- notes
- needs-review

FK behavior:

`ON DELETE SET NULL`

If request items are replaced:

- preparation history survives
- affected requirements require reconciliation/re-review
- no cascade deletion of preparation history

---

# 24. Preparation Allocations

Target:

`equipment_request_preparation_allocations`

Purpose:

represent actual catalog/product choices used to fulfill original demand.

One demand line may use multiple actual products.

Example:

```text
Requested:
Monitor × 3

Actual:
Model A × 2
Model B × 1
```

Allocation fields conceptually include:

- preparation attempt
- optional requirement
- actual catalog item
- source storage location
- quantity
- notes

If `requirement_id` is null:

- independent additional catalog line
- does not automatically reduce shortage on an original requirement

Each allocation ultimately uses one final source location.

---

# 25. Draft Asset Selection

Target:

`equipment_request_preparation_asset_selections`

Purpose:

record exact serialized assets selected during preparation before final PREPARED transition.

It is not yet the reservation.

At PREPARED:

- assets are revalidated
- reservations created atomically
- invalid/stale/double-reserved assets reject transition

---

# 26. QR / Code Lookup

V1 required.

QR/code resolves server-side to stable asset identity.

Do not embed sensitive data.

Eligibility:

```text
lifecycle_status = in_service
AND operational_status = ready
AND compatible catalog/equipment identity
AND no active conflicting reservation
```

Asset-code foundation:

`EIU-AST-XXXXXXXX`

Exact QR payload format is intentionally not frozen yet and can be finalized in Slice 5.

Manual asset-code entry should remain possible.

---

# 27. NEW Queue / Preparation Workflow

Approved business behavior:

- shared Admin / Chuyên viên Labs preparation queue
- filters/search/sorting
- default priority:
  1. overdue preparation
  2. earliest pickup
  3. earliest class
- no automatic assignee
- near-pickup unprepared warning
- Admin/Labs notification audience
- common Admin-configurable warning lead time
- no mandatory claim step
- explicit start preparation behavior
- public state remains NEW while preparation incomplete
- no public `PARTIALLY_PREPARED`
- auto-save supported
- manual Save Progress supported

---

# 28. Preparation Editing Lock

Approved business behavior:

- whole Preparation tab has one active editor
- Admin can unlock/transfer control
- other Staff cannot silently take over
- release may occur on completion, cancel/exit, timeout according to approved behavior

Current technical direction:

store lock metadata on current preparation attempt, e.g.:

- lock holder profile
- acquired_at
- expires_at / heartbeat metadata if required

Lock is UX coordination, not final database concurrency authority.

NEW → PREPARED transaction must independently revalidate all invariants.

---

# 29. Requested Demand vs Prepared Fulfillment

Original demand is preserved.

Original request holds:

- requested context/item
- requested quantity

Preparation separately holds:

- prepared quantity
- shortage
- shortage reason
- notes
- actual catalog selections
- source location
- selected serialized assets

If not fully prepared:

- original demand remains unchanged
- shortage is explicit/derived
- reason required where approved

An independently added Catalog line does not automatically reduce original shortage.

---

# 30. Shortage Reasons

Target:

`inventory_shortage_reasons`

Default concepts:

- insufficient stock
- currently in use
- under maintenance

Admin may add/edit/deactivate.

Historical references remain valid after deactivation.

If every preparation line is zero, request cannot become PREPARED.

---

# 31. Source Storage vs Pickup

Keep distinct:

- pickup location
- source storage location
- asset current physical location

Approved behavior:

- use final/pickup source where possible
- if insufficient, complete stock-location transfer first
- after confirmed transfer, final source is the resulting preparation source
- movement history preserves original source
- no current in-transit workflow

---

# 32. Request Revision / Invalidation

Current approved technical direction:

add monotonic request revision.

Conceptually:

`equipment_requests.revision`

Example:

```text
revision = 1
user edits business demand
revision = 2
```

Preparation attempt stores:

`source_request_revision`

PREPARED requires current preparation revision to match current request revision.

If stale:

- reject transition
- require reconciliation/re-review

Revision is primary stale-write authority.

Snapshot/digest helps identify what changed.

Preferred over relying only on `updated_at`.

---

# 33. Concurrent Request Editing

While request remains NEW:

- permitted user changes may continue
- preparation work is preserved
- newer request changes do not silently overwrite preparation
- affected preparation lines require re-review
- reconciliation must happen before PREPARED

Previously approved restriction:

certain fields such as course code / technique name are frozen once active preparation begins, according to the historical business decision.

---

# 34. Business PREPARED vs Existing DB Status

Existing Medlabs DB has persisted status value:

`preparing`

Current mapping:

```text
Business state: PREPARED
Persisted DB value: preparing
```

Do not rename the existing enum/status in Phase 3 merely for terminology consistency.

Only controlled Inventory preparation logic may perform:

`new → preparing`

Planned authoritative operation:

`prepare_equipment_request_inventory(...)`

Controlled reversal:

`revert_equipment_request_inventory_preparation(...)`

Legacy generic status paths must be guarded so they cannot bypass reservation creation/release.

---

# 35. NEW → PREPARED Atomic Transaction

Before transition validate:

- request still NEW/eligible
- request revision current
- no unresolved re-review flags
- actor active Admin/Staff
- preparation lock/authority valid as required
- every required request line reviewed
- prepared quantities valid
- shortage reasons valid where needed
- not all prepared quantities zero
- catalog selections valid/active
- source locations valid
- required stock transfers complete
- sufficient quantity availability
- serialized assets fully selected
- asset lifecycle is `in_service`
- asset operational status is `ready`
- no exact asset already reserved
- no concurrent PREPARED transition already succeeded

In one database transaction:

1. lock relevant rows
2. revalidate request state/revision
3. finalize preparation attempt
4. create quantity reservations
5. increment quantity `reserved_quantity`
6. create exact asset reservations
7. do not modify quantity balance projection for exact assets
8. transition persisted `new → preparing`
9. set approved responsibility metadata
10. audit
11. enqueue approved notification/event boundary
12. commit all or rollback all

PREPARED is reservation, not stock issue/delivery.

---

# 36. PREPARED → NEW Reversal

Approved:

- release quantity reservations
- decrement quantity `reserved_quantity`
- release exact asset reservations
- preserve reservation history
- mark attempt reversed
- preserve preparation history
- restore valid request state
- audit
- notify according to approved boundary
- compensate previous stock transfers if operationally required

Never delete historical movement/reservation/preparation evidence.

---

# 37. RPC vs Server Action Boundary

Current preferred rule:

### Reads

Normal server-side query / Server Component where safe.

### UI orchestration

Server Action:

- validate input shape
- establish actor/context
- call authoritative DB operation
- map errors
- revalidate UI

### Multi-row invariants

Database transaction / PostgreSQL RPC.

Expected transaction-authoritative operations include:

- receive stock
- adjust stock
- transfer stock
- NEW → PREPARED
- PREPARED → NEW
- sensitive reference mutations where mutation + audit must be atomic

Do not simulate one transaction with independent calls such as:

```text
update balance
insert movement
insert audit
```

Audit must be part of the same database transaction/trigger/RPC where required.

---

# 38. Audit Strategy

Reuse Medlabs `audit_logs` where appropriate.

Audit important actions including:

- category/catalog changes
- supplier/provenance changes
- location changes
- receive
- adjustment
- transfer
- asset registration/change
- QR selection/rejection where meaningful
- reservation create/release
- preparation save
- PREPARED transition
- PREPARED reversal
- lock override
- serial replacement

Audit is not a substitute for:

- movement ledger
- reservation state/history
- preparation state/history

---

# 39. Notification Boundary

Approved intent:

- avoid noisy per-field notifications
- aggregate/group changes where practical
- PREPARED has a meaningful status notification

Still unresolved:

- exact batching window
- exact auto-save/manual-save trigger behavior
- detailed unanswered Q301 notification behavior

Do not invent it.

---

# 40. Roadmap

## Phase 1 — Cross-Repository Architecture Analysis

**COMPLETE**

Key outcome:

- Medlabs is canonical platform/security authority
- one shared Supabase/Medlabs architecture is feasible
- quantity stock and serialized assets remain separate concepts
- generic role/data models from references are not copied blindly

## Phase 2 v3 — Domain / Authorization / DB Contract Design

**COMPLETE**

Later explicit decisions supersede older conditional assumptions.

## Continuity / Evidence Consolidation

**COMPLETE**

Current handoff, decision history, roadmap, business requirements, and raw evidence chain exist.

## Phase 3 — Inventory Foundation

**PLANNED — IMPLEMENTATION NOT STARTED**

Seven slices.

## Phase 4 — Delivery / Return

**BUSINESS REQUIREMENTS INCOMPLETE**

Must resolve 301–360 before implementation.

## Phase 5 — Canonical Asset Integration

Staged association of existing Skills/Basic Medical physical equipment with `equipment_assets`.

No workflow merge or big-bang migration.

## Phase 6 — Equipment Lifecycle V1.1

Includes:

- repair
- formal asset transfer
- loan
- service-domain foundations as appropriate

Maintenance/calibration/inspection remain confirmed requirements.

## Phase 7 — Operational Enhancements

Potential later scope:

- service certificates
- warranty documents
- manuals/photos
- richer history
- notifications
- low-stock alerts
- service alerts
- reporting
- analytics

AI is not a foundation priority.

---

# 41. Phase 3 Seven-Slice Plan

## Slice 0 — Foundation Specification / Acceptance Freeze

Current stage.

Must freeze:

- final names/responsibilities
- table relationships
- reservation contract
- preparation contract
- RLS matrix
- RPC boundaries
- concurrency/revision contract
- migration order
- tests/acceptance criteria

No feature implementation.

## Slice 1 — Access + Catalog Foundation

- Admin/Staff gate
- categories
- catalog
- suppliers
- acquisition/provenance
- generated DB types
- RLS/security tests

No stock movement yet.

## Slice 2 — Storage + Stock Ledger

- storage locations
- balances
- immutable movements
- receive
- adjustment
- transactional audit

## Slice 3 — Stock-Location Transfer

- atomic source/destination mutation
- correlated movements
- concurrency/deadlock handling
- compensating reversal

## Slice 4 — Serialized Asset Registry

- `equipment_assets`
- `EIU-AST-XXXXXXXX`
- lifecycle
- operational status
- acquisition association
- current location
- custodian
- asset list/detail

## Slice 5 — Technical Primitives

Approved split:

**Slice 5 creates primitives.**

Includes:

- minimal preparation attempt persistence
- requirement snapshots
- allocations
- draft asset selections
- QR/code lookup
- quantity reservations
- exact asset reservations
- conflict prevention
- release primitives
- legacy status-bypass guard

Does not activate the full business workflow.

## Slice 6 — Full Preparation Business Workflow

Approved split:

**Slice 6 activates business workflow.**

Includes:

- shared preparation queue
- preparation UI
- preparation lock
- requested vs prepared handling
- shortages
- added catalog items
- source stock/location
- stock transfer prerequisite
- serialized selection
- reservation orchestration
- request revision reconciliation
- NEW → PREPARED
- PREPARED → NEW
- approved notification boundary

No delivery.

---

# 42. Corrected Slice 5 / Slice 6 Dependency

Earlier plan had a circular dependency:

- reservations depended on allocations
- allocations were originally deferred to Slice 6
- Slice 5 was supposed to deploy reservations independently

Corrected direction:

### Slice 5

Creates the minimum persisted preparation primitives required by reservation.

### Slice 6

Builds/activates the complete preparation business workflow on those primitives.

This correction is approved.

---

# 43. Request-Line Delete/Reinsert Compatibility

Existing request-edit behavior may delete/reinsert `equipment_request_items`.

Therefore:

- requirement snapshots must be immutable
- source item FK is nullable
- deletion must not cascade into preparation history
- stale mappings require reconciliation/re-review
- PREPARED rejects stale preparation

This is a critical compatibility safeguard.

---

# 44. RLS / Security Direction

Inventory access baseline:

```text
authenticated
AND active Medlabs profile
AND role in (admin, staff)
```

Admin-only restrictions include:

- master-data deactivation
- shortage reason configuration
- retire/dispose
- preparation-lock override/transfer
- terminal/config-sensitive actions

UI hiding is never authorization.

Sensitive mutations should use:

- Server Action façade
- database-authoritative transaction
- explicit grants/revokes
- RLS/private predicates
- fixed `search_path` for privileged functions where required

No generalized capability framework in V1.

---

# 45. Concurrency Strategy

Different problems use different mechanisms.

## Request revision

`equipment_requests.revision`

Primary stale-write authority.

## Preparation snapshot

Preserves historical demand and supports reconciliation.

## DB row locking

Protects:

- balances
- transfer
- reservation creation
- PREPARED transition

## Unique/partial unique constraints

Protect:

- asset code
- active exact-asset reservation
- current preparation attempt where appropriate

## UI preparation lock

Coordinates human editors only.

Not the final data-integrity authority.

---

# 46. Key Risks

High-priority risks:

1. collision with existing Skills/Basic Medical contracts
2. balance/reservation races
3. duplicate PREPARED transitions
4. stale request/preparation overwrite
5. double exact-asset reservation
6. transfer deadlocks
7. negative stock under concurrency
8. legacy status path bypassing reservation transaction
9. request-item delete/reinsert destroying preparation history
10. RLS leakage

Mitigation:

- small tracer slices
- DB constraints
- atomic RPCs
- explicit RLS
- no speculative frameworks
- no all-at-once Phase 3 implementation

---

# 47. Explicitly Rejected / Out of Scope

Do not build now:

- generic Inventory request aggregate
- Inventory Purchase Orders
- procurement approval workflow
- second personnel identity
- Nam Phong JWT/NextAuth/no-RLS architecture
- Nam Phong role taxonomy
- universal stock+asset row
- speculative V1 location grants
- big-bang Skills/Basic Medical merge
- delivery/return before requirements are resolved
- repair/formal transfer/loan in Phase 3
- maintenance/calibration/inspection workflow in initial Phase 3
- AI as foundation work

---

# 48. Unresolved Delivery Business Requirements

Still intentionally unresolved:

```text
PREPARED
   ↓
PARTIALLY_DELIVERED
   ↓
DELIVERED
   ↓
RETURN / COMPLETE
```

Unresolved subjects include:

- actual receiver
- substitute receiver
- delivery-time QR re-scan
- serial replacement at handover
- physical condition confirmation
- signature/confirmation
- partial delivery
- reserved → issued timing
- custody
- undelivered reserved quantity
- delivery reversal
- return handling
- completion semantics

Historical questions 301–360 must be explicitly answered before Phase 4 implementation.

---

# 49. Technical Details Still to Freeze in Slice 0

Product/business scope is effectively locked.

Before Slice 1 implementation, confirm exact DDL-level details for:

1. `inventory_reservations` CHECK constraints and status lifecycle
2. exact request revision increment contract
3. current-preparation-attempt uniqueness constraint
4. exact asset-code generator implementation
5. acquisition header/line FK structure
6. precise RLS/grant matrix per table
7. preparation-lock expiry/heartbeat mechanics
8. QR payload representation in Slice 5
9. final RPC/function names
10. migration dependency order

These are implementation details, not reopened product decisions.

---

# 50. Current Implementation Boundary

As of this snapshot:

**Phase 3 implementation has not started.**

Planning/documentation does not mean implementation exists.

Implementation strategy:

```text
Freeze Slice 0
    ↓
Implement Slice 1
    ↓
Verify / review
    ↓
Implement Slice 2
    ↓
...
```

Do not implement all seven slices at once.

---

# 51. Recommended Immediate Next Step

Current next action:

**complete and approve Slice 0 technical freeze**

Then authorize only:

**Slice 1 — Access + Catalog Foundation**

Before each implementation slice:

- inspect current repo state
- confirm no contract drift
- define success criteria
- implement narrowly
- run DB/security/type/application tests
- review diff
- update continuity docs if decisions change

---

# 52. Diagram-Ready Conceptual Relationships

This section is intentionally textual so it can be turned into a diagram later.

```text
Supabase Auth
    ↓
profiles
    ↓
user_roles
    ↓
active Admin / Staff
    ↓
Inventory Platform

Inventory Platform
    ├── Categories
    ├── Catalog
    ├── Suppliers
    ├── Acquisition Provenance
    ├── Storage Locations
    │
    ├── Quantity Stock
    │      ├── Balances
    │      ├── Movements
    │      ├── Receive
    │      ├── Adjustment
    │      ├── Transfer
    │      └── Quantity Reservations
    │
    └── Serialized Assets
           ├── equipment_assets
           ├── Asset Code / QR
           ├── Lifecycle
           ├── Operational Status
           └── Exact Asset Reservations
```

Request fulfillment:

```text
Existing Medlabs Equipment Request
              ↓
             NEW
              ↓
     Preparation Attempt
        ├── Requirement Snapshot
        ├── Allocation(s)
        ├── Shortage Handling
        ├── Source Location
        └── Draft Asset Selection
              ↓
      Atomic PREPARED RPC
        ├── quantity reservation
        ├── exact asset reservation
        ├── audit
        └── DB status = preparing
```

Long-term asset integration:

```text
                    equipment_assets
                         ↑       ↑
                         │       │
                 staged mapping  staged mapping
                         │       │
                  Skills domain  Basic Medical domain

Existing domain workflows/evidence remain independent.
```

---

# 53. Continuity Rule

When work resumes in a new session:

1. read `PROJECT_HANDOFF.md`
2. read `DECISION_LOG.md`
3. read `MASTER_ROADMAP.md`
4. read `INVENTORY_BUSINESS_REQUIREMENTS.md`
5. read `PHASE_3_FOUNDATION_IMPLEMENTATION_PLAN.md`
6. read only relevant historical evidence/reports
7. inspect current source/schema before implementation

Never silently reconstruct requirements from memory when evidence exists.

Never promote unanswered options to approved requirements.

Never rewrite historical evidence to make it match newer decisions.

New explicit user decisions must be reflected in current-truth/decision-history documents.

---

# 54. Current Snapshot Summary

```text
CANONICAL PLATFORM
EIU Medlabs

INVENTORY MODES
Quantity stock + serialized physical assets

CANONICAL PHYSICAL IDENTITY
equipment_assets

V1 ACCESS
Active Admin + Staff

V1 CORE
Catalog
Suppliers
Acquisition provenance
Locations
Stock ledger
Receive
Adjustment
Stock transfer
Serialized assets
QR/code lookup
Reservation
NEW → PREPARED integration

STAFF ADJUSTMENT
Allowed
Free-text reason mandatory
Audit mandatory

ASSET CODE
EIU-AST-XXXXXXXX

ASSET STATE
Lifecycle:
registered / in_service / inactive / retired / disposed

Operational:
ready / in_use / under_maintenance / damaged / prohibited

AVAILABILITY
Derived

PROCUREMENT
Out of scope

GENERIC INVENTORY REQUEST
Rejected

FORMAL ASSET REPAIR / TRANSFER / LOAN
V1.1

MAINTENANCE / CALIBRATION / INSPECTION
Confirmed future requirements

DELIVERY / RETURN
Unresolved

CURRENT PHASE
Phase 3 planning complete
Phase 3 implementation not started

NEXT
Freeze Slice 0 technical contracts
Then implement Slice 1 only
```

---

# 55. Final Authority Note

This file is a portable snapshot of the project as of 2026-08-25.

If copied outside the repo, remember that the repo may evolve after this date.

For future conflicts:

**newest explicit user-approved decision + current repository truth wins.**
