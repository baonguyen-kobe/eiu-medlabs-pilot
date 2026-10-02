# EIU Medlabs Inventory — Decision Log

Append approved decisions; do not rewrite superseded entries. `PROJECT_HANDOFF.md` states current truth; this log preserves why and when it changed.

> **Historical local subset.** Canonical Inventory decisions now live in `D:/orca/medlabs-OPs/decisions/DECISION_LOG.md` (INV-001 onward). Do not create a second conflicting INV sequence here. See the appended PILOT-REVIEW-001 reconciliation index and [review baseline](INVENTORY_PILOT_RECONCILIATION.md).

## INV-001

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** Inventory manages both quantity-tracked stock and individually serialized physical assets.
- **Reason:** EIU requires consumable/general stock and unique institutional equipment identity without conflating their invariants.
- **Supersedes:** “serialized assets optional” from earlier conditional Phase 2 analysis.
- **Affected phase:** Phase 3 foundation.
- **Implementation consequence:** Design separate catalog/stock and serialized asset branches; do not use one universal row model.

## INV-002

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** `equipment_assets` is the long-term canonical institutional physical-asset identity.
- **Reason:** Skills Lab, Basic Medical, and generic Inventory may eventually refer to the same physical equipment.
- **Supersedes:** “future asset bridge optional” assumption.
- **Affected phase:** Phase 3 and staged follow-on integration.
- **Implementation consequence:** Build a canonical asset model, but do not perform a big-bang migration or merge workflow tables.

## INV-003

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** Existing Skills and Basic Medical equipment workflows remain isolated during initial rollout; canonicalization is staged.
- **Reason:** Shared physical identity does not imply shared request, evidence, or workflow ownership.
- **Supersedes:** V1 “NO BRIDGE” as a permanent architecture assumption; it remains the initial operational posture.
- **Affected phase:** Phase 3 foundation.
- **Implementation consequence:** Do not replace or merge `equipment_catalog`, `equipment_requests`, `basic_medical_equipment_catalog`, `basic_medical_room_inventory`, or Basic Medical evidence.

## INV-004

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** Maintenance, calibration, and inspection are required future domains.
- **Reason:** Confirmed EIU business requirements.
- **Supersedes:** Earlier conditional classification of these capabilities.
- **Affected phase:** Foundation compatibility; later implementation.
- **Implementation consequence:** Preserve a normalized future direction using service plans/events and service types; never copy month-column maintenance storage.

## INV-005

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** Repair and formal institutional asset transfer/loan target V1.1.
- **Reason:** They are real requirements but not foundation tracer work.
- **Supersedes:** Earlier broad “later” sequencing assumption.
- **Affected phase:** V1.1.
- **Implementation consequence:** Keep repair and formal transfer/loan separate from asset lifecycle and existing class-equipment handover/return.

## INV-006

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** V1 Inventory access is active Admin and active Staff only.
- **Reason:** EIU selected a simple initial operational boundary.
- **Supersedes:** Earlier conditional module/resource grant model.
- **Affected phase:** Phase 3 foundation.
- **Implementation consequence:** Lecturer, teaching assistant, and viewer are denied by default; Admin has full authority and Staff normal operational authority.

## INV-007

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** No speculative per-location, per-room, per-lab, or department authorization framework in V1.
- **Reason:** Locations are operational data, not a V1 authorization boundary.
- **Supersedes:** `inventory_permission_grants` as a proposed V1 foundation table and location-grant assumptions.
- **Affected phase:** Phase 3 foundation.
- **Implementation consequence:** Prefer existing Medlabs roles and private authorization predicates; do not create `inventory_permission_grants` unless a concrete requirement changes this decision.

## INV-008

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** Medlabs does not own procurement; retain acquisition/provenance only.
- **Reason:** Purchasing is performed by another department/system.
- **Supersedes:** Procurement/PO ownership unresolved assumption.
- **Affected phase:** Phase 3 foundation.
- **Implementation consequence:** Do not build purchase orders, approval, or procurement state machine. Model supplier, contract/reference, funding, acquisition/cost, warranty, manufacturer, origin, and notes in a many-assets-or-receipts-capable provenance design.

## INV-009

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** Do not create a generic Inventory request aggregate.
- **Reason:** Existing Medlabs request/registration workflows remain business-demand sources.
- **Supersedes:** Generic Inventory request workflow unresolved assumption.
- **Affected phase:** Phase 3 preparation integration.
- **Implementation consequence:** Do not create `inventory_requests` or `inventory_request_lines`; Inventory owns reservations, movements, asset allocation, and physical fulfillment consequences.

## INV-010

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** Reservation begins at PREPARED, not NEW.
- **Reason:** NEW is demand only; prepared quantities represent committed physical fulfillment.
- **Supersedes:** Any status-only preparation assumption.
- **Affected phase:** Phase 3 reservation foundation.
- **Implementation consequence:** Design separate reservation records/state; reservation is not a stock movement.

## INV-011

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** Serialized reservation locks exact assets/serials.
- **Reason:** One reserved asset cannot be prepared for another request.
- **Supersedes:** Generic quantity-only reservation assumptions.
- **Affected phase:** Phase 3 reservation foundation.
- **Implementation consequence:** Prevent concurrent selection of reserved serialized assets and validate availability transactionally.

## INV-012

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** QR or equivalent code scanning is required for serialized preparation.
- **Reason:** Preparation must identify the exact physical asset.
- **Supersedes:** “QR = later.”
- **Affected phase:** Phase 3 serialized preparation.
- **Implementation consequence:** Resolve stable asset identity/code server-side and reject inactive, incompatible, unavailable, reserved, maintained, damaged, or otherwise prohibited assets with clear reasons.

## INV-013

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** Stock-location transfer is required in V1.
- **Reason:** Preparation may need stock moved to the pickup/source location first.
- **Supersedes:** “stock transfer = later” for inventory location transfer.
- **Affected phase:** Phase 3 V1 ledger slices.
- **Implementation consequence:** Atomically debit source, credit destination, create correlated immutable movements, and audit. Formal asset custody/loan/department transfer remains V1.1.

## INV-014

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** Movement reversal uses compensating movements.
- **Reason:** Historical movements must remain immutable and truthful.
- **Supersedes:** Any edit/delete-based reversal approach.
- **Affected phase:** Phase 3 ledger.
- **Implementation consequence:** Never edit/delete history to fake a reversal.

## INV-015

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** Requested demand and preparation fulfillment are separate data.
- **Reason:** Preparation may use actual quantities/products that differ from the requested representation.
- **Supersedes:** Any preparation model that overwrites request demand.
- **Affected phase:** Phase 3 request-preparation integration.
- **Implementation consequence:** Store actual prepared quantities, derive shortages, require shortage reasons, and allow independent preparation additions without changing original shortage calculations.

## INV-016

- **Date:** 2026-08-25
- **Status:** SUPERSEDED IN PART by canonical INV-025–039 and PILOT-REVIEW-001; retain historical unanswered details, not blanket unresolved delivery.
- **Decision:** PREPARED → PARTIALLY_DELIVERED → DELIVERED remains partially unresolved.
- **Reason:** Delivery planning has unanswered business options.
- **Supersedes:** Any inferred full-delivery design.
- **Affected phase:** Later delivery workflow.
- **Implementation consequence:** Do not implement complete delivery behavior until explicitly approved.

## INV-017

- **Date:** 2026-08-25
- **Status:** APPROVED / LOCKED
- **Decision:** NEW-request preparation uses a shared Admin/Chuyên viên Labs queue with explicit start, internal preparation progress, and an exclusive Preparation-tab lock.
- **Reason:** Historical approved planning evidence defines the operational preparation workflow before the NEW → PREPARED transition.
- **Supersedes:** Earlier generic or unverified queue/lock/autosave assumptions.
- **Affected phase:** Phase 3 request-preparation integration.
- **Implementation consequence:** Use the approved queue priority and warning threshold; preserve public NEW while preparation is incomplete; provide auto-save/manual progress save; Admin may unlock/transfer control; lock releases on completion, cancellation, page exit, or timeout. Notification batching remains intentionally ambiguous; see the business requirements evidence section.

## PILOT-REVIEW-001 — 2026-10-02 authority reconciliation

- **Status:** documentation reconciliation applied; new detailed design proposals UNDER_REVIEW, implementation NOT_STARTED.
- **Current pilot:** `baonguyen-kobe/eiu-medlabs-pilot`, main bootstrap `e802421`; origin writable, original repo upstream fetch/reference only.
- **Canonical decisions:** INV-025/Q1, INV-026/Q2, INV-027/Q3, INV-028/Q4, INV-029/Q5, INV-030/Q6, INV-031/Q7, INV-032/Q8, INV-033/Q9, INV-034/Q10, INV-035/F1, INV-036/F2, INV-037/F3, INV-038/safeguards, INV-039/isolation remain in the control plane. Do not renumber or duplicate them here.
- **Supersedes:** local INV-016 blanket unresolved-delivery interpretation, live August roadmap sequence, forced single-source requirement and nullable-FK workaround for destructive operational-line edits. Historical entries and snapshot remain evidence.
- **Accepted review refinements:** status alone has no stock effect; source documents have zero stock delta and 0..n receipts; business uniqueness plus retry/revision guards; visible damage shortfall; immutable opening provenance; S1 minimum ledger before receipt, S4 ownership before reservations.
- **Proposed, not owner-approved:** initial physical-return posting independent of first signature; precise expiry/use-date rules; post-settlement physical-offset/Admin-hold contract; exact transaction header/lines schema.
- **Not approved:** automatic replacement or retirement of production, wholesale ui-modernization merge, implementation, SQL, remote mutation, deploy, commit or push in this review.

## PILOT-REVIEW-002 — owner policy closure

Canonical INV-041–046 approve immediate return/separate signature; day/month expiry/FEFO/no future-use-date/opening-only unknown; Staff/Admin late intake/Admin hold; replacement candidate with port-back fallback; synthetic S1–S5/single-writer P1; mandatory rotation before real operational use and Vercel before deployed UAT.

Supersedes corresponding proposals/default-port-back of PILOT-REVIEW-001 and canonical INV-031/035/039/040. History retained. Policy approved, detailed design UNDER_REVIEW, G0 OPEN, implementation NOT_STARTED. No execution authorized.
