# Inventory functional browser UAT — 2026-10-05

**UI/UAT ACCEPTED — exercised pilot flow only.** No visual redesign, WCAG certification, production-readiness or operational P1 claim.

## Runtime and provenance

- Canonical isolated pilot: `kwpyukofofoaqhmxndlc`. The previous recap typo did not reflect an environment change; evidence, CLI, API and actual browser server agree.
- Local browser runtime: `http://127.0.0.1:3107`, genuine Next.js application and fresh pilot test-user login. Canonical `.env.local` unchanged; privileged pilot key confined to the disposable server process, never browser/public variables or evidence. No email provider configured.
- Retained completed bridge records were read, never reset or rewritten. New five-archetype request `a3b754ae-d09d-497d-a0a2-04e9e01237a5`, UAT batch `ac0333d3-712e-4c59-b199-d6e0e5e3584a`, is explicitly **SYNTHETIC BRIDGE DATA**, not another production-derived source row. It reuses separately fictional mappings/stock from bridge `9357eafd-77de-43ef-a436-b320b51f1bea`.
- [Exact RPC/browser/reconciliation evidence](INVENTORY_UI_UAT_EVIDENCE_AC0333D3.json), canonical SHA-256 `581742532269ca2830e9c171ab0f261207caf6fe153f086f19cd3ae96454d7c3`. Sixteen retained PNGs have exact viewport/route/scroll metadata and SHA-256 bindings in that artifact.
- Replay retained with audit `72a038ac-db48-4c95-ba33-1772aeac1b47`, action `inventory.synthetic_ui_replay.retained`, at `2026-10-05T04:42:45.978193Z`. Append-only format-correction audit `69ff7cf8-af63-4b40-88f2-071ffa0af984` binds the canonical hash above to original capture hash `396d4e05ffcada0ddadbc848f6f2e860af1762b668cbf50690bae064105e4c2e` at `2026-10-05T04:48:24.231217Z`: Prettier whitespace only, exact parsed evidence equal. Both control-plane actor_ids are null, not impersonated users; no stock/phase/schema change. Initial approval-table/schema and correction-query syntax errors were rejected/rolled back before insertion, then corrected.

## Exercised acceptance

| Surface               | Evidence     | Observed behavior                                                                                                                                                                                                                                                       |
| --------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request / Preparation | RUN AND PASS | Rendered registered baseline; Staff Start; five mapped source allocations/current revision review; exact asset checkbox; draft has zero hard reservations; confirm PREPARED has five reservations and no on-hand delta.                                                 |
| Adjustment            | RUN AND PASS | Requester proposes soap absolute 1 while registered/planned remain 2; pending does not alter live plan; Staff rejects and preserves 2.                                                                                                                                  |
| Handover              | RUN AND PASS | Five actual issue rows; sanitizer actual 500 mL versus planned 750 mL with explicit reason; exact `EIU-AST-917EED08`; stock/custody changes before signing.                                                                                                             |
| Signature             | RUN AND PASS | Real pointer canvas for handover and initial return; permitted participant signs exact event; Staff sign action absent, authenticated wrong-signer RPC returns `AUTH_DENIED` / `42501`; signatures do not change stock/custody. Reload has no duplicate signing action. |
| Return / Recovery     | RUN AND PASS | Holder 1 good + 1 damaged; bin 1 good leaves due 1, later cumulative 1 damaged settles it; exact pump returns ready/no custodian; consumables have no fake receipt; request completes.                                                                                  |
| History / Audit       | RUN AND PASS | Expanded immutable event payloads and signatures; completed reload/refresh; preparation link navigation and loaded start/confirm/propose/reject audit; existing completed records retained.                                                                             |
| Roles                 | RUN AND PASS | Staff physical controls; Admin-only consequence/reconcile; requester read/adjust/sign without physical actions; unrelated test lecturer gets scoped 404. No standalone TA-fixture claim.                                                                                |
| Browser               | RUN AND PASS | Desktop 1440×1000 and practical mobile 390×844; native selects, real pointer signing, sidebar overlay, stock cohort expand/close, horizontally scrollable stock/cohort tables, usable notification popover after fixes.                                                 |
| Physical retry        | RUN AND PASS | Native Auth retries of the exact three already-posted UI handover/return/recovery payloads and keys return identical results; full workspace/stock/asset readback unchanged. No simulated network-loss UI retry claim.                                                  |

## Two surgical UI fixes

1. `components/equipment-fulfillment-workspace.tsx`: initial-return/recovery picker exposed `return_required=false` soap/sanitizer despite zero due. Receiving operations, including receiving corrections, now list only return-required issues; staging resolves only a currently valid selection. Hidden stale/empty selection shows the existing selection error rather than staging an invalid receipt. The real mobile return/recovery flow passed after this correction.
2. `app/globals.css`: mobile notification panel was right-aligned to a left-side bell (`x=-306..56` at 390 px) and its contents were covered by a later nested sticky header. Reuse the existing 820 px breakpoint for left alignment; only the outer workspace header gets stacking level 36, above nested level 35. After: mobile bounds `16..378`; desktop bounds `1020..1410` at 1440 px. Both panel buttons pass real hit-target checks; screenshots show the complete panel above page content.

No RPC, migration, RLS, role grant, stock model or schema changes.

## Reconciliation and containment

**RUN AND PASS:** 24 quantity-ledger rows reconcile all eight balance dimensions with zero mismatch. Final synthetic good/damaged: sanitizer 4,000/500 mL; soap 6/2 bottles; holder 8/4 pieces; bin 8/4 pieces. Exact pump ready/revision 6/no custodian; zero serialized quantity-ledger rows. Three requests completed; due, holds and active reservations zero.

**RUN AND PASS:** original full P1 state/events/physical facts/identities equal the pre-bridge snapshot at `2026-10-05T04:37:58.031Z`. Original two completed requests/lines/events/signatures have unchanged SHA-256 `4bfbe5595c81c47b365bb547a9e5342493329ace338d1b99e1510dfb373f80a6`. Original snapshot bytes remain unchanged. P1 remains PAUSED; email off; real scopes and Owner approvals zero; outboxes suppressed with invalid test addresses only. No production access/write, real writer freeze, real opening/ACTIVE, deployment or source credential copying.

## Verification and harness corrections

- **RUN AND PASS:** actual headed Chromium browser flows and sixteen retained screenshots; readback through native `@supabase/supabase-js` Auth/RLS/public RPCs and read-only pilot reconciliation.
- **RUN AND PASS:** `npm run typecheck`; ESLint on the changed React component; Prettier check on both changed source files; `node --test --test-concurrency=1 tests/inventory-s5.test.mjs` — 5 tests covering actual local DB stock/exact-asset concurrency and idempotency.
- **NOT RUN — NOT REQUIRED FOR CURRENT IMPACT:** full suites, build, deployment, full WCAG audit. No blanket PASS.
- Harness-only failures were not hidden as initial PASS: stale assistant dev-child lock, native-dialog dismissal policy, SDK default global signOut invalidating browser sessions, selector/loading/viewport/result-envelope assumptions. Teardown uses local-session signOut; UI reauthenticated without replaying successful mutations. No speculative product auth/config fixes.
- Safe fallback rule retained: on observed Astra limit/fallback/model unavailability, preserve nearest verified checkpoint, exact evidence and resume step, then stop new mutations/slices pending Owner continuation.

## Delivery boundary

Owner authorizes commit/push of only these verified task-owned pilot UI fixes and new UAT evidence. Prior snapshot/bridge artifacts and canonical OPS continuity remain local-only; never push to upstream production repository. Disposable browser/server runner is removed after proof. Real operational Inventory still requires separate stock/mapping/expiry/serial evidence, writer isolation and Owner opening/ACTIVE authority. A new executable lifecycle needs another separately identified synthetic replay, never a reset of signed/completed history.
