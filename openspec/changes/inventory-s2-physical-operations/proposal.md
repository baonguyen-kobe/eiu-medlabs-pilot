# S2 physical inventory operations

## Authority and status

Owner accepted and closed S2 on 2026-10-03 for the isolated synthetic pilot (INV-051), following the approved delta and INV-050 surplus policy. S1 remains ACCEPTED / CLOSED. S2 implementation and remote pilot migration DONE; targeted acceptance PASS; Owner acceptance ACCEPTED. Accepted implementation commit `a450117`, migration `20261003030000_inventory_s2_operations.sql` on `kwpyukofofoaqhmxndlc`. Accepted non-blocking limits and historical executed evidence: `docs/architecture/INVENTORY_S2_ACCEPTANCE.md`. Do not reopen S2 for those limits absent a new functional/data/security blocker. No S3 implementation, real P1 stock or production authorization.

## Approved change

Extend the existing `inventory_command` and `inventory_read` boundaries, signed ledger and dimensional balance projection. No second stock truth.

- Atomic cohort-preserving transfer between locations, retaining condition, provenance, expiry and hold.
- Physical good-to-damaged transition only. No repair.
- Evidence-backed counted reconciliation: server calculates delta from locked current balance; unchanged counts retain immutable evidence.
- Unprovenanced physical surplus receives a separate `STOCKTAKE_SURPLUS` origin, immediately on-hand and held. Never invent a receipt, contract or old-cohort attribution.
- Admin may release non-expiry surplus using count evidence despite unknown historical acquisition. Required-expiry surplus remains held until Admin verifies day/month expiry. Normal condition, activity and expiry eligibility still apply after release.
- Later evidence is append-only. Existing receipts, opening facts and count events are not rewritten.
- Bounded operational stock, dimensional location and immutable evidence history support the workflows.

## Invariants

Current database authorization precedes replay. Two distinct freshness tokens apply to physical cohort commands: `expected_version` for fact version and `expected_stock_revision` for monotonic cohort movement. Counts additionally require `expected_quantity`. Physical observations must retain their original tokens through UI pagination/search; stale observations require recount. Batch lines for different conditions of one cohort validate the pre-command revision, then bump it once per affected cohort. Stocktake business reference is unique independently of retry key. Ledger deltas reconcile to every balance dimension; balances cannot become negative.

S1 dispatcher branches are reused rather than reconstructed, with only the necessary downstream evidence guard and cohort revision extensions. Existing writer serialization remains the conservative concurrency design.

## Verification and delivery

Targeted S1/S2 RPC integration, RLS checks, TypeScript/ESLint and actual browser workflows are required. Independent integrity/security review findings must be resolved. Apply the verified repository migration only to the isolated pilot `kwpyukofofoaqhmxndlc`, then verify synthetic data. Commit/push application pilot only under current Owner authorization. Record final evidence separately; this proposal is not a PASS claim.

Control-plane `medlabs-OPs` remains local: retain its existing commit, do not change remote or push elsewhere. No S3, serialized assets/QR, reservation/issue/handover/return, real P1 stock, production mutation or Vercel deployment.
