# S5 Handover + Return + Recovery Acceptance Evidence

## Implementation summary

Delivered S5 physical fulfillment, return, recovery, resolution, late receipt, consequence, reconciliation, and event-bound signing under delegated authority INV-057 and Owner supplemental decision INV-058.

1. **Physical issue and event-bound signatures (Q1, INV-041):**
   - Actual physical handover posts stock and asset state immediately (`handed_over`).
   - Signatures bind specific immutable snapshots; signature submission never posts stock or triggers a second warehouse effect.
   - Separate initial and supplemental events; each event carries its own signature obligation.

2. **Controlled actual below/above planned & supplemental handover (Q2, INV-058):**
   - Actual handover may be less than or exceed planned quantity when authorized, backed by eligible stock/exact assets, and atomically committed.
   - Owner selected option C: scoped Staff/Admin may issue supplemental handover even when cumulative actual exceeds planned, with mandatory reason, eligible stock, and atomic issue.
   - Supplemental handover cannot be called after initial return.
   - No reservation theft: competitor reservations are strictly protected.

3. **Physical return & consumable completion (Q5, Q8):**
   - Physical intake complete on receipt; records `good` or `damaged` condition.
   - Damaged return reduces return obligation (`due`) identically to good stock.
   - Consumable-only requests record initial return with empty lines; workflow completion requires all required signatures even when `return_due = 0`.

4. **Staff resolution & Admin asset consequence/reconciliation (Q6, Q7, INV-043):**
   - Staff may resolve unresolved returnable quantities with reason (`missing`, `unrecoverable`, `waived`) with zero warehouse delta.
   - Late physical return of previously waived stock atomically offsets resolution.
   - Admin consequence records `settled`, `retired`, or `disposed`.
   - Late return of settled assets creates a condition-specific reconciliation hold (`held`); Staff cannot release hold.
   - Admin reconciliation appends hold offset; retired assets can be restored to `in_service`, disposed assets cannot be reactivated.

5. **Immutable corrections & completion projection:**
   - Corrections append linked compensating and replacement facts; original event and signatures are preserved.
   - Correction of serialized replacement facts restores target-specific physical before-states without erasing predecessor compensation history.
   - Workflow reaches `completed` only when initial return exists, all signable events are signed, and return obligation is zero.

6. **UI and consumer cutover:**
   - Route `/equipment/fulfillment/[requestId]` provides physical fulfillment, return, recovery, resolution, and event-bound signing.
   - Requests with Inventory preparation cut over cleanly: legacy direct status RPCs and signature modals are replaced with event-bound workflow links.
   - Basic Medical and requests without preparation remain completely unchanged.

---

## Verification evidence (medlabs-verification-gate)

1. **Local clean pgTAP regression suites:**
   - Command: `supabase test db --local supabase/tests/inventory_s5_fulfillment.sql supabase/tests/inventory_s5_corrections.sql supabase/tests/inventory_s5_holds.sql supabase/tests/inventory_s5_resolution_edges.sql supabase/tests/inventory_s4_preparation.sql supabase/tests/inventory_s4_reservations.sql`
   - Result: `RUN AND PASS` (6 test files, 166 subtests, all passed).

2. **Real multi-connection concurrency & idempotency test:**
   - Command: `node --test tests/inventory-s5.test.mjs`
   - Scenarios: last-available decimal quantity race, exact asset race, replay idempotency & mismatch rejection, concurrent stale revision serialization.
   - Result: `RUN AND PASS` (5 test cases, all passed).

3. **Interactive browser verification:**
   - Surface: Headless Chromium on `http://localhost:3000/equipment/fulfillment/[requestId]` and `/equipment/mine`.
   - Exercised:
     - Initial handover below planned (0.2 / 8.0) posted immediate stock debit to 0.1 and updated status to `handed_over`.
     - Supplemental handover above planned (0.8) under INV-058 posted immediate stock debit and recorded distinct event.
     - Consumable initial return confirmation recorded event without fake stock receipt; status updated to `returned`.
     - Recipient login and signature execution on canvas: each event signed independently; canvas ink tracking rejected blank canvas; status transitioned to `completed` with 3 stored signatures.
     - Participant list view verified `Xem và ký xác nhận` link pointing to fulfillment route; legacy signature modals eliminated for prepared requests.
   - Result: `RUN AND PASS`.

4. **Code quality, lint, and formatting hygiene:**
   - `npm run typecheck`: `RUN AND PASS`.
   - `npx prettier --write`: `RUN AND PASS` (8 touched files formatted).
   - `npx eslint`: `RUN AND PASS` (0 warnings, 0 errors).
   - `git diff --check`: `RUN AND PASS` (no conflicts or whitespace errors).

5. **S1–S4 Regression:**
   - Local migrations and pgTAP tests for S1 foundation, S2 operations, S3 assets, and S4 preparation reservations all run and pass cleanly.
   - Result: `RUN AND PASS`.

---

## Boundaries and limits

- Scope is strictly synthetic pilot on local project and isolated pilot DB; no Basic Medical cutover, production migrations, deployment, or OPS remote changes.
- S5 is DONE; Owner formal acceptance is pending Owner review. P1 must NOT be auto-started.
