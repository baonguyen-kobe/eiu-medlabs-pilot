# Scheduling and staffing workflows

## Class scheduling and assignment — HIGH

**Entry points:** `/schedule-entry/new`, dashboard/class pages.  
**Actors:** lecturer, staff, admin.  
**Core path:** create schedule draft → validate semester, room type, operating hours and collisions → persist `class_schedules` → assign/claim/withdraw lecturer → revalidate schedule views → queue notifications.

Administrative edits, reschedules, cancellation, and lecturer assignment route through `app/dashboard/actions.ts`. The underlying database validation and audit contracts determine the authoritative outcome. Basic Medical linked schedules add an evidence safeguard: a change to room/date/time/lecturer invalidates active confirmation evidence.

**Risk focus:** cancellation or rescheduling of a linked Basic Medical schedule cannot leave a stale active confirmation. This is enforced by trigger/RPC evidence.

## Staff shifts — HIGH

**Entry points:** `/staff-shifts`, dashboard roster.  
**Actors:** staff, admin, root admin.  
**Core path:** submit week/freeform shift payload → `register_staff_shifts` RPC validates active actor, operational eligibility, assigned person, slot time grid, historical authority/reason, and no-overlap condition → write `staff_shifts` and audit data.

Cancellation and time adjustment use dedicated RPCs. UI refreshes after mutations and subscribes to realtime changes for the `staff_shifts` table.

**States:** active/cancelled, with historical mutation reason requirements.  
**Health:** HEALTHY from reviewed server-action/RPC and client refresh path. A live multi-user realtime check remains an integration verification item.
