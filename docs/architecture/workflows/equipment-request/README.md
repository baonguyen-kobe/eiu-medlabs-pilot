# Equipment request workflow

**Risk:** CRITICAL  
**Evidence:** IMPLEMENTED unless marked otherwise.

## Purpose and entry points

An eligible Skills Lab or Basic Medical actor creates a request tied to an active class schedule. Operations personnel manage the fulfillment lifecycle. Entry pages are `/equipment/register`, `/equipment/mine`, `/equipment/requests`, and the Basic Medical request flow under `/basic-medical/registrations`.

Primary code: `app/equipment/actions.ts`, `components/equipment-request-list.tsx`, `lib/equipment-requests.ts`.  
Database authority: `supabase/schemas/03_registration_workflows.sql`, `25_basic_medical_equipment_request_wave_1.sql` through `30_phase3b_operational_notifications_audit.sql` and their referenced migrations.

## Happy path

1. **Eligible registrant** submits request data and items from the frontend.
2. **Server action** validates UUIDs, quantities, dates, and request payload before calling the request RPC.
3. **Database RPC** validates active user, role/scope, schedule availability, room domain, semester, phone snapshot, late-registration rules, and active catalog items. It writes `equipment_requests` and `equipment_request_items` transactionally and enqueues an outbox event.
4. **Staff/Admin** moves the request to `preparing` through `manager_confirm_equipment_status`; the RPC locks the request row and enforces equipment-management scope.
5. **Staff/Admin** records the warehouse side of handover. The request becomes `handed_over` only after the recipient signature is also present.
6. **Registrant or responsible lecturer** signs handover through `registrant_confirm_equipment_handoff`. The RPC verifies PNG data, recipient identity, workflow phase, and row locks.
7. The same two-party sequence records return. Completion is set only when both warehouse and recipient confirmations exist.
8. The lifecycle observer writes audit records and queues notification events in the same database transaction.

## State model

`new → preparing → handed_over → completed`

`returned` is an intermediate warehouse/recipient-confirmation representation. `cancelled` is terminal. The status RPC deliberately allows privileged operational rollback to a prior ranked status; integration tests cover `handed_over → new → preparing` correction behavior. Late approval is independent: `not_required | pending | approved | rejected`.

## Decisions and exception paths

- **Late request:** manager must approve/reject while the receive time is still future; a pending/rejected request cannot be advanced in the UI.
- **Early handover:** a manager cannot hand over directly from `new`, except for the explicit early-confirmation authority path.
- **Invalid signature:** client shape checks and database PNG decoding/header checks reject it.
- **Unauthorized actor or wrong room-domain scope:** the RPC rejects with `42501` / scoped error codes.
- **Cancelled request:** state RPC rejects it as terminal. Basic Medical requests remain historical via soft cancellation; Skills requests may be hard-deleted only by `private.can_hard_delete()`.
- **Item/content mutation after fulfillment:** item and content RPCs allow only `new`/`preparing`.

## Data and audit boundary

| Concern | Evidence |
| --- | --- |
| Request / items | `equipment_requests → equipment_request_items`; verified in Liam supporting model |
| Schedule linkage | `equipment_requests.class_schedule_id → class_schedules.id`, active source behavior is `ON DELETE RESTRICT` |
| Authorization | server actions authenticate; RPCs re-check active user, role and request/schedule domain scope |
| Concurrency | lifecycle RPCs select the request `FOR UPDATE`; creation/edit RPCs validate linked schedule source |
| Audit | `equipment_requests_lifecycle_observer` records status and dual-confirmation events; cancellation and hard-delete have explicit audit writes |
| Notification | transactionally queued outbox events; server actions schedule pending-outbox processing |

## Evidence classification

- **IMPLEMENTED:** dual signature confirmation, scoped status RPCs, cancellation/hard-delete split, outbox, lifecycle audit observer.
- **INFERRED:** no live delivery-provider result was inspected, so actual email delivery is not asserted.
- **BUSINESS DECISION REQUIRED:** whether a request may be cancelled after it has been handed over or completed. The current soft-cancel RPC permits it; repository evidence does not establish whether that is intended policy.
