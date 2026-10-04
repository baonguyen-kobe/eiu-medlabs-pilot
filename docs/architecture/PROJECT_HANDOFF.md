# EIU MedLabs Inventory — Pilot Handoff

Updated 2026-10-04. **G0 DONE; S1–S5 ACCEPTED / CLOSED.** INV-059 accepts S5 `bdba8d6`; INV-061 approved mock preparation; INV-062 authorizes the actual synthetic marker delta. [Mock runtime checkpoint](P1_MOCK_READINESS.md): implemented and verified on the isolated pilot, final **PAUSED**, not real operational P1 or production.

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
- Prior provisioning output exposed sensitive pilot credentials. INV-046 requires separately authorized, verified rotation before real operational data/use. Rotation is not verified by S1–S5 acceptance; no secrets belong in docs/Git or browser client config.

## Current contract

Existing Equipment Request owns demand, workflow events and signatures; Inventory owns physical effects. Retain quantity + serialized, canonical equipment_assets, exact asset/QR, no duplicate request/procurement/user system, existing MedLabs security/evidence boundaries and staged Basic Medical integration.

Q1 physical issue precedes signature; Q2 controlled initial and supplemental over-plan actual under INV-058; Q3 controlled multi-source allocations; Q4 actual transfer-back prerequisites before preparation reversal; Q5 good/damaged; Q6 Staff recovery waiver zero stock delta/Admin disposition; Q7 new late-return/offset and Admin settlement reconciliation; Q8 initial-return signature for all requests; Q9 fixed-room in-place vs session consumable vs portable returnable; Q10 no time-window reservation/clock release. F1 chemical expiry without business lots; F2 per-receipt conversion/stable base unit; F3 Skills Lab/Admin opening.

INV-041–046 close return/expiry/late-intake/strategy/single-writer/security policy; INV-059 closes S5. Replacement candidate target, port-back fallback. The approved S1–S5 contracts and accepted implementation remain the reusable baseline; historical UNDER_REVIEW labels do not revoke later approval. [S5 acceptance](INVENTORY_S5_ACCEPTANCE.md) records accepted delivery and historical verification, not operational readiness.

## Current action and gates

**INV-062 MOCK P1 implementation/runtime verification complete.** Schemas 55–64 and migration `20261004050000_inventory_p1_mock_markers.sql` are applied/history-registered locally and on `kwpyukofofoaqhmxndlc`. Exact remote baseline was adopted without reposting or relabeling; marker is PAUSED, opening confirmed, eight writers evidenced, original asset bound, no unresolved discrepancy. [Actual evidence](P1_MOCK_RUNTIME_EVIDENCE.json) records rollback integrity/four real-session races/unchanged physical facts. Local 55/55 Inventory tests and all nine Inventory pgTAP suites passed; typecheck and task-owned quality checks passed. Independent reviews closed scoped findings. Broader Node/DB suites remain failing on separately classified unchanged baseline debt; full shadow diff is blocked by pre-existing declarative source issues. See the runtime checkpoint for exact limits, safe readback and pilot-only delivery; never reset/reseed the immutable manifest.

P1 real operational stock, real writer freeze/activation, Basic Medical cutover, production credential rotation, Vercel deployment, upstream push and production mutation remain **NOT AUTHORIZED**. OPS remains local-only.
