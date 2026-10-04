# P1 mock marker and runtime evidence

2026-10-04 · INV-062 · **MOCK MARKERS / GATES IMPLEMENTED AND RUNTIME VERIFIED**. This is actual synthetic DB enforcement, not real operational P1 or production readiness. S1–S5 remain ACCEPTED / CLOSED. Canonical authority: [OPS Activation Plan](../../../medlabs-OPs/plans/P1_READINESS_REVIEW.md), local OPS INV-062 and [approved implementation supplement](../../openspec/changes/inventory-p1-mock-markers/proposal.md).

## Exact immutable synthetic baseline

- Target: isolated pilot `kwpyukofofoaqhmxndlc`. Original MedLabs `bwhiivfhezoozrzvchmm` was not targeted.
- [Manifest](P1_MOCK_MANIFEST.json): scope `a27c1f6d-089e-43c5-93e1-4ca7f539b6a5`, version 1; manifest `2a312d76-1381-4a05-bea8-747576eab135`; opening `P1-MOCK-ACC2B31A-OPEN-V1`.
- Location `dbae2f2a-ebb7-4706-b87d-15731e79d840`, `P1-MOCK-ACC2B31A-SKL`: Kho thực hành điều dưỡng — MOCK ACC2B31A.
- New `nursing_skills` requests only, created after the approved cutoff; four frozen catalog items, this location and exact serialized identity. No Basic Medical, old requests, legacy obligations or whole-Lab enrollment.
- Manifest and INV-061 historical evidence remain unchanged, including their historical simulation/runtime flags. Current implementation evidence is a separate artifact.

| Named mock actor            | Role  | ID                                     |
| --------------------------- | ----- | -------------------------------------- |
| Nguyễn Minh An — MOCK Admin | admin | `b45ebb24-7dbb-4071-b5e7-7785b52587d7` |
| Trần Thu Hà — MOCK Staff 1  | staff | `6b8f91e8-d47f-4445-b105-ae3124d349cb` |
| Lê Quang Huy — MOCK Staff 2 | staff | `da210218-38de-462f-82c6-b68c3b8e9444` |

These active Auth/profile/role records use `example.invalid`, synthetic scope metadata, disabled schedule email and no passwords. Runtime uses controlled authenticated-role JWT claims in SQL, **not browser sign-in or interactive UAT**. No invitations, passwords or real credential changes were performed.

| Item suffix | Tracking / return        | Base unit          |    Good | Damaged | Expiry                 |
| ----------- | ------------------------ | ------------------ | ------: | ------: | ---------------------- |
| `GLOVE`     | quantity / nonreturnable | cái, count scale 0 |     100 |       5 | not_required           |
| `TRAY`      | quantity / returnable    | cái, count scale 0 |      12 |       1 | not_required           |
| `PUMP`      | serialized / returnable  | cái, count scale 0 | 1 asset |       0 | not_required           |
| `ETOH70`    | quantity / nonreturnable | mL, volume scale 6 |   1,400 |       0 | required; four origins |

Chemical origins: 1,000 mL day `2027-12-31`; 250 mL month `2028-03` normalized to `2028-03-31`; 100 mL unknown; 50 mL expired `2026-09-30`. Eligible quantity remains 1,250 mL. Never sum different units or count serialized assets as quantity stock.

Original quantity batch `91dbc282-6f74-474f-b043-0829f44af420`, transaction `8b73f005-378f-46d1-806c-ad0f0762b199`; 6 origins, 3 opening scope claims, 8 ledger lines. Exact asset `ba23929b-1d45-45e1-892e-2d91fd42e1a2` / `EIU-AST-7F86198D`, maker MedLabs Training Devices — MOCK, model IP-100 training, serial `P1-MOCK-ACC2B31A-IP100-001`, intake row `pump-001`. Revision 2, in_service/ready; original opening event `c88ff97a-a547-470c-aa60-807217cfb96a` plus original commissioning event. Remote verification preserves all these physical rows and non-login identities exactly.

## Actual DB contract

Schemas `55_inventory_pilot_scope.sql`–`64_inventory_pilot_guard_installation.sql`; forward migration `20261004050000_inventory_p1_mock_markers.sql`, CLI-applied and history-registered locally and on the isolated pilot.

- Durable immutable scope/manifest/version, normalized membership, qualified pre-opening identity/generated-ID binding, eight writer entries and append-only actor/time/reason/evidence events. Admin transitions; named participants can read/reconcile/pause/report.
- Five public RPC signatures remain unchanged: quantity, asset, preparation, preparation transfer and fulfillment commands. Their original implementations are revoked private cores; optional `pilot` metadata is validated then excluded from original business retry hashes.
- Allowed physical writer entries: `inventory_command`, `equipment_asset_command`, `equipment_preparation_command`, `equipment_preparation_transfer`, `equipment_fulfillment_command`. Excluded entries: `legacy`, `privileged_import`, `manual_offline`. ACTIVE requires recorded evidence for all eight, not just an allowed-writer flag.
- Private transaction/backend-bound capability, not client GUCs. Existing `inventory:s1:writer` advisory mutex serializes transitions and physical writers. Row guards inspect every OLD/NEW item, location, canonical asset/cohort/mapping/request/slice/effect and transfer endpoint. Implicit binding enforces current frozen scope when metadata is omitted; explicit wrong project/scope/manifest/version fails.
- OPENING_READY permits named Admin synthetic opening only. Existing remote opening is adopted/confirmed using original provenance and original revision-1 asset event, never reposted. A new local synthetic manifest without generated asset IDs proves atomic UUID/code/event binding, duplicate prevention and retry behavior.
- ACTIVE requires complete opening rows and supplied IDs, original qualified ledger/facts/header, initial balances, exact bound asset/event, no unexpected initial stock/assets, required exclusions and no unexplained discrepancy. Historical opening remains qualified after legitimate later movement/fact corrections.
- PAUSED denies new physical writes, including Admin opening, direct owner/service DML, GUC spoofing, private-core calls and scoped truncation. Reads, audit, reconciliation, authorized pure replay and signatures with zero physical delta survive. Unrelated workflows remain unchanged; no automatic legacy reactivation.
- Competing-writer/discrepancy reports persist PAUSED and audit evidence; resolution does not reactivate. A failed SQL transaction cannot also persist its own pause: a separate successful report command is required. The observed remote dual-write report was **injected synthetic evidence**, not discovery of an actual offline/real competing writer.
- Database owner/superuser alteration of schema/triggers/private capability state is outside this installed-schema enforcement boundary. Ordinary privileged DML is covered; this is not protection against the database owner replacing the gate itself.

## Verification evidence

[Actual remote runtime evidence](P1_MOCK_RUNTIME_EVIDENCE.json) records target, manifest/migration/smoke SHA-256, real blocker PID chains, command outcomes, original physical rows and final durable marker. It is runtime evidence, not a cryptographic approval/signature. Staged hygiene required removal of terminal generator blank lines after migration application: `migration_sha256` retains the original executed bytes; `migration_repository_sha256` records the EOF-normalized repository file. Exact comparison proved terminal whitespace was the only difference; SQL statements and databases were not changed/reapplied.

- **RUN AND PASS:** `node --test --test-concurrency=1 tests/inventory-*.test.mjs`: 55/55 tests across existing S1–S5 and P1, including actual RPC smoke/rollback, 26 malformed opening baselines, generated serialized binding, canonical asset/cohort forgery denial, unrelated S4 confirm/cancel/delete and five local multi-session races. Local race includes a committed physical post/replay before PAUSED.
- **RUN AND PASS:** all nine Inventory pgTAP suites in the full `npm run test:db` execution. Existing Inventory quantity/serialized/preparation/fulfillment/correction/hold/resolution boundaries passed.
- **RUN AND PASS:** `node scripts/verify-p1-mock.mjs --remote`: comprehensive rollback-only RPC/denial probes, exact original fixture adoption, durable eight-writer register, four independent-session races, injected dual-write report/resolution, reconciliation and unchanged physical-row/identity snapshot.
- Remote races prove activation-before-confirmation denial; confirmation-before-activation with no repost; PAUSED-before-write denial; exactly one observed physical event/revision before queued pause. The successful remote physical probe **rolls back** to preserve the original fixture; it is not a retained remote physical commit.
- **RUN AND PASS:** `node scripts/verify-p1-mock.mjs --read-remote`: durable post-run PAUSED, exact manifest, original asset binding, complete writer evidence and original physical state.
- **RUN AND PASS:** generated actual local public DB types, TypeScript typecheck, task-owned JS ESLint and Prettier checks. Independent read-only authorization and data-integrity reviews found no remaining blocking finding in their assigned scope; reviews are not runtime PASS.
- **RUN AND FAIL:** broader `npm test` execution (412 tests: 343 passed, 68 failed, 1 skipped). The P1 null-operation defect from that run was repaired and covered by the later green Inventory regression. Other failures include `Invalid login credentials` for historical seeded accounts and CI workdir expecting `project_id = "lich-truc-app"` rather than the dedicated pilot config. No unrelated credentials/config were changed; no full-suite PASS is claimed.
- **RUN AND FAIL:** broader `npm run test:db` (35 files/844 tests): eight non-Inventory suites fail; the nine Inventory suites passed. Follow-up source review traces direct-DML revocation and missing revision to the prior S4 migration; it also identifies a pre-existing S4 quick-add/guard incompatibility, not merely stale test wording. Root/security-principal seed prerequisites are absent; the old operational-assignee predicate also rejects nonexistent/inactive targets using the generic Root error. Outbox fixture depends on a global 50-event batch; backlog interference is [INFERENCE], not observed diagnosis. These unchanged paths have no scoped physical backing and no INV-062 modification. They remain separate baseline debt; no tests/security controls were weakened and no full-suite PASS is claimed.
- **NOT RUN — BLOCKED:** full declarative shadow parity comparison: pre-existing `01_app.sql` syntax/source ordering prevents shadow construction (shadow-build attempts failed). That unrelated source is unchanged. The forward migration is the controlled concatenation of sources 55–64, with repository EOF whitespace normalized, and was actually CLI-applied on both authorized databases; no full shadow parity claim.
- **NOT RUN — NOT REQUIRED FOR CURRENT IMPACT:** frontend visual/a11y/UAT/deploy certification; this change adds no UI. Real manifest, real writer isolation and credential rotation remain separately authorized prerequisites.

## Historical INV-061 preparation — not runtime marker evidence

[P1_MOCK_EVIDENCE.json](P1_MOCK_EVIDENCE.json) retains fixture creation and model results: 16 actual opening assertions/7 denial probes, existing replay/business/scope/serial guards and authenticated readback; `node scripts/rehearse-p1-mock.mjs` retains 33 **SIMULATION_ONLY_NO_RUNTIME_ENFORCEMENT** assertions with no DB/network calls. Those historical model flags must not be rewritten as implementation evidence. The prior READY FOR MOCK P1 IMPLEMENTATION verdict is superseded only for this synthetic marker delta.

[Single-use fixture seed](../../scripts/prepare-p1-mock.mjs) refuses an existing manifest. Never run it again to repair this fixture or use it as a real-stock importer.

## Safe checkpoint / stop boundary

Remote scope remains **PAUSED**, opening confirmed, original asset bound, all eight writers evidenced, no unresolved discrepancy, reconciliation ready. Readback is safe with `node scripts/verify-p1-mock.mjs --read-remote`. The mutating `--remote` runner deliberately refuses an already registered scope: preserve durable history, never reset/reseed to rerun it.

Delivery is task-owned pilot `origin/main` only; exact commit is recorded in Git and local OPS continuity. Prior delivered checkpoint was `863bd9b`; accepted S5 remains `bdba8d6`. OPS remains local-only.

**STOP AT MOCK IMPLEMENTATION.** Real operational P1/stock, real writer freeze, real activation, rotation/revocation, Basic Medical cutover, production mutation/deploy and upstream/OPS push remain NOT AUTHORIZED. Synthetic facts are never relabeled real. No Astra unavailability/fallback notice was observed. If such a notice is observed later, preserve this marker/history/working tree, record the exact safe checkpoint and wait for Owner; do not start a new slice.
