# Phase 3 — Inventory Foundation Implementation Plan

> **SUPERSEDED PLANNING BASELINE — 2026-10-02.** Retained as historical analysis, not a current implementation contract. Use [pilot reconciliation](INVENTORY_PILOT_RECONCILIATION.md), [current roadmap entry](MASTER_ROADMAP.md), and canonical `D:/orca/medlabs-OPs` designs. Forced single-source, operational delete/reinsert with nullable FK, blanket unresolved delivery, and the old slice order below are superseded. Q1–Q10/F1–F3 are settled within their scope; exact Page/DB/RPC design remains UNDER_REVIEW. No feature or migration authorization.

## 1. Status, Authority, and Scope

**Mode:** planning only. No Phase 3 implementation, schema, migration, generated-type, Auth, RLS, dependency, reference-repository, Git, or deployment change is authorized by this plan.

Authority order:

1. newest explicit approved decision in `docs/architecture/DECISION_LOG.md`;
2. current `docs/architecture/PROJECT_HANDOFF.md`;
3. `docs/business/INVENTORY_BUSINESS_REQUIREMENTS.md`;
4. `docs/architecture/MASTER_ROADMAP.md`;
5. current Medlabs implementation;
6. Phase reports as historical evidence;
7. Inventory/Nam Phong references as concepts only.

Medlabs remains canonical for App Router, Supabase, Auth, profiles, roles, RLS, server actions/RPCs, audit/outbox, generated types, tests, `WorkspaceShell`, and visual design. Do not port Nam Phong identity, JWT, tenancy, RPC-gateway, role, shell, or branding architecture.

## 2. Reconfirmed Current Implementation

### 2.1 Identity and authorization

`profiles.id` references `auth.users`; `profiles.is_active` is the active-personnel gate. `app_role` currently contains `admin`, `staff`, `lecturer`, `teaching_assistant`, `importer`, and `viewer`. Existing `private.is_active_user()` and `private.has_role()` are `SECURITY DEFINER`, fixed `search_path`, active-profile-aware helpers. Evidence: `supabase/schemas/01_app.sql:11-37,481-510`.

`getViewer()` reads claims, profile, roles, room scopes, and authority contexts. It currently has no Inventory field or navigation condition. Evidence: `lib/viewer.ts:8-102`.

### 2.2 Existing request firewall

`equipment_requests` and `equipment_request_items` are the business-demand aggregate. They have separate Skills and Basic Medical catalog links controlled by `equipment_request_domain`, immutable source identity, and domain-catalog constraints. Evidence: `supabase/schemas/25_basic_medical_equipment_request_wave_1.sql:5-122`.

Existing public request status is `new`, `preparing`, `handed_over`, `returned`, `completed`; this plan must not reuse `preparing` for the new internal preparation-progress state because approved behavior keeps the visible request state `NEW` while preparation is incomplete. Evidence: `supabase/schemas/03_registration_workflows.sql:81-108`; business evidence `LEGACY_INVENTORY_BUSINESS_PLANNING_230_360.txt:101-115,327-345`.

GitNexus confirms `updateEquipmentRequestStatus` is called by `components/equipment-request-list.tsx:changeStatus` and creates its Supabase client through `lib/supabase/server.ts`; upstream impact is two symbols at depth two, low risk. The existing request status action is therefore an explicit Slice 6 migration boundary, not a candidate for unrelated refactoring.

### 2.3 Basic Medical protection

Basic Medical owns its catalog, room inventory, confirmations, checks, and condition logs. Room inventory enforces `total_quantity = good_quantity + damaged_quantity`; evidence rows and their RLS stay domain-owned. Evidence: `supabase/migrations/20260805160000_basic_medical_room_equipment_confirmation.sql:3-104,128-211`.

### 2.4 Audit, outbox, database workflow, and UI

Reuse `audit_logs` as the generic actor/entity envelope. Reuse `email_outbox_events` only at approved event boundaries. The database is declarative: `supabase/config.toml` loads `./schemas/*.sql`; generated types come from `npm run supabase:types`; database tests use `npm run test:db`. Sources: `supabase/schemas/01_app.sql:286-301`, `supabase/schemas/10_equipment_transactional_outbox.sql`, `supabase/config.toml:59-71`, `package.json:9-32`.

New Inventory tables are absent from current schemas, app, components, lib, tests, and generated types. This confirms that Phase 3 starts with additive contracts; no material implementation change invalidates Phase 2 evidence.

## 3. Locked Boundaries

- Inventory manages both quantity stock and serialized assets.
- `equipment_assets` is future canonical physical identity, but existing Skills/Basic Medical catalogs, workflows, and evidence remain intact during initial rollout.
- V1 Inventory access is active Admin/Staff only. No `inventory_permission_grants`, room, location, lab, or department grant framework.
- No procurement workflow, purchase orders, or generic Inventory request aggregate.
- Existing Medlabs request remains business demand; Inventory owns fulfillment consequences.
- NEW means demand only. PREPARED creates quantity and exact-asset reservations, never issue movements.
- QR/code selection and stock-location transfer are V1.
- Repair/formal asset transfer/loan are V1.1. Maintenance/calibration/inspection are required future domains, not initial workflow scope.
- PREPARED → delivery/return is out of scope because 301–360 remains unanswered.

## 4. Recommended Domain Contracts

All names are proposed; Slice 0 freezes them before SQL.

| Object                                           | Responsibility                                                 | Core fields and relationships                                                                                                                                    | History/deletion rule                                                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inventory_categories`                           | Inventory classification                                       | UUID, code, name, optional parent, active, timestamps                                                                                                            | Unique normalized sibling code; inactivate when referenced.                                                                                      |
| `inventory_suppliers`                            | External provenance party                                      | UUID, name, contact, active, notes                                                                                                                               | Never a personnel table; inactivate after use.                                                                                                   |
| `inventory_catalog_items`                        | Generic stock/asset definition                                 | UUID, SKU, name, description, category, unit, tracking mode, barcode, preferred supplier, reorder threshold, active                                              | Unique normalized SKU; historical references retain the row.                                                                                     |
| `inventory_acquisition_records`                  | External acquisition/contract header                           | UUID, supplier, contract/reference identifiers/dates, funding source, notes                                                                                      | No PO state machine; correction/audit rather than destructive delete.                                                                            |
| `inventory_acquisition_record_lines`             | Acquisition item/value/warranty facts                          | UUID, acquisition record, catalog item, unit cost, quantity, manufacturer/model/origin, warranty terms                                                           | Referenced by assets and receipt movements; preserve.                                                                                            |
| `inventory_storage_locations`                    | Internal stock hierarchy                                       | UUID, code, name, type, parent, optional `rooms.id`, active                                                                                                      | Storage only; no V1 authorization scope.                                                                                                         |
| `inventory_stock_balances`                       | Transaction-maintained current quantity                        | UUID, catalog item, storage location, on_hand, reserved, timestamps/version                                                                                      | Unique item/location; no direct UI mutation.                                                                                                     |
| `inventory_stock_movements`                      | Immutable quantity ledger                                      | UUID, catalog item, signed quantity, movement type, source/destination, correlation, acquisition line/reference, actor, metadata                                 | Append only; reversal is a compensating row.                                                                                                     |
| `equipment_assets`                               | Canonical serialized physical identity                         | UUID, stable asset code, catalog item, serial, acquisition line, lifecycle, **issue condition**, location, custodian, stable facts                               | Lifecycle is sole identity state; issue condition controls V1 handover eligibility; never erase history.                                         |
| `inventory_shortage_reasons`                     | Configurable shortage reason reference data                    | UUID, stable code, display label, active, sort order                                                                                                             | Defaults: insufficient stock, currently in use, under maintenance; deactivate, do not delete referenced reasons.                                 |
| `equipment_request_preparations`                 | Immutable preparation attempt/history per existing request     | UUID, `equipment_request_id`, `attempt_no`, source digest/version, progress state, lock fields, primary preparer, timestamps                                     | Unique request/attempt; one partial-unique current attempt; PREPARED → NEW closes it as reversed and later re-preparation creates a new attempt. |
| `equipment_request_preparation_requirements`     | Reconciled prepared representation of an original request item | UUID, preparation, nullable `source_equipment_request_item_id`, immutable source-line snapshot, prepared quantity, derived shortage, reason, notes, needs-review | `source_equipment_request_item_id` uses `ON DELETE SET NULL`; preserve snapshot/history through existing request-item delete/reinsert edits.     |
| `equipment_request_preparation_allocations`      | Actual catalog item/source allocation                          | UUID, preparation, optional requirement, actual catalog item, source location, quantity, notes                                                                   | Nullable requirement denotes independent added line; each allocation has one source location.                                                    |
| `equipment_request_preparation_asset_selections` | Draft exact serial choice before PREPARED                      | UUID, allocation, asset, selected by/time                                                                                                                        | Draft selection only; transition converts it to reservation.                                                                                     |
| `inventory_reservations`                         | Quantity and exact-asset reservation history/state             | UUID, allocation, catalog item, source location, optional asset, quantity, state, created/released/consumed facts                                                | One table with structural checks; active rows reserve stock/asset.                                                                               |

No `inventory_requests`, `inventory_request_lines`, `inventory_permission_grants`, `inventory_purchase_orders`, or `inventory_purchase_order_lines` are part of Phase 3.

## 5. Catalog and Acquisition/Provenance Model

### 5.1 Catalog versus asset facts

`inventory_catalog_items` owns reusable product-definition facts: SKU, human-readable name, category, unit, tracking strategy, optional barcode, reorder threshold, and preferred supplier.

`equipment_assets` owns physical-instance facts: asset code, serial, current location/custodian, lifecycle, and asset-specific acquisition/warranty values.

Manufacturer, model, country of origin, acquisition cost, and warranty are recorded on an acquisition-record line as the normal provenance source. Catalog defaults may hold generic manufacturer/model only if reused across products; an asset may snapshot actual manufactured/acquired values where the delivered instance differs. Do not duplicate the same immutable provenance without a business reason.

### 5.2 Tracking strategy and catalog invariants

Use a constrained text/enum-like tracking strategy: `quantity`, `serialized`, or `both`.

- Quantity tracking permits stock balances/movements and does not require assets.
- Serialized tracking permits assets and asset selections; quantity balances are optional only if the business later receives serialized stock before registration.
- Both permits consumable and serialised fulfillment under one catalog definition without merging the entities.
- SKU is the stable business code, unique case/whitespace-normalized among active and historical records. Asset code is a separate stable physical identity.
- Barcode is optional lookup data, not the QR security contract.
- Catalogs and suppliers become inactive rather than deleted after reference by receipt, asset, allocation, movement, or reservation.

### 5.3 Acquisition provenance

Use header-plus-line records, not a purchase-order aggregate:

```text
inventory_acquisition_records (supplier/contract/reference/funding header)
  └── inventory_acquisition_record_lines (catalog, quantity, cost, warranty, actual manufacturer/model/origin)
        ├── equipment_assets.acquisition_record_line_id
        └── inventory_stock_movements.acquisition_record_line_id for receive rows
```

This allows one external contract/acquisition to support multiple assets and one or more stock receipts. An acquisition record never has procurement status, approval, receiving workflow, or PO lifecycle.

Indexes: normalized supplier name; catalog-item active/SKU lookup; acquisition contract/reference lookup; acquisition-line catalog lookup; warranty-end lookup only if a future service query needs it.

## 6. Location, Stock, and Movement Design

### 6.1 Storage locations

`inventory_storage_locations` models internal physical hierarchy only. Fields: UUID, parent UUID, code, name, location type, optional `room_id`, active, timestamps, creator/updater.

Constraints and indexes:

- normalized code unique within a parent; root code unique;
- parent cannot be self; recursive cycle prevention is enforced by location mutation operation, with a recursive-CTE validation;
- optional room mapping is unique only if business later requires one storage node per room; do not impose it in V1;
- indexes: parent/active/name, active/code, room, and location ID used by balances/assets.

Inactive locations remain readable with history. Block inactivation while active balance, active reservation, or in-service asset exists unless an explicit operational transfer/emptying action has resolved it. V1 locations never filter authorization.

### 6.2 Balance semantics

Select **stored reserved quantity on `inventory_stock_balances`**, transactionally maintained alongside reservation rows.

```text
on_hand_quantity   = physically held quantity
reserved_quantity  = active committed preparation quantity
available_quantity = on_hand_quantity - reserved_quantity
```

Why stored: preparation/transfer/scan validation needs O(1), lockable availability under concurrency; deriving every availability query from reservation history makes the PREPARED transition and stock transfer more expensive and race-prone. `inventory_reservations` remains the durable reservation source/history; balances are the locked operational projection. Tests assert projection parity after every reservation mutation.

Checks: all quantities integer/nonnegative; `reserved_quantity <= on_hand_quantity`; one balance per catalog/location. Direct UI insert/update/delete is forbidden.

### 6.3 Movement taxonomy

Use signed `quantity_delta`, never a mutable movement direction field:

| Type             |           Delta | Source/destination         | V1 use                                             |
| ---------------- | --------------: | -------------------------- | -------------------------------------------------- |
| `receive`        |        positive | destination required       | Receipt into stock with optional acquisition line. |
| `adjustment_in`  |        positive | destination required       | Audited correction.                                |
| `adjustment_out` |        negative | source required            | Audited correction.                                |
| `transfer_out`   |        negative | source required            | One side of stock-location transfer.               |
| `transfer_in`    |        positive | destination required       | Other correlated transfer side.                    |
| `reversal`       | signed opposite | mirrors original reference | Compensating historical correction.                |
| `issue`          |        negative | future delivery            | Reserved for Phase 4; not implemented now.         |
| `return`         |        positive | future return              | Reserved for Phase 4; not implemented now.         |

Movement fields: UUID, catalog item, quantity delta, type, source/destination location, transfer/reversal correlation UUID, optional acquisition line, external/domain reference type/id, actor profile, occurred timestamp, immutable metadata, optional balance-before/after snapshots. Index item/time, source/time, destination/time, correlation, actor/time, and reference type/id/time.

## 7. Serialized Asset and Future-Service Compatibility

`equipment_assets` fields: UUID; stable unique `asset_code`; `catalog_item_id`; normalized optional unique serial; manufacturer serial if distinct; acquisition record line; actual manufacturer/model/country facts when needed; acquisition date/value/funding snapshot; warranty start/end; current storage/install location; optional custodian profile; lifecycle; `issue_condition`; notes; timestamps.

Lifecycle is the sole identity state: `registered`, `in_service`, `inactive`, `retired`, `disposed`. There is no independent asset `active` flag. Service, repair, transfer, loan, and usage do not become lifecycle values.

`issue_condition` is orthogonal V1 serviceability with constrained values `available`, `in_use`, `under_maintenance`, `damaged`, and `prohibited`. Asset selection requires lifecycle `in_service` and issue condition `available`. Admin/Staff maintain this operational fact; later service/repair workflows become its authoritative writers. This gives QR validation a real V1 condition without adding speculative service columns.

Indexes: normalized asset code, partial normalized serial, catalog/lifecycle, issue-condition/current-location, custodian, acquisition line, warranty end. A future `equipment_service_plans` / `equipment_service_events` pair references `equipment_assets.id`; no maintenance/calibration/inspection schedule columns belong on assets.

QR uses `asset_code`, not UUID, serial, custody, cost, or authorization data. Recommended payload: a versioned opaque code such as `EIU-MEDLABS-ASSET:<asset_code>`. Lookup is authenticated server-side and only succeeds in a valid Admin/Staff preparation context. Manual asset-code entry is the equivalent fallback.

## 8. Preparation, Reservation, and Concurrency Model

### 8.1 Preparation normalization

```text
equipment_requests                         original business demand
  └── equipment_request_items              immutable requested lines
        └── equipment_request_preparation_requirements
              └── equipment_request_preparation_allocations
                    ├── equipment_request_preparation_asset_selections
                    └── inventory_reservations after PREPARED
```

`equipment_request_preparations` is an immutable attempt/history row, not one mutable row per request. It holds `attempt_no`, state (`draft`, `ready`, `prepared`, `reversed`), source digest/version, primary preparer, and durable UI edit-lock fields. A partial unique index permits exactly one current `draft`/`ready`/`prepared` attempt per request. PREPARED → NEW sets that attempt to `reversed`; a new preparation begins a later attempt, preserving the earlier fulfillment plan and audit trail.

A requirement row has an immutable requirement UUID and snapshot of its original requested item/context/quantity. Its current `source_equipment_request_item_id` is nullable with `ON DELETE SET NULL`, because current request-edit RPCs delete and reinsert `equipment_request_items`. On source edits, the reconciliation helper preserves requirement/allocation history, marks affected requirements `needs_review`, and attaches them only to a newly matched source line after explicit review. A missing current FK never deletes preparation history. Shortage is derived from the sum of linked allocations, not separately authoritative input.

An allocation is one actual active generic catalog item at one source storage location and quantity. Multiple allocations can fulfill an original requirement. An allocation without a requirement is an independent added line; it never changes original requirement shortage.

Draft serial selections reference allocations. At PREPARED, each selection must be validated and becomes a one-unit active reservation.

### 8.2 One reservation table

Use `inventory_reservations`, not separate quantity/asset tables, because both share owner allocation, state, release/consume lifecycle, audit, and transition boundary.

Fields: UUID, allocation ID, catalog item ID, source location ID, nullable asset ID, quantity, state (`active`, `released`, `consumed`), reserved_at/by, released_at/by/reason, consumed_at/by, metadata.

Checks:

- stock reservation: asset null, quantity > 0;
- asset reservation: asset non-null, quantity = 1, catalog/location match selected asset/current source rules;
- one active reservation per asset through partial unique index on asset where state = `active`;
- active reservations reserve only valid prepared allocations.

Balance projection rule: only stock reservations (`asset_id is null`) increment/decrement `inventory_stock_balances.reserved_quantity`. Exact-asset reservations rely exclusively on the asset-level partial unique active-reservation constraint and do not change any quantity balance projection.

### 8.3 Source version and preparation lock

Use two independent protections:

1. **Preparation edit lock:** durable fields on preparation header: lock holder profile, acquired_at, heartbeat_at, expires_at, transferred_by, released_at/reason. Admin may unlock or transfer; auto release follows approved completion/cancel/page-exit/timeout behavior. UI lock is advisory, not transactional authority.
2. **Source-change concurrency:** capture a canonical digest of request source fields and request-item facts when preparation saves. Extend every supported request-content mutation path to invalidate affected preparation requirements and mark `needs_review`; use a narrow additive trigger/helper only if all existing mutation paths cannot reliably call the helper. PREPARED transaction locks request, request items, preparation header/requirements, then recomputes and compares source digest before reserving.

This avoids a speculative global version framework while ensuring requester changes in NEW cannot be silently overwritten.

### 8.4 Status compatibility and bypass prevention

For Phase 3, business **PREPARED maps to the existing persisted `equipment_requests.status = 'preparing'`**. It does not map to the internal preparation-progress state; internal draft progress remains on `equipment_request_preparations` while the request persists as `new`.

Slice 6 introduces two sole status-transition operations:

- `prepare_equipment_request_inventory(...)`: the only path for `new → preparing`; it creates reservations and sets a transaction-local `app.inventory_prepared_transition` guard before changing status.
- `revert_equipment_request_inventory_preparation(...)`: the only path for `preparing → new`; it releases reservations and sets `app.inventory_prepared_reversal` before changing status.

Add `private.guard_inventory_prepared_status_transition` on `equipment_requests` for Inventory-managed requests. It rejects either transition unless the corresponding transaction-local guard is present and the preparation/reservation state is valid. Harden `public.manager_confirm_equipment_status` and every action caller so it rejects `new`/`preparing` targets; it remains only for later handover/return transitions. Slice 0 must enumerate existing direct callers and classify pre-existing `preparing` rows before enabling the guard; legacy rows are explicitly migrated/classified, never silently bypassed.

## 9. Controlled Operations

| Operation                                           | Boundary                                                                            | Reason                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Category/catalog/supplier/location/acquisition CRUD | Authenticated server action invoking one reference-data RPC, plus RLS               | The RPC performs mutation and audit in one database transaction; server action only authenticates, validates request shape, invokes RPC, and revalidates UI. |
| Receive                                             | Controlled database RPC                                                             | Locks balance; inserts movement and audit atomically.                                                                                                        |
| Adjustment                                          | Controlled database RPC                                                             | Locks balance; validates nonnegative result and reason; writes movement/audit atomically.                                                                    |
| Stock transfer                                      | Controlled database RPC                                                             | Deterministically locks two balances; writes both balances/movements/audit atomically.                                                                       |
| Asset registration/edit/lifecycle                   | Server action for simple facts; controlled RPC for any coupled state/history update | Unique asset/serial and audit requirements.                                                                                                                  |
| QR lookup/eligibility                               | Authenticated server action or `SECURITY INVOKER` read function                     | Reads a stable code and contextual availability; does not reserve.                                                                                           |
| Preparation draft save/lock                         | Controlled RPC                                                                      | Locks preparation row, writes source digest/review flags/history atomically.                                                                                 |
| NEW → PREPARED                                      | Controlled database RPC                                                             | Multi-row validation, balance locking, reservations, status, audit/outbox must commit or roll back together.                                                 |
| PREPARED → NEW                                      | Controlled database RPC                                                             | Releases reservations, preserves history, validates/coordinates compensating transfer requirement.                                                           |

### 9.1 Receive and adjustment

`receive_inventory_stock` takes catalog item, destination location, positive integer quantity, optional acquisition line/reference, note. It locks/creates the balance, increments on-hand, appends `receive`, and writes audit.

`adjust_inventory_stock` takes item, location, signed delta, approved reason, reference/note. It locks the balance, rejects `on_hand + delta < reserved` or `< 0`, applies the delta, appends `adjustment_in`/`adjustment_out`, and writes audit.

### 9.2 Stock transfer

`transfer_inventory_stock` takes catalog item, source, destination, positive quantity, reason/reference. It rejects equal locations; locks balances in ascending `(catalog_item_id, storage_location_id)` order; validates `available >= quantity`; decrements source on-hand, increments destination on-hand; appends `transfer_out` and `transfer_in` under one correlation UUID; writes audit. It never creates a separate in-transit state.

### 9.3 NEW → PREPARED transaction

The controlled operation must:

1. lock request, request items, preparation header/requirements/allocations/selections, relevant balances, selected assets, and any target reservation rows;
2. require public request status `new`, current source digest, no unresolved review flags, active Admin/Staff actor, and valid preparation lock/authority;
3. validate each original line reviewed; each prepared quantity/derived shortage; active shortage reason if shortage > 0; active catalog items; one valid source location per allocation; all transfer prerequisites complete; at least one prepared quantity > 0;
4. validate quantity `available_quantity` and exact selected assets: lifecycle `in_service`, issue condition `available`, compatible catalog, and no active conflicting asset reservation;
5. create active reservations; increment `reserved_quantity` only for quantity reservations, while exact-asset reservations rely on their active-asset uniqueness and leave balance projections unchanged;
6. set `equipment_requests.status` from `new` to the persisted PREPARED value `preparing` only through `prepare_equipment_request_inventory(...)` with `app.inventory_prepared_transition` set; direct status callers and `manager_confirm_equipment_status` cannot perform this transition;
7. set the action actor as primary operational preparer, append audit, and enqueue only the approved PREPARED event boundary;
8. commit or roll back entirely.

No issue movement occurs. PREPARED reserves; Phase 4 later converts reservation to issued.

### 9.4 PREPARED → NEW reversal

Lock request/preparation/reservations/balances. Release active reservations, decrement stored reserved balances **only for released quantity reservations**, preserve all preparation and reservation history, restore valid request workflow state from persisted `preparing` to `new` only through `revert_equipment_request_inventory_preparation(...)` with its transaction guard, mark the current preparation attempt `reversed`, restore prior primary preparer, and write audit. If related stock transfer is operationally undone, require a separate compensating transfer with new correlated movements; never edit/delete existing movement rows.

## 10. Authorization and RLS

Add narrow private helpers following `private.is_active_user()` and `private.has_role()`:

- `private.can_manage_inventory()` = active profile and role in `admin`, `staff`.
- `private.is_inventory_admin()` = active profile and `admin`.

Do not create permission-grant tables. Every Inventory table has RLS enabled and policies explicitly target authenticated users with helper predicates. `TO authenticated` alone is insufficient.

| Object group                           | SELECT                                     | Insert/update/delete                                                                                                                        | UI                                                                        |
| -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Categories/catalog/suppliers/locations | Admin/Staff                                | Reference-data RPC performs create/edit atomically with audit; Admin-only inactivation of referenced configuration                          | Staff/Admin list/manage; destructive/config-sensitive control Admin-only. |
| Acquisition records/lines              | Admin/Staff read                           | Admin reference-data RPC creates/edits/corrects atomically with audit; Staff selects existing provenance for receive                        | Admin configuration UI; Staff read/select.                                |
| Balances/movements/reservations        | Admin/Staff read                           | Direct client mutation revoked; controlled RPC only                                                                                         | Operational read history, action controls by role.                        |
| Assets                                 | Admin/Staff read                           | Admin/Staff registration/edit operation; Admin lifecycle or issue-condition sensitive operation; all coupled history/audit is transactional | Staff operational asset UI; Admin retirement/disposal controls.           |
| Shortage reasons                       | Admin/Staff read                           | Admin-only manage/inactivate                                                                                                                | Staff selection; Admin settings.                                          |
| Preparation objects/selections         | Admin/Staff read for allowed request scope | Controlled draft/transition RPC only                                                                                                        | Shared queue/preparation; Admin lock override/transfer.                   |

Existing request-domain policies remain unchanged initially. Slice 6 adds only an Inventory fulfillment path around the existing request, then verifies Skills/Basic Medical isolation.

## 11. Audit and Notification Strategy

`audit_logs` records actor, entity, before/after, and metadata for category/catalog/supplier/provenance/location changes, receive, adjustment, transfer, asset lifecycle/issue-condition changes, QR selection/rejection context, preparation saves/locks, reservation create/release, NEW → PREPARED, and reversal. Reference CRUD audit is emitted by the same database RPC/trigger transaction as its mutation, never by a second server-action write.

Domain tables remain source-of-truth for movement, reservation, preparation, and asset state; audit does not replace them.

Use `email_outbox_events` at PREPARED status transition and near-pickup warning boundary. Do not freeze manual-save/action/auto-save notification triggers or batching windows: approved intent is aggregate, non-noisy notifications; the exact trigger is unresolved.

## 12. Next.js Module Plan

| Area                                                  | Server/page/query                                                       | Action/interaction                                                               | Tests                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| `/inventory`                                          | Server page gets viewer and summary/read links through `WorkspaceShell` | No client data store                                                             | Access redirect/visibility.              |
| `/inventory/catalog`                                  | Server query categories/catalog                                         | Server actions for reference data; client form/table/dialog only for interaction | Admin/Staff behavior; inactive handling. |
| `/inventory/suppliers`                                | Server query suppliers/provenance lookup                                | Supplier/provenance actions                                                      | Role/config tests.                       |
| `/inventory/locations`                                | Server hierarchy query                                                  | Location actions, cycle/error display                                            | Hierarchy/inactivation tests.            |
| `/inventory/stock`                                    | Server balance/movement read model                                      | Receive/adjust/transfer client dialogs invoke actions/RPC wrappers               | Ledger/rollback tracer.                  |
| `/inventory/assets` and `/inventory/assets/[assetId]` | Server list/detail                                                      | Asset create/edit, code lookup; QR scanner client boundary                       | Asset uniqueness/QR eligibility.         |
| Existing equipment request detail                     | Extend existing request detail with Preparation tab                     | Draft save, lock, allocation, QR select, PREPARED/reversal actions               | NEW → PREPARED tracer.                   |

Server pages start independent viewer/data promises early and use `Promise.all`; client components receive only needed serialized DTOs; no mutable module state. Use existing Medlabs table/form/dialog visual patterns and `WorkspaceShell`; do not port TanStack Router.

## 13. Generated Types, Database Quality, and Migration Order

### 13.1 Safe workflow

1. Slice 0 finalizes contracts and acceptance criteria.
2. Edit declarative schema files only; do not begin with hand-written migration.
3. Generate/review additive migration from declarative schema workflow.
4. Reset/verify locally; run DB tests inside transactional rollback where appropriate.
5. Regenerate `lib/database.types.ts` with `npm run supabase:types` only after local contract verification.
6. Run targeted tests, `npm run typecheck`, then required broader suite at the slice boundary.

### 13.2 Quality gate

Every Phase 3 migration/change must be additive; review schema diff; reject dangerous DDL; enable RLS; establish explicit grants; fixed `search_path` for privileged functions; revoke public execute on privileged RPCs; add query-driven indexes; test `BEGIN … ROLLBACK` behavior; verify generated types; and prove no accidental Skills/Basic Medical alteration.

### 13.3 Dependency order

1. private inventory auth helpers and reference-table foundations: categories, suppliers, catalog, acquisition headers/lines, shortage reasons;
2. locations;
3. balances/movements and receive/adjust RPCs;
4. stock transfer RPC;
5. assets and code lookup;
6. preparation header/requirements/allocations/selections;
7. reservations and preparation transition/reversal RPCs;
8. App Router UI/actions in matching tracer slices.

Slices 1–4 are independently deployable. Slice 5 depends on balances/assets. Slice 6 depends on all preceding foundation contracts and existing request status compatibility verification.

## 14. Test Plan

### Database contract tests

- inactive, lecturer, teaching assistant, and viewer denied; Admin and Staff allowed where approved;
- unique SKU, category hierarchy, location cycle, active reference-data behavior;
- receive `+10`, valid adjustment, negative-stock rejection, immutable movements;
- correlated transfer, transfer rollback, deterministic concurrent balance mutation;
- unique asset code and serial semantics, tracking-mode compatibility, lifecycle validation;
- quantity reservation reduces available but not on-hand; exact asset cannot double-reserve; release restores availability; failed PREPARED leaves no reservation/balance projection change;
- original requested quantity never changes; shortage is derived; shortage reason required; independent added allocation does not reduce original shortage; stale preparation rejected;
- request-item delete/reinsert preserves preparation history, marks reconciliation required, and does not cascade-delete preparation requirements;
- direct `manager_confirm_equipment_status(new|preparing)` rejects; only guarded preparation RPCs can transition business PREPARED;
- existing Skills/Basic Medical request domains and evidence do not write generic Inventory contracts except the approved fulfillment extension.

### App and E2E tests

- Admin/Staff Inventory route/UI behavior and denied-role redirects;
- catalog, stock, transfer, and asset-code/QR eligibility tracers;
- final E2E: existing Medlabs request → preparation → stock/asset selection → reservation → persisted `preparing` / business PREPARED; no delivery.

## 15. Seven-Slice Implementation Plan

### Slice 0 — Foundation specification / acceptance freeze

- **GOAL:** Freeze exact contract/status compatibility before feature code.
- **BUSINESS REQUIREMENTS:** Both tracking branches; no PO/generic request; NEW → PREPARED only; notification ambiguity preserved.
- **SCHEMA CHANGES:** None.
- **AUTHORIZATION/RLS:** Freeze Admin/Staff predicates and direct-status guard design.
- **TRANSACTIONAL OPERATIONS:** Freeze RPC boundaries, lock order, and `new ↔ preparing` guard.
- **BACKEND/UI:** None.
- **TESTS:** GIVEN/WHEN/THEN cases, status-call inventory, fixtures, local/staging prerequisites.
- **GITNEXUS IMPACT CHECK:** `updateEquipmentRequestStatus`, request list/detail, WorkspaceShell, getViewer.
- **ROLLBACK / REVERSAL CONCERNS:** No deployment.
- **DEPENDENCIES:** Current handoff/decision/business evidence.
- **OUT OF SCOPE:** Feature implementation.
- **COMPLETION CRITERIA:** User accepts outstanding technical decisions and legacy-status classification.
- **FILES / AREAS LIKELY TO CHANGE:** This plan, OpenSpec, test fixture plan.

### Slice 1 — Access + catalog foundation

- **GOAL:** Create Admin/Staff reference-data foundation.
- **BUSINESS REQUIREMENTS:** Catalog, suppliers, acquisition provenance; no procurement.
- **SCHEMA CHANGES:** Auth helpers; categories, suppliers, catalog, acquisition headers/lines, shortage reasons.
- **AUTHORIZATION/RLS:** Admin/Staff read; Admin-only sensitive inactivation/configuration.
- **TRANSACTIONAL OPERATIONS:** Reference-data actions/audit.
- **BACKEND/UI:** Inventory shell/catalog/supplier routes and server actions.
- **TESTS:** Role matrix, uniqueness, active/inactive, provenance, generated types.
- **GITNEXUS IMPACT CHECK:** WorkspaceShell/getViewer/navigation.
- **ROLLBACK / REVERSAL CONCERNS:** Inactivate new references; no destructive cleanup.
- **DEPENDENCIES:** Slice 0.
- **OUT OF SCOPE:** Balances, assets, preparation.
- **COMPLETION CRITERIA:** Admin/Staff catalog tracer passes.
- **FILES / AREAS LIKELY TO CHANGE:** New schemas, generated migrations/types, inventory actions/routes/components/tests.

### Slice 2 — Storage + stock ledger

- **GOAL:** Prove reliable quantity stock.
- **BUSINESS REQUIREMENTS:** Locations, source stock, receive, adjustment, immutable history.
- **SCHEMA CHANGES:** Locations, balances, movements.
- **AUTHORIZATION/RLS:** Admin/Staff read; direct balance/movement writes revoked.
- **TRANSACTIONAL OPERATIONS:** Receive/adjust RPCs.
- **BACKEND/UI:** Locations/stock routes and dialogs.
- **TESTS:** Nonnegative/available invariants, immutable ledger, rollback, hierarchy.
- **GITNEXUS IMPACT CHECK:** New Inventory actions/read models.
- **ROLLBACK / REVERSAL CONCERNS:** Compensating adjustment only.
- **DEPENDENCIES:** Slice 1.
- **OUT OF SCOPE:** Transfer, assets, reservations.
- **COMPLETION CRITERIA:** Receive/adjust creates balance, movement, audit atomically.
- **FILES / AREAS LIKELY TO CHANGE:** Inventory schemas/actions/routes/components/DB tests.

### Slice 3 — Stock-location transfer

- **GOAL:** Support the preparation transfer prerequisite.
- **BUSINESS REQUIREMENTS:** Final pickup/source stock; no in-transit state.
- **SCHEMA CHANGES:** Correlation fields/index if absent.
- **AUTHORIZATION/RLS:** Admin/Staff; no location authorization boundary.
- **TRANSACTIONAL OPERATIONS:** Deterministic two-balance transfer RPC.
- **BACKEND/UI:** Transfer action in stock view.
- **TESTS:** Correlation, no negative source, deadlock-safe lock order, rollback, compensating reversal.
- **GITNEXUS IMPACT CHECK:** Stock action/read model.
- **ROLLBACK / REVERSAL CONCERNS:** New compensating transfer only.
- **DEPENDENCIES:** Slice 2.
- **OUT OF SCOPE:** Formal asset transfer/loan.
- **COMPLETION CRITERIA:** Transfer can supply a future preparation source.
- **FILES / AREAS LIKELY TO CHANGE:** Stock RPC/action/UI/tests.

### Slice 4 — Serialized asset registry

- **GOAL:** Establish canonical physical identity without legacy migration.
- **BUSINESS REQUIREMENTS:** Code/serial, provenance, lifecycle, location/custodian.
- **SCHEMA CHANGES:** `equipment_assets` with lifecycle-as-identity and orthogonal `issue_condition`, plus indexes.
- **AUTHORIZATION/RLS:** Admin/Staff register/edit and update issue condition; Admin retire/dispose.
- **TRANSACTIONAL OPERATIONS:** Registration/lifecycle/issue-condition operation where audit/history couples.
- **BACKEND/UI:** Asset list/detail/create/edit and explicit issue-condition display.
- **TESTS:** Code/serial uniqueness, lifecycle, issue-eligibility, catalog tracking, provenance.
- **GITNEXUS IMPACT CHECK:** New asset routes/types; legacy bridge excluded.
- **ROLLBACK / REVERSAL CONCERNS:** Lifecycle transition/history, not active-flag toggling; never erase asset history.
- **DEPENDENCIES:** Slices 1–2.
- **OUT OF SCOPE:** Existing catalog migration, service/repair/transfer.
- **COMPLETION CRITERIA:** Asset tracer proves inactive/maintenance/damaged assets are QR-ineligible without touching existing equipment objects.
- **FILES / AREAS LIKELY TO CHANGE:** Asset schema/actions/routes/components/tests.

### Slice 5 — QR + reservation foundation

- **GOAL:** Establish safe reservation primitives without activating full request-preparation UI.
- **BUSINESS REQUIREMENTS:** QR/code eligibility, quantity/exact-asset reservation, no double allocation.
- **SCHEMA CHANGES:** Minimal preparation header, snapshot requirement, allocation, draft selection, reservation tables; stored balance reservation quantity; guarded `new ↔ preparing` compatibility path.
- **AUTHORIZATION/RLS:** Admin/Staff; direct reservation and direct PREPARED-status writes revoked.
- **TRANSACTIONAL OPERATIONS:** QR lookup, reserve/release primitives, guarded status-transition primitives.
- **BACKEND/UI:** Asset-code input/scanner boundary and reservation read state; no request detail Preparation tab yet.
- **TESTS:** Double reservation, projection parity, release, invalid scans, delete/reinsert demand reconciliation, direct-status bypass rejection.
- **GITNEXUS IMPACT CHECK:** Asset, stock, request status action consumers.
- **ROLLBACK / REVERSAL CONCERNS:** Release reservation; no issue movement.
- **DEPENDENCIES:** Slices 2 and 4; preparation schema deploys with this slice specifically to remove reservation/allocation circularity.
- **OUT OF SCOPE:** Full preparation UI, delivery QR re-scan, issue movements.
- **COMPLETION CRITERIA:** Reservation primitives attach to persisted allocations and cannot be bypassed through legacy status action.
- **FILES / AREAS LIKELY TO CHANGE:** Reservation/preparation schemas, RPCs/actions, scanner component, request-status guards, tests.

### Slice 6 — Existing request → Inventory preparation

- **GOAL:** Activate approved NEW → PREPARED fulfillment planning on Slice 5 primitives.
- **BUSINESS REQUIREMENTS:** Original demand, progress/lock, shortages/reasons, independent lines, transfer prerequisite, QR selection, reservations, concurrency, reversal.
- **SCHEMA CHANGES:** Source-change invalidation/reconciliation wiring if not completed in Slice 5; no new reservation primitives.
- **AUTHORIZATION/RLS:** Admin/Staff queue; Admin lock unlock/transfer; existing request-domain firewall preserved.
- **TRANSACTIONAL OPERATIONS:** Draft save/lock, guarded NEW → PREPARED, guarded PREPARED → NEW.
- **BACKEND/UI:** Existing request Preparation tab, queue integration, persisted `preparing` / business PREPARED status compatibility.
- **TESTS:** Source re-review, request-item delete/reinsert reconciliation, lock expiry/override, PREPARED guards, no partial reservation, reversal transfer.
- **GITNEXUS IMPACT CHECK:** `updateEquipmentRequestStatus`, request list/detail, existing actions/RPCs, outbox processor.
- **ROLLBACK / REVERSAL CONCERNS:** Release reservations/preserve history; compensating transfer when required.
- **DEPENDENCIES:** Slices 1–5.
- **OUT OF SCOPE:** PARTIALLY_DELIVERED, DELIVERED, RETURN, issue movements, recipient signatures.
- **COMPLETION CRITERIA:** End-to-end request → preparation → reservation → persisted `preparing`/business PREPARED passes; no caller can bypass reservation create/release.
- **FILES / AREAS LIKELY TO CHANGE:** Request schemas/RPCs/actions, request detail/list UI, outbox integration, DB/app/E2E tests.

## 16. Live Supabase Verification Gate

| Stage                       | Required                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Not required for this plan  | Secrets, production connection, production row counts, deployed users, live bucket inspection.                                                                     |
| Before local implementation | Local Supabase running, declarative schema baseline/reset, fixture profiles/roles, generated types, local RLS/grants/functions, test data, schema diff.            |
| Before staging              | Staging migration version, isolated fixtures, RLS/revoked grants, generated types, migration/reversal smoke tests, outbox behavior.                                |
| Before production           | Backup/rollback plan, deployed migration history, profile/role population, collision preflight, current policies/functions/grants, deployment order, smoke checks. |

## 17. Ranked Risk Register

| Risk                                                  | Rating   | Mitigation                                                                                                         |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| Existing domain collision / accidental workflow merge | CRITICAL | Additive tables only; no legacy writes outside Slice 6 fulfillment path; isolation tests.                          |
| Balance/reservation race or double PREPARED           | CRITICAL | Row locks, stored reserved projection, partial unique asset reservation, single transition RPC, concurrency tests. |
| Stale requester/preparation overwrite                 | HIGH     | Source digest/review flags, request/preparation locks, stale transition rejection.                                 |
| Transfer deadlock or negative stock                   | HIGH     | Deterministic lock order, available validation, transaction rollback tests.                                        |
| RLS leakage or over-engineered grants                 | HIGH     | Reuse active Admin/Staff predicates; explicit policies/grants; denied-role DB tests; no V1 grant framework.        |
| Generated-type drift                                  | MEDIUM   | Regenerate only after verified local schema, run typecheck at every slice.                                         |
| Future canonical asset migration coupling             | MEDIUM   | No initial legacy migration; external/reference bridge only in Phase 5.                                            |
| Future service incompatibility                        | MEDIUM   | Asset ID/lifecycle/provenance stable now; normalized future service tables later.                                  |

## 18. Open Technical Decisions Requiring Approval

| Decision                           | Options                                                                   | Recommendation                                                                                                                                        | Blocks                 |
| ---------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Reservation quantity storage       | Stored balance projection vs derived only                                 | Store `reserved_quantity`, retain reservation rows as history/source                                                                                  | Blocks Slice 2/5.      |
| Reservation structure              | One checked shared table vs separate quantity/asset tables                | One `inventory_reservations` table with strict stock/asset checks                                                                                     | Blocks Slice 5.        |
| Preparation/reservation dependency | Reservations require allocations versus UI preparation arrives in Slice 6 | Create the minimal preparation header/requirement snapshot/allocation/selection schema in Slice 5; Slice 6 activates the full preparation UI/workflow | Blocks Slice 5.        |
| Demand-line stability              | Mandatory FK versus current request item delete/reinsert                  | Use immutable requirement snapshots with nullable `ON DELETE SET NULL` source-item reference and explicit reconciliation/re-review semantics          | Blocks Slice 5/6.      |
| Asset-code format                  | Human sequence vs random stable code                                      | Versioned opaque, non-sequential stable asset code used in QR                                                                                         | Blocks Slice 4/5.      |
| Acquisition relation               | Header only vs header+lines                                               | Header plus catalog acquisition lines                                                                                                                 | Blocks Slice 1.        |
| RPC boundary                       | All server-action writes vs transaction RPCs                              | Reference-data actions; database RPCs for multi-row invariants                                                                                        | Blocks Slice 2 onward. |
| Edit-lock persistence              | Header fields vs separate lock table                                      | Header fields plus audit-log lock history                                                                                                             | Blocks Slice 6 only.   |

## 19. Phase 3 Readiness

**READY FOR PHASE 3 IMPLEMENTATION WITH TECHNICAL DECISIONS**

Product and business decisions are locked. Slice 0 must resolve the listed technical choices before implementation starts. No production feature is authorized by this plan alone.
