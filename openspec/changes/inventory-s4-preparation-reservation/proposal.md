# S4 — Equipment Request Preparation + Reservation

Status: **S4 ACCEPTED / CLOSED** under Owner INV-056. Implementation and isolated pilot migration DONE; targeted acceptance PASS; Owner acceptance ACCEPTED. Accepted implementation `14fb9a0`. S1–S3 remain ACCEPTED / CLOSED.

Canonical delegated technical contract: `D:/orca/medlabs-OPs/plans/S4_DESIGN_PACK.md`; Page Spec: `pages/specs/request-preparation.md`. OPS remains local-only. Owner permits full S4 design/implementation/verification, repository migrations applied only to isolated pilot `kwpyukofofoaqhmxndlc`, synthetic fixtures, generated types and commit/push to `eiu-medlabs-pilot/origin`. No per-slice approval.

Implement stable request lines, immutable registered baseline and revisions, preparation drafts/tab lock/re-review, explicit Inventory mapping, multiple single-source allocations, quantity/exact-asset hard reservation at confirmed PREPARED, pending/absolute adjustments, protected health deficits, strict linked real-transfer reversal, UI/RLS/RPC/history and behavioral verification. Reuse S1–S3 physical authorities; reservation never changes on-hand.

Owner notification decisions: draft/autosave/Save progress has no intermediate notification; confirmed PREPARED sends aggregate. New/changed shortfall proactively notifies scoped operations and current authorized participants. TA retains existing request rights only; neither class creator nor room-type scope expands access.

Verification: stable-line regression, scoped denial, stale/replay/atomicity and quantity/asset races, no draft reservation, absolute approval, physical deterioration/expiry preserving commitments, strict compensation prerequisite, Basic Medical compatibility and actual desktop/narrow UI smoke. Unexecuted checks are not PASS.

Delivery evidence: [S4 operational acceptance report](../../../docs/architecture/INVENTORY_S4_ACCEPTANCE.md). Migration `20261003085252_inventory_s4_preparation_reservations.sql` applied only to the authorized pilot; remote S1–S4 regression 121/121 PASS and synthetic rollback verified.

Owner priority adjustment INV-055: operational flow first. Preparation UI is PROVISIONAL / TESTABLE and retained for operations, RPC verification, visible allocations/reservations/shortfall/reversal and browser smoke. DB/RPC/business-flow/concurrency/invariants are the acceptance priority. Redesign, polish, noncritical responsive refinement, detailed styling, final navigation organization and complete visual parity are deferred to a separate UI/UX round; they do not block S4.

Excluded: S5 handover/return/signatures/recovery/late return; Basic Medical Inventory cutover; P1 real stock; production/deploy; OPS remote push. S4 is closed; reopen only for a new functional/data/security blocker. Next is actual S5 delta identification only, without rebuilding S1–S4; S5 implementation is NOT YET AUTHORIZED. PROVISIONAL / TESTABLE UI is accepted without full UI/UX/WCAG as a closure gate.
