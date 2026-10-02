# EIU MedLabs Inventory — Pilot Handoff

Updated 2026-10-03. **G0 APPROVED / DONE; S1 implementation IN_PROGRESS.** Owner INV-048 authorizes continuous bounded S1 implementation, synthetic local/pilot verification and coherent commit/push to pilot origin. Verify changes, not Git operations.

## Read order

1. [Documentation authority](../DOCUMENTATION_AUTHORITY.md).
2. `D:/orca/medlabs-OPs/CURRENT_STATE.md`, `NEXT_ACTION.md`, `SESSION_HANDOFF.md` and relevant canonical requirement/Page Spec/D2.
3. [Pilot reconciliation](INVENTORY_PILOT_RECONCILIATION.md) and [roadmap entry](MASTER_ROADMAP.md).
4. [Historical decision index](DECISION_LOG.md) and pinned Equipment references in the review, only as needed.

The former READY FOR PHASE 3 verdict and forced one-source/unresolved-delivery statements in this handoff are superseded. Do not approve implementation merely because an old report or snapshot says LOCKED/COMPLETE.

## Workspace and resource facts

- Application workspace `D:/orca/eiu-medlabs` now contains pilot repo `baonguyen-kobe/eiu-medlabs-pilot` on main, bootstrap `e8024212edd4b9c179055ad5c9490832f42944ea`.
- `origin` is pilot; original `baonguyen-kobe/eiu-medlabs` is `upstream`, fetch/reference only with push URL disabled. `remote.pushDefault=origin` was set in the prior authorized bootstrap.
- Inventory architecture authority remains `D:/orca/medlabs-OPs`; do not duplicate it wholesale in pilot.
- Supabase pilot ref `kwpyukofofoaqhmxndlc`, org `agpurdfhmyhnybfktdue`, Singapore; current CLI identity verified ACTIVE_HEALTHY and linked. Dedicated local pilot uses project `eiu-medlabs-pilot` and 583xx ports. Linking/health are not S1 schema or acceptance PASS.
- Vercel account/team authenticated earlier; no pilot Vercel project confirmed. Prior statements that all three resources were ready were inaccurate.
- Prior provisioning output exposed sensitive pilot credentials; authorized S1 remains synthetic only. INV-046 requires separately authorized, verified rotation before real operational data/use. No secrets belong in docs/Git or browser client config.

## Current contract

Existing Equipment Request owns demand, workflow events and signatures; Inventory owns physical effects. Retain quantity + serialized, canonical equipment_assets, exact asset/QR, no duplicate request/procurement/user system, existing MedLabs security/evidence boundaries and staged Basic Medical integration.

Q1 physical issue precedes signature; Q2 controlled initial over-plan actual; Q3 controlled multi-source allocations; Q4 actual transfer-back prerequisites before preparation reversal; Q5 good/damaged; Q6 Staff recovery waiver zero stock delta/Admin disposition; Q7 new late-return/offset and Admin settlement reconciliation; Q8 initial-return signature for all requests; Q9 fixed-room in-place vs session consumable vs portable returnable; Q10 no time-window reservation/clock release. F1 chemical expiry without business lots; F2 per-receipt conversion/stable base unit; F3 Skills Lab/Admin opening.

INV-041–046 close return/expiry/late-intake/strategy/single-writer/security policy. Replacement candidate target, port-back fallback. Owner INV-048 approves [G0 baseline](../../../medlabs-OPs/plans/G0_S1_DESIGN_FREEZE_PACK.md) and linked technical artifacts for S1; historical UNDER_REVIEW labels do not revoke that approval. [Execution slices](../../../medlabs-OPs/plans/S1_IMPLEMENTATION.md) define dependency order and evidence.

## Current action and gates

Implement and verify S1 end-to-end: identity/access/reference/source records, opening, quantity receipts/conversion/expiry/good-damaged, immutable ledger/cohorts/balances, corrections and approved pages/actions. Preserve final authorization, replay/business uniqueness, concurrency, rollback, numeric, expiry, opening, history/reconciliation and browser evidence. Commit/push coherent verified pilot checkpoints without rerunning unchanged checks solely for Git.

No S2+, P1 operational stock, Basic Medical cutover, Vercel deployment, credential rotation, upstream push or production mutation is authorized. P1 exact scope/single-writer/cutover/Admin opening and R1 production remain separate gates. Stop only at S1 completion or a genuine unresolved Owner decision, not each technical slice.
