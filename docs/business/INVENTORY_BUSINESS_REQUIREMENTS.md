# Inventory / Equipment Business Requirements

This document records approved business behavior. It is not a database/schema design.

## 1. Requirement Status Legend

| Status | Meaning |
|---|---|
| APPROVED | User-approved business behavior; do not redefine without an explicit new decision. |
| PARTIALLY APPROVED | Direction is approved, but named details remain unresolved. |
| UNRESOLVED | Do not infer behavior or implement it. |
| SUPERSEDED | Older assumption replaced by a later approved decision. |

## Business Requirement Evidence

Primary historical evidence: `docs/business/evidence/LEGACY_INVENTORY_BUSINESS_PLANNING_230_360.txt`.

- Answered decisions and their consolidation through 230–300 are historical approved NEW → PREPARED evidence.
- Questions/options 301–360 are not approved requirements unless the artifact records an explicit user answer; this artifact contains no such answers.
- Newer explicit entries in `docs/architecture/DECISION_LOG.md` may supersede historical decisions.

| Requirement | Classification | Evidence |
|---|---|---|
| Shared Admin/Chuyên viên Labs preparation queue | APPROVED | 76–100 |
| Filters, search, sortable columns; priority overdue → earliest pickup → earliest class | APPROVED | 79–100 |
| Prominent near-pickup unprepared warning; notify Admin/Labs; common Admin-configurable lead time | APPROVED | 94–100 |
| No automatic assignee; Admin may assign; other staff obey active lock | APPROVED | 94, 116 |
| Explicit preparation start; internal `Đang chuẩn bị`; public state stays NEW | APPROVED | 101–115, 327–345 |
| Auto-save and manual Save Progress | APPROVED | 327–345 |
| Whole Preparation-tab lock; Admin unlock/transfer; other Labs staff wait | APPROVED | 360–373, 575–578 |
| Lock release on completion, cancellation, page exit, or inactivity timeout | APPROVED | 364–369 |
| Original requested quantity separate from prepared quantity | APPROVED | 146–180, 518–529 |
| Derived shortage and mandatory shortage reason | APPROVED | 218–238, 274–289 |
| Added active catalog lines are independent | APPROVED | 162–180, 495–529 |
| One requirement may use multiple actual commercial items | APPROVED | 167–180 |
| One final source location; transfer prerequisite; no in-transit state | APPROVED | 182–200, 531–546 |
| Exact serialized selection and QR/code validation | APPROVED | 202–216, 548–558 |
| Reservation starts at PREPARED; exact serials lock | APPROVED | 254–273 |
| NEW-user edits preserve progress, require re-review/reconciliation | APPROVED | 346–359, 560–573 |
| Frozen fields after preparation begins: course code and technique/activity name | APPROVED | 568–573 |
| PREPARED → NEW releases reservation and uses compensating transfer/movements | APPROVED | 375–394 |
| Preparation notifications | APPROVED WITH AMBIGUITY | User chose 299C with “group into notifications” preference at 495–504; the later batching/timing explanation is interpretation at 579–589. The approved intent is aggregated, non-noisy change notification; exact trigger/batching implementation remains unresolved. |

## 2. Actors

Use existing Medlabs actors only:

- Admin;
- Staff / Chuyên viên Labs;
- Requester;
- Responsible Lecturer.

Do not create system roles. V1 Inventory application access is active Admin/Staff only. Lecturer, teaching assistant, and viewer are denied Inventory access by default; request participants retain their existing Medlabs workflow roles.

## 3. Core Inventory Concepts

| Concept | Business meaning |
|---|---|
| Catalog item | Active definition of an available product/equipment representation. |
| Quantity-tracked stock | Fungible stock measured by available/reserved/issued quantity. |
| Serialized physical asset | Individually identified physical equipment with exact code/serial. |
| Storage location | Internal operational location holding stock/assets. |
| Pickup location | Place where requester receives prepared equipment/material. |
| Reservation | Commitment of available quantity or an exact asset to a prepared request. |
| Stock movement | Immutable record of quantity entering, leaving, adjusting, or moving between locations. |
| Asset selection | Choosing the exact serialized asset to fulfill a prepared requirement. |
| Acquisition provenance | External procurement/reference facts associated with assets or stock receipts. |

Requested demand remains distinct from actual fulfillment/preparation.

## 4. Request Source

**APPROVED:** Existing Medlabs equipment registration/request is the source of business demand. Do not create a duplicate generic Inventory request aggregate.

Inventory owns the physical fulfillment consequences: availability, source location, transfer, reservation, movements, exact asset allocation, and asset history.

## 5. NEW Queue

**APPROVED:** Admin and Chuyên viên Labs share the NEW preparation queue.

- It supports filters, quick warning/room/pickup/location views, search, and sortable columns.
- Default priority is: overdue preparation; earliest pickup datetime; earliest class datetime.
- NEW requests are not automatically assigned.
- Near-pickup, unprepared requests show a prominent warning and notify the operational Admin/Labs audience.
- Warning lead time is one common Admin-configurable threshold.
- Admin may assign a request to Admin or Labs staff; other staff may assist only under the active preparation lock.

## 6. Preparation Progress

**APPROVED:** Opening a request requires no claim step. When work actually begins, Admin/Labs explicitly uses **Start preparation**.

- The system sets an internal `Đang chuẩn bị` flag and locks the whole Preparation tab to the active editor.
- The visible main request state remains NEW while incomplete; there is no public `PARTIALLY_PREPARED` state and no reservation at start.
- Progress supports auto-save and manual **Save progress**.
- Admin can unlock or transfer control. Other Labs staff do not silently take over.
- The lock releases on completion, cancellation, page exit, or configured inactivity timeout.

## 7. Requested Demand vs Preparation

**APPROVED:** Original request demand is never overwritten.

Each original request line retains requested item/context and requested quantity. Preparation separately records prepared quantity, derived shortage quantity, shortage reason, and preparation notes.

Shortage equals requested quantity minus prepared quantity. Independent added catalog lines do not automatically reduce shortage on an original line.

## 8. Preparation Allocations / Commercial Item Selection

**APPROVED:** One requested requirement may use multiple actual commercial/catalog selections where applicable.

- Admin/Staff may add any active catalog item during preparation; it need not share the original equipment group.
- An added item is an independent line, need not link to an original request line, and does not automatically reduce that line's shortage.
- Original request lines, requested quantity, prepared quantity, and derived shortage remain preserved.
- Added lines are visible to requester/responsible lecturer, included in the aggregate completion notification, and audited with actor, time, and quantity.

## 9. Storage Source and Stock Transfer

**APPROVED:** Pickup location is where the requester receives material/equipment. Source storage is an internal Inventory fact.

- One preparation line ultimately uses one final source storage location.
- If the pickup location lacks quantity, Admin/Labs completes a stock-location transfer from another store first.
- Confirmed transfer updates source/destination balances immediately; no separate in-transit state exists.
- The resulting pickup location becomes the final preparation source; original source and transfer remain immutable movement/audit history.
- Transfer reversal creates a compensating movement; historical movements are never edited/deleted.

## 10. Shortage Rules

**APPROVED:** Prepared quantity may be lower than requested quantity.

Shortage or zero-prepared lines require a configured reason. Default reasons:

- insufficient stock;
- currently in use;
- under maintenance.

Admin may configure or deactivate additional reasons. A request with every preparation line at zero cannot transition to PREPARED.

## 11. Serialized Assets / QR

**APPROVED:** Serialized/asset-managed equipment requires exact asset/serial selection before PREPARED.

QR or equivalent code scanning is supported. The scanned asset must be:

- active;
- compatible with selected catalog/equipment identity;
- available;
- not reserved elsewhere;
- not under maintenance, damaged, or otherwise prohibited from issue.

Invalid scans are blocked with a clear reason. Labs may change a selected serial before delivery with audit. Reservation locks the exact asset/serial. QR payload must not expose sensitive data.

## 12. Reservation

**APPROVED:**

| Request state | Reservation behavior |
|---|---|
| NEW | Demand only; no Inventory reservation. |
| PREPARED | Reserve actual prepared quantity and exact serialized assets. |

Reservation differs from stock movement. Reserved inventory cannot be allocated to another conflicting request.

## 13. Transition NEW → PREPARED

**APPROVED:** Transition requires at least:

- every request line reviewed;
- prepared quantity specified;
- shortage reason when required;
- serialized assets fully selected;
- no invalid/inactive catalog selections;
- valid source location;
- approved pickup/return location requirements satisfied;
- required stock transfers completed;
- not all lines zero.

On success, preparation becomes the authoritative fulfillment plan; reservations are created atomically; the action actor becomes the primary responsible person; and the transition/status notification is triggered. Intermediate preparation-notification timing follows the ambiguity boundary below.

### Preparation Notifications — APPROVED WITH AMBIGUITY

The explicit user-approved intent is aggregate, non-noisy notifications for preparation changes, plus the PREPARED status notification. The user chose 299C with a preference to group notifications at 495–504; the later batching/timing explanation at 579–589 is interpretation, not an additional approved requirement.

Approved business intent: avoid one notification per changed field and provide an aggregate change summary to the relevant request audience; emit the PREPARED status notification.

**UNRESOLVED implementation details:** whether manual progress saves, other business actions, or background auto-save send an intermediate notification; the exact batch window; and the exact aggregation trigger. Q301 at 604–610 asks this notification-trigger question without a user answer.

## 14. Concurrent User Editing

**APPROVED:**

- While state remains NEW, permitted requester changes are accepted and take precedence over preparation data.
- Existing preparation progress is preserved; affected lines are marked for re-review and must reconcile to the newer request version before PREPARED.
- Admin/Labs must not silently overwrite newer requester data. They may edit for the requester or flag **Yêu cầu chỉnh sửa** and pause preparation.
- Once `Đang chuẩn bị` starts, requester cannot change course code or technique/activity name; other NEW-permitted fields remain editable.
- Admin controls preparation-lock override.

## 15. PREPARED → NEW Reversal

**APPROVED:** Admin and Chuyên viên Labs may reverse the action.

- Cancel/release reservations and preserve preparation history.
- Restore the prior primary responsible person and allow requester editing under NEW rules.
- Audit and notify the reversal.
- If stock transfer occurred, do not reverse immediately: create and complete any required compensating transfer to the old store first.
- Never modify/delete historical movement; create audited compensating movement instead.

## 16. Procurement / Acquisition Provenance

**APPROVED:** Medlabs does not manage procurement workflow; another department/system purchases equipment/materials.

Inventory retains provenance/reference facts: supplier, contract number/date, external procurement reference, funding source, acquisition date/cost, warranty, manufacturer, country of origin, and notes.

One acquisition/contract can relate to multiple assets or stock receipts.

## 17. Delivery Workflow

**UNRESOLVED / INCOMPLETE:**

```text
PREPARED → PARTIALLY_DELIVERED → DELIVERED
```

Detailed delivery choices were not completed. Do not convert previous unanswered delivery options into requirements.

Unresolved categories include actual receiver/substitution, delivery QR re-scan, serial replacement, condition confirmation, recipient confirmation/signature, partial delivery, reservation-to-issued timing, asset custody, delivery reversal, and return handling.

## 18. Required Future Equipment Domains

**APPROVED future requirements:** maintenance, calibration, inspection, repair, formal asset transfer, and loan.

- Repair and formal transfer/loan target V1.1.
- Maintenance/calibration/inspection are required future domains after foundation; their exact implementation slice is selected later.
- These workflows remain separate from narrow asset lifecycle state and from existing class-equipment handover/return.
