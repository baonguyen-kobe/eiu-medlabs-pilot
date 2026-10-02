## 1. Executive Recommendation

Adopt an additive Inventory domain with catalog-plus-optional-serialized-asset instances:

- **NEW PROPOSED MEDLABS CONTRACT** `inventory_catalog_items` owns generic SKU/category/unit/supplier/reorder semantics.
- **NEW PROPOSED MEDLABS CONTRACT** `inventory_stock_balances` and immutable `inventory_stock_movements` own pooled stock by storage location.
- **NEW PROPOSED MEDLABS CONTRACT** `equipment_assets` owns individual code, serial, warranty, custody, installation, and lifecycle facts.

Preserve Skills and Basic Medical contracts unchanged. V1 has **NO BRIDGE** to `equipment_catalog`, `basic_medical_equipment_catalog`, `basic_medical_room_inventory`, or existing requests/evidence.

Evidence: `supabase/schemas/03_registration_workflows.sql`, `supabase/schemas/25_basic_medical_equipment_request_wave_1.sql`, `supabase/migrations/20260805160000_basic_medical_room_equipment_confirmation.sql`, `D:/orca/eiu-inventory-tracker/src/types/inventory.ts`, `D:/orca/references/qltbyt-nam-phong/src/types/database.ts`.

## 2. Three-Repository Capability Map

| Capability | IMPLEMENTED MEDLABS | REFERENCE INVENTORY | REFERENCE NAM PHONG | Conclusion |
|---|---|---|---|---|
| Catalog | Separate Skills/Basic Medical catalogs | Item/category/SKU | Equipment identity | New generic catalog; preserve existing catalogs. |
| Stock | Basic Medical room quantities | Current-stock/movements | Not pooled-stock primary model | New location balance plus ledger. |
| Suppliers | No generic supplier domain | Supplier model | Supplier/tender concepts | Generic supplier reference data. |
| Procurement | No institutional PO | PO/receipt UX | Tender configuration | Ownership unresolved. |
| Locations | Rooms/room types | Warehouse hierarchy | Department/install location | Separate physical storage from organization. |
| Asset registry | No institutional registry | Item only | Code/serial/warranty | Optional serialized registry. |
| Lifecycle | Request statuses | Item active/archive | Equipment facts | New narrow lifecycle. |
| Maintenance | No institutional module | No material model | Maintenance plans | Later. |
| Calibration | No contract | No contract | Scheduled cycles | Later. |
| Inspection | Basic Medical checks/evidence | No contract | Inspection concepts | Existing equivalent only in Basic Medical. |
| Repair | No institutional repair | No contract | Repair cases/costs | Later asset subdomain. |
| Transfer | Class handover only | Stock-location transfer | Formal transfers | Separate institutional workflow. |
| Loan | Class return only | No dedicated model | External loan | Later formal workflow. |
| Usage | Schedule/request evidence | No model | Usage logs | Later serialized-asset feature. |
| Handover/return | Signed class workflow | Fulfillment | Transfer handover | Existing workflow retained. |
| Disposal | No institutional disposal | Archive semantics | Liquidation | Later terminal asset action. |
| Requests | Existing domain requests | Generic approval | Repair/transfer requests | Generic request conditional. |
| Notifications | Email/outbox | Demo alerts | ZBS/outbox | Reuse Medlabs outbox. |
| Audit/history | Audit/condition evidence | Movement history | Lifecycle history | General and domain histories. |
| Documents | Signature bucket only | Image URL | Manuals/certificates | Later private-policy design. |
| QR | No contract | Barcode | Scanner/labels | Later product decision. |
| Analytics | No inventory analytics | Reorder engine | Equipment metrics | Later. |
| Reporting | No inventory reporting | Summary UI | Lifecycle/repair reports | Later. |

## 3. Feature Adoption Matrix

| Capability | Inventory Evidence | Medlabs Evidence | Nam Phong Evidence | Decision | Reason |
|---|---|---|---|---|---|
| Catalog | `Item` | Domain catalogs | Equipment identity | **ADOPT V1** | Foundation definition. |
| Stock | Movement demo | Basic Medical only | N/A | **ADOPT V1** | Per-location ledger integrity. |
| Suppliers | `Supplier` | No generic equivalent | Supplier references | **ADOPT V1** | Reference data. |
| Procurement | PO/receipt sheet | No PO domain | Tender workflows | **NEEDS PRODUCT DECISION** | Defer if ERP owns it. |
| Locations | Hierarchy | Rooms only | Placement/department | **ADOPT V1** | Needed for stock. |
| Asset registry | No serialized model | No asset table | Equipment code/serial | **ADOPT V1** | If serialized assets selected. |
| Lifecycle | Item status | Request status only | Asset lifecycle | **ADAPT** | Keep separate from workflows. |
| Maintenance | No material model | No module | Maintenance plans | **ADOPT LATER** | Requires assets. |
| Calibration | No model | No model | Calibration cycles | **ADOPT LATER** | Service-event type. |
| Inspection | No model | Basic Medical evidence | Inspection concepts | **ADOPT LATER** | Preserve existing evidence. |
| Repair | No model | No repair domain | Repair cases/costs | **ADOPT LATER** | Separate subdomain. |
| Transfer | Location move | No asset transfer | Transfer lifecycle | **ADOPT LATER** | Requires asset scope. |
| Loan | No model | Request return | Loan workflow | **ADOPT LATER** | Different contract. |
| Usage | No model | Schedule evidence | Usage logs | **ADOPT LATER** | Requires assets. |
| Handover/return | Fulfillment concept | Signed request flow | Handover | **MEDLABS ALREADY HAS EQUIVALENT** | Preserve its ownership. |
| Disposal | Archive | No disposal | Liquidation | **ADOPT LATER** | Terminal asset action. |
| Requests | Approval/partial fulfillment | Existing isolated requests | Workflow requests | **ADOPT V1.1** | Conditional generic issuance. |
| Notifications | Demo alerts | Outbox/email | ZBS | **MEDLABS ALREADY HAS EQUIVALENT** | Reuse outbox. |
| Audit/history | Movements | Audit/evidence | Lifecycle histories | **MEDLABS ALREADY HAS EQUIVALENT** | Add semantic domain history. |
| Documents | Image URL | Signatures only | Certificates/manuals | **ADOPT LATER** | Needs private policy. |
| QR | Barcode | No QR | Scanner/labels | **NEEDS PRODUCT DECISION** | Security/workflow choice. |
| Analytics | Reorder engine | No inventory analytics | Equipment analytics | **ADOPT LATER** | Needs real ledger data. |
| Reporting | Summary UI | No inventory report | Equipment reports | **ADOPT LATER** | Requires stable product scope. |

## 4. Stock Item vs Equipment Asset Decision

Select **catalog plus optional serialized asset instance**.

- Reject one universal table: quantity/reorder and serial/warranty/custody/lifecycle have incompatible invariants.
- Reject duplicate unrelated generic stock and equipment catalogs.
- Keep existing Skills and Basic Medical catalogs untouched.
- **NEW PROPOSED MEDLABS CONTRACT** `inventory_catalog_items` supports `stock`, `serialized`, and `both` tracking modes.
- **NEW PROPOSED MEDLABS CONTRACT** `equipment_assets` links only to a serialized-capable catalog item.

Evidence: `src/types/inventory.ts:59-79` and `src/types/database.ts:1-46`.

## 5. Inventory / Equipment Domain Boundary

| Domain | Owns |
|---|---|
| Generic Inventory | New catalog, suppliers, locations, balances, movements, optional institutional assets. |
| Skills | Existing catalog/request workflow tied to class schedules. |
| Basic Medical inventory | Existing catalog and room quantities. |
| Basic Medical evidence | Existing confirmations, checks, and condition logs. |
| Institutional assets | New asset registry and later lifecycle workflows. |

Generic Inventory never decrements, reconciles, or aliases Skills/Basic Medical quantities. Existing workflows never write Inventory tables.

## 6. Medlabs Equipment Domain Firewall

| Domain | Source of truth | Catalog | Physical stock | Workflow | Forbidden writer | Evidence/audit |
|---|---|---|---|---|---|---|
| Skills | Existing tables | `equipment_catalog` | No institutional contract | `equipment_requests` | New Inventory | requests/outbox/audit |
| Basic Medical | Existing tables | `basic_medical_equipment_catalog` | `basic_medical_room_inventory` | registration/session/request | New Inventory | confirmations/checks/logs |
| Generic Inventory | **NEW PROPOSED MEDLABS CONTRACT** | `inventory_catalog_items` | balances/movements | inventory actions | Skills/Basic Medical | ledger/audit |
| Institutional assets | **NEW PROPOSED MEDLABS CONTRACT** | Generic catalog linkage | Not inferred from asset count | lifecycle/later workflows | Existing requests | asset events/audit |

V1 bridge: **NO BRIDGE**. A later read-only external/reference-code bridge requires proof that the same physical asset is shared.

## 7. Equipment Lifecycle Recommendation

Asset lifecycle:

```text
registered → in_service → inactive → retired → disposed
```

Commissioning, in-service, and decommission dates are facts.

| Orthogonal workflow | States |
|---|---|
| Repair | `reported`, `approved`, `in_progress`, `completed`, `not_repairable`, `cancelled` |
| Service | `scheduled`, `in_progress`, `completed`, `cancelled` |
| Transfer/loan | `requested`, `approved`, `handed_over`, `returned` or `completed`, `cancelled` |
| Usage | Open/closed session |

Evidence: Nam Phong’s separate Equipment, TransferRequest, and UsageLog concepts in `src/types/database.ts`.

## 8. Maintenance / Calibration / Inspection Decision

| Capability | Decision | Concept |
|---|---|---|
| Maintenance | **ADOPT LATER** | Normalized service plans/events. |
| Calibration | **ADOPT LATER** | `service_type = calibration`. |
| Inspection | **ADOPT LATER** | `service_type = inspection`. |
| Basic Medical checks | **MEDLABS ALREADY HAS EQUIVALENT** | Existing owning evidence only. |

Do not adopt 12 monthly columns. Compute due/overdue from dates. Evidence: Nam Phong `MaintenanceTask` in `src/types/database.ts:235-281`.

## 9. Repair Domain Decision

Repair is an **ADOPT LATER** Equipment subdomain:

- one case per asset;
- reporter, description, approval, provider, desired completion, result, cost, failure reason, completion facts;
- repair state independent from lifecycle;
- complete repair updates case, affected asset facts, semantic history, and audit atomically.

Nam Phong repair behavior is a domain reference; its tenant/JWT/RPC platform is **REFERENCE ONLY**. Evidence: `openspec/specs/repair-request-cost-statistics/spec.md`.

## 10. Transfer / Loan / Handover Decision

| Workflow | Decision |
|---|---|
| Existing Skills/Basic Medical handover-return | **MEDLABS ALREADY HAS EQUIVALENT** |
| Internal institutional asset transfer | **ADOPT LATER** |
| External transfer / loan | **ADOPT LATER** |
| Repair-related transfer | **ADOPT LATER** |
| Disposal | **ADOPT LATER** |

Class request states in `supabase/schemas/03_registration_workflows.sql:81-108` are not asset-transfer states.

## 11. Usage & QR Decision

| Capability | Decision | Rule |
|---|---|---|
| Usage history | **ADOPT LATER** | Asset/user/start/end/condition notes; one open session per asset. |
| QR | **ADOPT LATER** | Only after identification/product decision. |
| QR payload | Opaque token/URL or stable equipment code | Do not expose sensitive data. |
| Catalog barcode | **ADAPT** | Lookup attribute, not asset identity. |

## 12. Inventory/Equipment V1 Scope

| Classification | Scope |
|---|---|
| MUST HAVE V1 | Permissions, categories, catalog, suppliers, locations, immutable ledger, balances. |
| MUST HAVE V1 if assets selected | Asset registry, lifecycle, installation, custodian. |
| V1.1 | Generic requests, purchase orders, low-stock notifications. |
| LATER | QR, transfer/loan, service, repair, usage, documents, analytics, reporting. |
| OUT OF SCOPE | Nam Phong tenancy/roles/NextAuth/JWT/tender/quota architecture. |

## 13. Proposed Core Domain Model

| Entity | Responsibility | History/deletion rule |
|---|---|---|
| Catalog item/category/supplier | Generic reference data | Inactivate after references exist. |
| Storage location | Physical hierarchy | Inactivate; no delete after balances/assets. |
| Stock balance | Current quantity by item/location | Controlled-operation maintained. |
| Stock movement | Quantitative ledger | Append-only. |
| Equipment asset | Serialized instance | Retire/dispose; never erase identity/history. |
| Request/PO | Conditional V1.1 workflow roots | Preserve cancellation/history. |
| Service/repair/transfer/usage | Later workflows | Preserve domain history. |
| Asset event/document | Later evidence/history | Append/private retention. |

## 14. Organization / Location Model

Separate:

1. physical storage hierarchy;
2. organizational ownership/resource scope;
3. asset installation location;
4. personnel custody.

**NEW PROPOSED MEDLABS CONTRACT** `inventory_storage_locations` may map to `rooms.id`; a room mapping is not organization, custody, or full hierarchy. Evidence: `supabase/schemas/01_app.sql`, `supabase/schemas/02_room_type_scopes.sql`, `src/types/inventory.ts:81-93`.

## 15. Personnel Responsibility Model

| Responsibility | Contract |
|---|---|
| Requester, approver, custodian | `profiles.id`. |
| Technician/performer | Internal `profiles.id`; external provider/supplier snapshot. |
| Stock actor | Authenticated `profiles.id`, movement/audit actor. |
| Supplier/provider | External record, never second personnel table. |

`profiles.id` and `profiles.is_active` remain canonical. Source: `supabase/schemas/01_app.sql:19-29,481-494`.

## 16. Permission Matrix

| Capability | Operation | Scope | Enforcement | UI |
|---|---|---|---|---|
| `inventory.view` | Read module data | Module/resource/location | Active profile + RLS scope | Navigation/read views |
| `inventory.catalog.manage` | Categories/catalog/suppliers/**locations** | Module plus parent/room/resource scope | Active profile + RLS/server-action scope validation | Create/edit/inactivate catalog/supplier/location |
| `inventory.stock.receive` | Receive | Destination location | Controlled transaction | Receive |
| `inventory.stock.adjust` | Adjust | Location | Reason-bearing transaction | Adjust |
| `inventory.stock.transfer` | Transfer | Source/destination | Both scopes required | Transfer |
| `inventory.requests.create` | Create request | Own scope | Scoped action | Request form |
| `inventory.requests.review` | Review/fulfill | Queue scope | Locked fulfillment | Review |
| `inventory.procurement.manage` | PO/receipt | Procurement scope | Conditional V1.1 | PO |
| `equipment.assets.manage` | Asset registration/lifecycle | Asset/location scope | Scoped action | Asset controls |
| `equipment.service.manage` | Service | Asset scope | Later operation | Service |
| `equipment.repair.manage` | Repair | Asset scope | Later operation | Repair |
| `equipment.transfer.manage` | Transfer/loan | Asset/source/destination | Both scopes required | Transfer |

Location authority is `inventory.catalog.manage`; no new location permission code exists.

## 17. Proposed Database Contract

**Defaults that apply to every row:** UUID PK generated by the database; `created_at`; actor-aware audit through implemented `audit_logs`; exposed tables enable RLS; all reads require active `profiles` identity and relevant scoped module permission; all mutable changes use authenticated Medlabs server actions or a controlled transactional operation; hard deletion is disallowed after business history exists.

| Table | Purpose / important fields / valid FKs | Ownership / query-driven indexes | RLS intent / mutation / audit / deletion behavior |
|---|---|---|---|
| **NEW PROPOSED MEDLABS CONTRACT** `inventory_permission_grants` | Permission code, `profile_id`, scope type/id, validity, grantor. FK: `profile_id → profiles`; grantor → `profiles`. | Inventory authorization; unique profile/code/scope; profile/code/active indexes. | Authority-pattern read/write only; grant/revoke server action; every grant/revocation audited; revoke/inactivate, do not erase used grants. |
| **NEW PROPOSED MEDLABS CONTRACT** `inventory_categories` | Name, optional `parent_id`, description, active. FK: parent self-reference. | Inventory reference data; normalized sibling-name and parent indexes. | `inventory.view` read, `inventory.catalog.manage` writes; catalog action; audit create/edit/inactivate; no delete while catalog items reference it. |
| **NEW PROPOSED MEDLABS CONTRACT** `inventory_catalog_items` | SKU, name, unit, `category_id`, tracking mode, reorder fields, `preferred_supplier_id`, active. FKs: category/supplier. | Inventory catalog; normalized unique SKU; active/category/supplier/search indexes. | View scoped read, catalog-manage action; audit mutation; inactivate rather than delete after movement, asset, request, or PO reference. |
| **NEW PROPOSED MEDLABS CONTRACT** `inventory_suppliers` | Name, contacts, lead time, notes, active; no personnel FK. | Inventory reference data; normalized active-name index. | View read, catalog-manage action; audit mutation; inactivate when catalog/PO referenced. |
| **NEW PROPOSED MEDLABS CONTRACT** `inventory_storage_locations` | Name/code, type, `parent_id`, optional `room_id`, active. FKs: parent self-reference; `room_id → rooms`. | Inventory physical storage; normalized sibling code/name, parent, room, active indexes. | `inventory.view` scoped read; `inventory.catalog.manage` write only if active grant covers target parent and mapped room/resource. Server action validates hierarchy, room, root/reparent old/new scopes; audits mutation; never delete if balances/assets reference it, otherwise inactivate. |
| **NEW PROPOSED MEDLABS CONTRACT** `inventory_stock_balances` | `catalog_item_id`, `storage_location_id`, on-hand quantity, version/timestamps. FKs: catalog/location. | Inventory operational projection; unique catalog/location; item/location and low-balance indexes. | Scoped view read; no direct insert/update/delete. Controlled receive/adjust/transfer maintains it and writes audit; deletion never direct. |
| **NEW PROPOSED MEDLABS CONTRACT** `inventory_stock_movements` | Item, signed quantity, type, source/destination location, correlation/reference, `actor_id`, immutable time. FKs: catalog, locations, actor profile. | Inventory ledger; item/time, location/time, correlation, actor/time indexes. | Scoped read; controlled append-only transaction; audit transaction; update/delete prohibited permanently. |
| **NEW PROPOSED MEDLABS CONTRACT** `equipment_assets` | Catalog item, equipment code, optional serial, lifecycle, acquisition/warranty, installed location, custodian. FKs: catalog, location, custodian `profiles`. | Institutional asset registry; unique code, partial unique serial, catalog/lifecycle/location/custodian indexes. | Asset-scoped read; `equipment.assets.manage` action; audit registration/fact/lifecycle writes; retire/dispose/inactivate, never hard-delete after any history. |
| **NEW PROPOSED MEDLABS CONTRACT** `inventory_requests` | Number, requester, target resource/location snapshot, status, priority, reason, reviewer facts. FKs: requester/reviewer → `profiles`; optional target location. | Conditional inventory workflow; number unique, requester/status/review-queue indexes. | Own/scoped-review read; create/review actions require request permissions; audit every transition; cancel/inactivate rather than delete after lines/review exist. |
| **NEW PROPOSED MEDLABS CONTRACT** `inventory_request_lines` | Request, catalog item, requested/approved/fulfilled quantities, note. FKs: request, catalog. | Conditional request detail; request/item unique-or-indexed per chosen line aggregation, request and item indexes. | Parent-visibility RLS; create/edit through request action, fulfillment through locked operation; audit parent fulfillment; no direct delete after fulfillment, cancel/retain line facts. |
| **NEW PROPOSED MEDLABS CONTRACT** `inventory_purchase_orders` | Number, supplier, status, expected delivery, creator, notes. FKs: supplier; creator → `profiles`. | Conditional procurement; number unique, supplier/status/creator indexes. | Procurement-scoped read/write; PO server action, receipt operation; audit status/receipt; cancel rather than delete after lines or receipt. |
| **NEW PROPOSED MEDLABS CONTRACT** `inventory_purchase_order_lines` | PO, catalog item, ordered/received quantities, unit-cost snapshot. FKs: PO, catalog. | Conditional PO detail; PO/item indexes, optional unique PO/item. | Parent-visibility RLS; PO action creates/edits draft lines, receipt transaction changes received quantities; audit receipt through PO envelope; no delete after any receipt. |
| **NEW PROPOSED MEDLABS CONTRACT** `equipment_service_plans` | Asset, service type, interval/next-due facts, active, responsible profile/provider snapshot. FKs: asset; optional profile. | Equipment service planning; asset/service-type/next-due/active indexes. | Asset/service-scoped read; `equipment.service.manage` action; audit plan changes; inactivate/revise instead of deleting plans with events. |
| **NEW PROPOSED MEDLABS CONTRACT** `equipment_service_events` | Plan/asset, service type, state, scheduled/completed dates, performer, result. FKs: plan, asset, optional performer profile. | Equipment service history; asset/date/state and plan/date indexes. | Scoped read; service operation creates/completes/cancels; audit completion; completed/cancelled events immutable, never delete. |
| **NEW PROPOSED MEDLABS CONTRACT** `equipment_repair_cases` | Asset, reporter, state, description, priority, provider/cost, approval/completion facts. FKs: asset; reporter/approver/performer → `profiles` where internal. | Equipment repair; asset/active-state, reporter/time, due-date indexes. | Repair-scoped read; `equipment.repair.manage` state operation; audit every state/fact mutation; never delete after report, cancel/close with history. |
| **NEW PROPOSED MEDLABS CONTRACT** `equipment_transfer_cases` | Asset, source/destination locations or external snapshot, requester/approver/custodian, state, handover/return facts. FKs: asset, locations, internal profiles. | Equipment transfer; asset/state, correlation, source/destination, due-return indexes. | Transfer-scoped read; `equipment.transfer.manage` controlled transition; audit handover/return; completed/cancelled cases retained, never deleted. |
| **NEW PROPOSED MEDLABS CONTRACT** `equipment_usage_sessions` | Asset, user, start/end, initial/final condition, notes, state. FKs: asset; user/actor → `profiles`. | Equipment usage; asset/open-session partial unique index, user/time indexes. | Asset/use-scoped read; controlled start/end operation; audit start/end; completed sessions immutable, no hard delete. |
| **NEW PROPOSED MEDLABS CONTRACT** `equipment_documents` | Owning asset/domain record, document class, private storage key, retention metadata, uploader. FKs: optional asset; uploader → `profiles`; domain owner must be valid by document class. | Equipment document metadata; owner/type, storage key, retention indexes. | Private owner/domain RLS; controlled upload metadata action; audit upload/access/deletion decisions; logical removal/retention hold, never unmanaged object deletion. |
| **NEW PROPOSED MEDLABS CONTRACT** `equipment_asset_events` | Asset, event type, actor, event time, facts snapshot. FKs: asset; actor → `profiles`. | Equipment semantic history; asset/time and event-type/time indexes. | Asset-scoped read; only lifecycle/service/repair/transfer/disposal operations append events; audit enclosing operation; append-only, no update/delete. |

Do not replace `profiles`, `user_roles`, `app_role`, `equipment_catalog`, or `basic_medical_*`.

## 18. RLS / Security Matrix

| Class | SELECT | INSERT/UPDATE | DELETE |
|---|---|---|---|
| Permission grants | Scoped authority | Existing authority pattern | Revoke/inactivate |
| Category/catalog/supplier | `inventory.view` | `inventory.catalog.manage` server action/RLS | Preserve referenced history |
| Location | `inventory.view` hierarchy scope | `inventory.catalog.manage`, active profile, parent/room/resource `WITH CHECK`; server validates reparent/root scope | Deny if balances/assets; otherwise inactivate |
| Balance | Scoped read | Controlled stock operation only | Never direct |
| Movement | Scoped read | Controlled append only | Never |
| Asset | Scoped read | Asset manager/controlled lifecycle action | No hard delete after history |
| Request/PO | Own/operational scope | Scoped action/RPC | Cancel/retain history |
| Later workflows | Scoped read | Controlled transition | Retain history |

## 19. Transaction Boundaries

| Operation | Atomic invariant |
|---|---|
| Receive | Balance delta, movement, and audit commit or roll back together. |
| Adjust | Nonnegative balance, reason-bearing movement, and audit together. |
| Transfer | Source debit, destination credit, correlated movements, and audit together. |
| PO receipt | Line receipt, PO state, balance, movement, and audit together. |
| Request fulfillment | Availability lock, issued movement, line/status update, and audit together. |
| Asset registration | Tracking validation, unique code/serial, and audit together; no implicit stock change. |
| Asset transfer | Case state, location/custody, event, and audit together. |
| Service/repair completion | State, asset facts, event, and audit together. |
| Disposal | Terminal lifecycle, disposal facts, event, and audit together. |

## 20. Audit / History Strategy

Use both:

- **IMPLEMENTED MEDLABS** `audit_logs` is the actor/entity envelope. Source: `supabase/schemas/01_app.sql:286-301`.
- **NEW PROPOSED MEDLABS CONTRACT** `inventory_stock_movements` is immutable quantitative history.
- **NEW PROPOSED MEDLABS CONTRACT** `equipment_asset_events` is semantic lifecycle history.
- Existing Basic Medical confirmations/checks/condition logs remain their own authoritative evidence.

## 21. Notifications / Outbox

Reuse **IMPLEMENTED MEDLABS** `email_outbox_events`.

| Event | Classification |
|---|---|
| Low stock/request review | **ADOPT V1.1** |
| PO receipt | **ADOPT V1.1** if procurement approved |
| Maintenance/calibration/inspection due | **ADOPT LATER** |
| Repair/transfer updates | **ADOPT LATER** |
| New channel architecture | **DO NOT ADOPT** |

Evidence: `supabase/schemas/10_equipment_transactional_outbox.sql`.

## 22. Storage / Documents

Do not reuse `equipment_signatures` as a generic bucket.

Later policy must define private ownership, auditability, retention, content validation, and deletion/hold rules for photos/manuals, purchase/warranty documents, service certificates, repair records, and transfer signatures. Evidence: `supabase/migrations/20260807210000_complete_hardening_phases_1_to_5.sql`.

## 23. Next.js Module Structure

| Release | Routes |
|---|---|
| V1 | `/inventory`, `/inventory/catalog`, `/inventory/stock`, `/inventory/assets`, `/inventory/assets/[assetId]`, `/inventory/locations`, `/inventory/suppliers` |
| V1.1 | `/inventory/requests`, `/inventory/purchase-orders` |
| Later | `/inventory/maintenance`, `/inventory/repairs`, `/inventory/transfers`, `/inventory/reports` |

Use App Router, `WorkspaceShell`, `getViewer`, server Supabase clients/actions, generated `lib/database.types.ts`, RLS, and the Medlabs design system. Sources: `components/workspace-shell.tsx`, `lib/viewer.ts`, `docs/UI_DESIGN_SYSTEM_V2_MASTER.md`.

## 24. Reference UI Adoption Matrix

| Reference concept | Decision | Medlabs action |
|---|---|---|
| Catalog tables/filters | **ADAPT UX** | Rewrite with Medlabs patterns and permissions. |
| Stock/movement view | **PORT CONCEPT** | Location balances plus immutable ledger. |
| PO receipt sheet | **ADAPT UX** | Bounded quantities, one transaction. |
| Partial request fulfillment | **PORT CONCEPT** | Conditional V1.1 locked operation. |
| Asset detail/history | **PORT CONCEPT** | Rewrite with Medlabs shell/RLS. |
| Maintenance/repair/transfer/QR screens | **REFERENCE ONLY** | Later reference; no architecture port. |
| TanStack Router/Nam Phong shell | **DO NOT PORT** | Medlabs App Router/WorkspaceShell. |
| Reference branding/auth shell | **DO NOT PORT** | Medlabs authority. |

## 25. DemoStore Replacement Map

| Current operation | Future contract | Permission / transaction | Test |
|---|---|---|---|
| `useItems` / `useItemById` | Catalog plus scoped balance read | `inventory.view`, RLS | Visibility/inactivation |
| Item CRUD | Catalog action | `inventory.catalog.manage` | SKU uniqueness/inactivation |
| `useCreateMovement` | Receive/adjust/transfer | Scoped controlled operation | Atomic rollback |
| Supplier mutation | Supplier action | `inventory.catalog.manage` | Scope denial |
| Location mutation | Location action | `inventory.catalog.manage`; active profile; target parent/mapped-room scope; audited action | Unauthorized create/reparent/inactivate denial |
| PO receipt | Receipt operation | Procurement + receive | Status/balance/movement/audit atomicity |
| Request approval | Locked fulfillment | Review permission | No over-issue/partial status |

Outside demo mode, reference hooks return empty data or “Not in demo mode.” Sources: `D:/orca/eiu-inventory-tracker/src/hooks/useInventoryData.ts`, `src/hooks/useInventoryMutations.ts`.

## 26. Nam Phong Engineering Practices Worth Adopting

| Classification | Practice |
|---|---|
| **ADOPT** | Dangerous-DDL detection. |
| **ADOPT** | Safe generated-type validation before atomic write. |
| **ADOPT** | `BEGIN … ROLLBACK` transactional smoke tests. |
| **ADOPT** | GIVEN/WHEN/THEN acceptance criteria. |
| **ADAPT** | Migration header/transaction/search-path/grant/source-order checks. |
| **ADAPT** | Baseline tracking for legacy hygiene debt. |
| **DO NOT ADOPT** | Mandatory push hooks, NextAuth/custom JWT, RPC proxy, AgentMemory/context-mode. |

Evidence: `scripts/db-quality-gate/static-policy.ts`, `scripts/db-quality-gate/static-policy-dangerous.ts`, `scripts/gen-types.js`, and `openspec/specs/repair-request-cost-statistics/spec.md`.

## 27. Test / Quality Gate Matrix

| Gate | Required checks |
|---|---|
| FOUNDATION GATE | FKs/unique/checks; active-profile/permission RLS; no access leakage; generated types; existing Medlabs equipment objects unchanged. |
| V1 GATE | SKU/equipment-code uniqueness; inactivation; nonnegative stock; immutable movements; receive/adjust/transfer rollback; lifecycle; audit; authorization; UI visibility; App Router tracer. |
| LATER | Service due/event rules; repair/transfer transitions; irreversible disposal; usage overlap; document access; notification dedupe; reporting scope. |

Required proof: receive 10 atomically; register two assets without stock changes; unauthorized active profile denied; existing requests isolated; failed transfer leaves no balance/history effects.

## 28. Ordered Implementation Slices

### Slice 0 — Product-decision freeze
- **GOAL:** Resolve stock/asset branch, scope, ERP ownership, bridge policy.
- **DOMAIN CONTRACT:** Decisions only.
- **SCHEMA:** None.
- **AUTHORIZATION:** No broad authenticated access.
- **BACKEND:** None.
- **UI:** No production navigation.
- **TESTS:** Decision review.
- **GITNEXUS IMPACT CHECK:** `WorkspaceShell`, `getViewer`, equipment consumers.
- **COMPLETION CRITERIA:** Foundation scope authorized.

### Slice 1 — Permission plus catalog tracer
- **GOAL:** Prove module boundary.
- **DOMAIN CONTRACT:** Grants/categories/catalog/suppliers.
- **SCHEMA:** Corresponding V1 tables.
- **AUTHORIZATION:** Active profile plus view/catalog grants.
- **BACKEND:** Scoped audited server actions.
- **UI:** Inventory/catalog/supplier routes.
- **TESTS:** RLS, SKU uniqueness, inactivation, authorization.
- **GITNEXUS IMPACT CHECK:** Navigation/viewer/types.
- **COMPLETION CRITERIA:** Tracer passes; existing equipment unchanged.

### Slice 2 — Location plus receive/adjust ledger
- **GOAL:** Prove pooled-stock integrity.
- **DOMAIN CONTRACT:** Location/balance/movement.
- **SCHEMA:** Corresponding V1 tables.
- **AUTHORIZATION:** Catalog manage for locations; receive/adjust for stock.
- **BACKEND:** Hierarchy/room scope-validating location action; locked stock operations.
- **UI:** Locations/stock routes.
- **TESTS:** Scope denial, nonnegative stock, immutable ledger, rollback.
- **GITNEXUS IMPACT CHECK:** Stock actions/read models.
- **COMPLETION CRITERIA:** Receive-10 proof passes.

### Slice 3 — Serialized asset registry/detail
- **GOAL:** Prove serialized branch.
- **DOMAIN CONTRACT:** Catalog tracking plus assets.
- **SCHEMA:** `equipment_assets`.
- **AUTHORIZATION:** Asset manager.
- **BACKEND:** Registration/lifecycle actions and audit.
- **UI:** Asset list/detail.
- **TESTS:** Code/serial uniqueness, no stock side effect.
- **GITNEXUS IMPACT CHECK:** Asset consumers.
- **COMPLETION CRITERIA:** Two-asset proof passes.

### Slice 4 — Stock transfer
- **GOAL:** Prove two-location transfer.
- **DOMAIN CONTRACT:** Correlated debit/credit.
- **SCHEMA:** Existing ledger tables.
- **AUTHORIZATION:** Transfer authority at both locations.
- **BACKEND:** Deterministically locked transaction.
- **UI:** Transfer action.
- **TESTS:** Correlation, nonnegative source, rollback.
- **GITNEXUS IMPACT CHECK:** Stock flow consumers.
- **COMPLETION CRITERIA:** Failed-transfer proof passes.

### Slice 5 — Approved procurement or request workflow
- **GOAL:** Add one approved V1.1 workflow.
- **DOMAIN CONTRACT:** PO or generic request, not both by default.
- **SCHEMA:** Only corresponding conditional tables.
- **AUTHORIZATION:** Procurement or request permission.
- **BACKEND:** Single receipt/fulfillment transaction.
- **UI:** Corresponding route.
- **TESTS:** Status/balance/movement/audit atomicity.
- **GITNEXUS IMPACT CHECK:** Route/action/navigation.
- **COMPLETION CRITERIA:** Product-approved contract tests pass.

### Slice 6 — Approved lifecycle extension
- **GOAL:** Add one later workflow.
- **DOMAIN CONTRACT:** Service, repair, transfer, usage, disposal, QR, or documents.
- **SCHEMA:** Only extension tables.
- **AUTHORIZATION:** Matching scoped permission.
- **BACKEND:** Controlled transition/history.
- **UI:** Matching route.
- **TESTS:** State/invariant/access behavior.
- **GITNEXUS IMPACT CHECK:** Asset/navigation consumers.
- **COMPLETION CRITERIA:** Changed-contract tests pass.

## 29. Live Supabase Verification Gate

| Gate | Required checks |
|---|---|
| NOT NEEDED FOR DESIGN | Secrets, production connection, rows, deployed users, live storage inspection. |
| BEFORE LOCAL/STAGING | Migration list, schema diff, generated types, local RLS/policies, fixtures, storage/config prerequisites, external stubs. |
| BEFORE PRODUCTION | Deployed migration version, backup/rollback, profile/role/grant populations, collision preflight, RLS/grants/functions, environment/storage/external state, additive order, post-deploy smoke tests. |

## 30. Remaining Product Decisions

1. Pooled stock, serialized assets, or both?
2. Institution/lab/department/combined resource scope?
3. Which parent/room/resource scopes govern location creation and `inventory.catalog.manage`?
4. Does Medlabs own procurement?
5. Is generic request approval required?
6. Which later lifecycle workflow is first priority?
7. Do existing Skills/Basic Medical records represent the same physical institutional asset?

## 31. Phase 3 Readiness Verdict

Repository evidence supports the additive foundation tracer after product decisions resolve scope and procurement ownership; it does not prove live Supabase state.

Mechanical validation confirmed 23 distinct required capability rows in both matrices. Final read-only worktree status:

| Repository | Status |
|---|---|
| `D:\orca\eiu-medlabs` | `?? .omp/` pre-existing/untracked |
| `D:\orca\eiu-inventory-tracker` | `M src/routeTree.gen.ts`, `?? .omp/` pre-existing/untracked |
| `D:\orca\references\qltbyt-nam-phong` | clean |

No source, SQL, `.omp`, Git, dependency, Supabase, or database mutation occurred during analysis.

## 32. Recommended Phase 3 Scope

Implement only after decision freeze:

1. permission/category/catalog/supplier tracer;
2. location management under `inventory.catalog.manage`, including active-profile, parent/room/resource scope, RLS, audited server action, and UI rules;
3. receive/adjust ledger;
4. serialized assets only if selected;
5. stock transfer after ledger proof.

Defer bridges, procurement, generic requests, notifications, QR, service, repair, formal transfer/loan, usage, documents, analytics, and reporting until separately approved.

READY FOR PHASE 3 WITH PRODUCT DECISIONS

---

# POST-REPORT PRODUCT DECISIONS

This Phase 2 v3 report records the architecture analysis as completed at that time.

Later explicit user-approved product decisions supersede some conditional assumptions in this report.

Current project truth is maintained in:

- `docs/architecture/PROJECT_HANDOFF.md`
- `docs/architecture/DECISION_LOG.md`
- `docs/architecture/MASTER_ROADMAP.md`
- `docs/business/INVENTORY_BUSINESS_REQUIREMENTS.md`

When this historical report conflicts with a later explicit approved decision, the newer decision documentation wins.

Do not duplicate those documents here.
