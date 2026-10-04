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

### Current bounded P1 extension — 2026-10-04

Owner separately authorized the real-opening gate and credential rotation only on the isolated pilot, superseding historical no-rotation restrictions. Migration `20261004160000_inventory_p1_real_opening_gate.sql` is applied/history-registered remotely; private Owner-approved exact manifest and separate activation authority, named Admin OPENING_READY opening, writer evidence, exact asset, atomic retry/duplicate and reconciliation gates are installed. No real approval rows or real scopes exist; the form remains synthetic.

**RUN AND PASS:** 56/56 Inventory Node tests, eight Inventory pgTAP suites/168 checks plus repaired preparation fixture/24 checks, TypeScript, new-secret SDK Auth/Data reads, new DB password over verified TLS, and full original mock marker/physical snapshot equality at `2026-10-04T16:27:59.327Z`. The three pilot memberships and all 522 historical local memberships retain their accepted fingerprints; 20 additional local Node fixture memberships are not historical cleanup or operational enrollment.

**API retirement RUN AND PASS:** old modern/legacy keys denied; delayed exact old bearer Auth denial HTTP 403 `bad_jwt`, Data denial HTTP 401, Storage denial HTTP 400/body 403; new-secret controls HTTP 200. Earlier Auth acceptance was observed, but its cause is unestablished. **DB closure NOT RUN — BLOCKED:** reset and new verified-TLS login succeeded; original-password negative login cannot run because its plaintext is unavailable. Current secret/password are held only in Windows Credential Manager `MedLabs Pilot:kwpyukofofoaqhmxndlc`; app loopback environment, original project and production untouched. [Exact contract, proofs and prerequisite](P1_MOCK_READINESS.md#bounded-real-opening-gate-and-pilot-rotation--2026-10-04).

Do not close the full rotation mandate or start real P1. Supply the original DB password securely for its negative login; then obtain real manifest/cutoff, actual single-writer isolation, Admin opening/reconciliation and explicit Owner ACTIVE authority. OPS stays local-only; authorized Git delivery is pilot origin only.

## Nursing authority checkpoint — 2026-10-04

**Owner ACCEPTED / CLOSED — `2929440`.** The Nursing authority interruption is closed; all three approved pilot mock memberships and all 522 local legacy memberships remain retained. No personnel cleanup is pending or authorized. Return to the INV-062 mock P1 checkpoint above: implementation/runtime verified, final PAUSED; S1–S5 remain ACCEPTED / CLOSED. This acceptance does not authorize real stock, writer freeze, opening/activation, rotation or production work.

Owner separately authorized the Nursing authority fix on isolated pilot `kwpyukofofoaqhmxndlc`; migration `20261004120000_explicit_profile_room_type_authority.sql` is history-registered remotely after a single-migration dry-run. `RUN AND PASS`: real remote Auth/JWT proved zero role/scope provisioning, no-role scoped-read denial, Lecturer grant/last-role revocation, and Admin override. Staff routing was exercised through current source with actual remote states; Basic-only Staff did not acquire Nursing data access. Temporary verification fixtures/session were removed.

The pilot has **3 legacy memberships**, all existing synthetic mock actors with documented Nursing intent; **522 is the separate local baseline**. Both datasets' ordered-row fingerprints are unchanged. Read-only local audit found 515 default-compatible Nursing rows, including 275 active non-Admin role-bearing subjects needing scope-intent review; attribution alone does not authorize deletion. No legacy cleanup was performed. [Security checkpoint and exact audit groups](workflows/personnel-security/README.md#isolated-pilot-checkpoint--2026-10-04).

This checkpoint does not reopen Inventory/P1 or change its marker, physical facts, lifecycle gates, or operational authorization. It does not deploy an application or mutate original/current MedLabs production.
