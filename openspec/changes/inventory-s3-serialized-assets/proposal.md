# S3 — Serialized Asset + QR

Status: **S3 ACCEPTED / CLOSED** — explicit Owner decision on 2026-10-03. Accepted implementation `ca7e5db`, migration `20261003064848_inventory_s3_assets.sql`, isolated pilot `kwpyukofofoaqhmxndlc`. See [acceptance evidence](../../../docs/architecture/INVENTORY_S3_ACCEPTANCE.md).

## Authority and scope

Owner authorizes continuous S3 design/implementation, local verification, synthetic isolated pilot migration and pilot Git commit/push. Local control plane `D:/orca/medlabs-OPs`, INV-052 and `plans/S3_DESIGN_PACK.md`, is design authority; no OPS remote mutation/push. S1/S2 remain ACCEPTED / CLOSED.

Implement canonical equipment_assets; immutable mandatory internal code; nullable manufacturer serial; existing item/source/location links; exact receipt and Admin opening; duplicate protection; orthogonal lifecycle/operational status/current physical custody; derived eligibility without reservations; identity-only QR and authorized lookup; asset list/detail/append-only history/correction; RLS/RPC/schema/migration/types/UI/regression coverage.

Owner clarified manufacturer serial uniqueness is **manufacturer + model + serial across SKUs**, requiring maker/model when serial exists. Admin may reactivate retired with reason/evidence; disposed has no ordinary reactivation. Asset facts never increment quantity balances. QR embeds only institutional asset_code. Shared inventory_transactions headers link typed exact-asset effects; no parallel quantity ledger.

## Implementation boundary

Dedicated exact-asset command/read RPCs reuse existing active Admin/Staff checks, conservative writer lock, replay/audit conventions and master records. Existing quantity command/read contracts remain intact. Existing generic transaction history exposes asset operation labels and resolves exact effects to canonical asset detail. Manufacturer/expiry fact corrections append events referencing original evidence, never replace old events. Revisions reject stale writes.

## Verification and delivery gate

Targeted local RPC/pgTAP coverage for identity, replay/duplicates, concurrency, role/direct-write boundaries, immutable history, first-fact guards, lifecycle/expiry and zero quantity effects. Real UI intake/state/lifecycle/correction/history/QR lookup plus desktop/narrow inspection. Regenerate local database types; run impacted S1/S2 checks and changed-file preflight. Verify linked pilot `kwpyukofofoaqhmxndlc`, apply repository migration only after local evidence, independently smoke synthetic rollback and catalog/history. Report only executed evidence.

S3 work stops. Do not reopen without a new functional/data/security blocker. S4 Implementation NOT YET AUTHORIZED; only bounded S4 delta identification is authorized. No handover/return/recovery, Basic Medical cutover, real P1 stock, production `bwhiivfhezoozrzvchmm` or Vercel deployment. OPS remains local-only; no remote changes or push.
