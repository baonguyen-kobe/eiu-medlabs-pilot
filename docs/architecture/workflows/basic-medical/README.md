# Basic Medical registration and execution workflow

**Risk:** CRITICAL  
**Evidence:** IMPLEMENTED unless marked otherwise.

## Purpose and entry points

The workflow creates a Basic Medical registration, derives linked class schedules/sessions, records signed execution evidence against room inventory, and preserves/invalidates evidence when operational facts change.

Primary code: `app/basic-medical/registrations/actions.ts`, registration and confirmation pages/components.  
Database authority: `supabase/schemas/03_registration_workflows.sql`, `11_basic_medical_linked_schedule_editor.sql` through `32_basic_medical_condition_adjustment_notifications.sql`.

## Happy path

1. **Authorized owner or Basic Medical manager** submits registration and session payload.
2. **`save_basic_medical_registration`** validates actor scope, ownership, dates, course, room, student count, session identity, and cancellation state. It atomically creates/updates the registration, sessions, and linked `class_schedules`.
3. A valid session may create a **Basic Medical equipment request**. The request RPC confirms that the source session/registration/schedule is active, derives its semester/domain, validates the Basic Medical catalog, and creates request plus items transactionally.
4. **Signer** submits a PNG signature and an inventory condition snapshot for a completed session.
5. **`confirm_basic_medical_session`** validates active session/schedule, signer authority, expected inventory values, catalog snapshots, quantity bounds, and concurrent inventory state. It creates an immutable confirmation and equipment-check rows.
6. If damaged quantity is recorded, the RPC writes condition evidence and enqueues a damage notification in the same transaction.
7. Authorized readers retrieve confirmation evidence through a scope-checked RPC or PDF route.

## Cancellation and correction paths

- **Cancel registration:** manager-only RPC marks the registration cancelled, cancels/inactivates linked operational state, invalidates affected confirmations, audits the action, and triggers notification handling.
- **Cancel one session:** manager-only RPC requires a non-empty reason and refuses cancellation while a non-invalidated confirmation exists. An administrator must first invalidate the confirmation explicitly.
- **Invalidate confirmation:** admin-only RPC requires a reason, preserves original evidence, records invalidation actor/name/reason, and writes an audit record. It is idempotent.
- **Schedule/room/time change:** database trigger invalidates active confirmation evidence so stale operational evidence cannot remain authoritative.
- **Teaching lecturer change:** dedicated RPC validates the active session/schedule and records auditable context without broadly exposing confirmation data.
- **Cancelled source:** subsequent Basic Medical equipment-request create/edit operations reject the stale source.

## Data and authorization boundary

| Concern | Evidence |
| --- | --- |
| Registration-to-session | `basic_medical_registrations → basic_medical_registration_sessions → class_schedules` |
| Confirmation evidence | `basic_medical_session_confirmations`, checks, inventory and condition logs; FK structure supported by Liam ERD |
| Direct writes | insert/update/delete revoked from authenticated users for confirmation/inventory mutation tables; RPCs are the mutation boundary |
| RLS/read scope | confirmation/evidence reads use `private.can_view_basic_medical_registration` or Basic Medical management predicates |
| Concurrency | confirmation eligibility and inventory mutation code locks/validates source state; active confirmation unique index prevents duplicate active confirmation per session |
| Auditability | cancellation, invalidation, linked change and equipment condition paths have explicit audit/outbox behavior |

## State model

- Registration/session: active or cancelled.
- Confirmation: active or invalidated; invalidation retains historical evidence and reason.
- Equipment condition: inventory quantities plus condition-log event types `damage_report`, `condition_adjustment`, and `stock_adjustment`.

## Evidence classification

- **IMPLEMENTED:** source guards, cancellation/invalidation ordering, manager/admin checks, RLS read scope, immutable snapshots, damage notifications.
- **DOCUMENTED:** the workflow’s evidence/PDF presentation is documented by existing API routes and tests.
- **INFERRED:** external email delivery is not asserted without a live provider.
- **MISSING:** no business-rule gap was identified from inspected repository evidence.
