# S3 acceptance report — isolated synthetic pilot

2026-10-03: **S3 ACCEPTED / CLOSED** by explicit Owner decision. Accepted pilot implementation `ca7e5db`; migration `20261003064848_inventory_s3_assets.sql` applied to isolated pilot `kwpyukofofoaqhmxndlc`. Production and real P1 stock remain NOT AUTHORIZED.

| Gate                      | Status             |
| ------------------------- | ------------------ |
| G0                        | DONE               |
| S1                        | ACCEPTED / CLOSED  |
| S2                        | ACCEPTED / CLOSED  |
| S3 Implementation         | DONE               |
| S3 Remote Pilot Migration | DONE               |
| S3 Targeted Acceptance    | PASS               |
| S3 Owner Acceptance       | ACCEPTED           |
| S3                        | ACCEPTED / CLOSED  |
| P1 Real Operational Stock | NOT AUTHORIZED     |
| Production Cutover        | NOT AUTHORIZED     |
| S4 Implementation         | NOT YET AUTHORIZED |

Do not reopen S3 without a new functional/data/security blocker. Accepted scope is the implementation below, including S3 authorization, mobile behavior and S1/S2 regression compatibility. This closure changes documentation only; the evidence below records prior execution, not a fresh runtime certification. `medlabs-OPs` remains local-only. Next authorized work is source/workflow comparison to identify S4 delta, not implementation or redesign of S1–S3.

## S3 implementation boundary

- **Canonical assets:** `public.equipment_assets` tracks exact physical assets. Server generates immutable `EIU-AST-XXXXXXXX` codes.
- **Qualified serial uniqueness:** manufacturer serial is nullable; when present, it requires manufacturer + model and enforces uniqueness on `(lower(btrim(manufacturer)), lower(btrim(model)), lower(btrim(manufacturer_serial)))` across SKUs. Same serial with a different maker or model is permitted.
- **Deduplication:** unique constraint `(intake_kind, intake_reference, row_key)` prevents double posting from the same source row independently of the network retry key.
- **Shared transaction header:** operations extend `inventory_transactions` (`ASSET_RECEIVE`, `ASSET_OPEN`, `ASSET_SET_STATE`, `ASSET_SET_LIFECYCLE`, `ASSET_CORRECT`). Events link via `transaction_id`. **Zero quantity lines are created; exact assets never double-count into quantity balances.**
- **Lifecycle and physical condition:** lifecycle (`registered`, `in_service`, `inactive`, `retired`, `disposed`) remains orthogonal to operational condition (`ready`, `in_use`, `under_maintenance`, `damaged`, `prohibited`).
- **Owner-approved decisions:**
  - Admin may reactivate `retired` to `in_service` with reason and evidence.
  - `disposed` assets cannot undergo ordinary reactivation.
  - Corrections reference prior events on the same asset and append new history without rewriting posted snapshots.
  - Required-expiry and opening corrections remain Admin-only.
- **Derived eligibility:** computed dynamically as `in_service` + `ready` + active item/location + valid required expiry. No reservations or future commitments.
- **Standards-compliant QR:** encodes **bare asset_code only**, rendered as an SVG quiet-zone tag. Authenticated exact lookup checks current eligibility without public leakage.
- **UI and navigation:** `/inventory/assets`, receive, opening, detail, paginated immutable history, responsive light layout, and transaction detail routing.

## Verification evidence

- **RUN AND PASS:** TypeScript typecheck (`tsc --noEmit`) clean across the repository.
- **RUN AND PASS:** Scoped ESLint on new S3 asset code has 0 errors and 0 warnings.
- **RUN AND PASS:** 18 pgTAP database constraint and immutability assertions in `supabase/tests/inventory_s3_integration.sql`.
- **RUN AND PASS:** 14 automated integration scenarios in `tests/inventory-s3.test.mjs`.
- **RUN AND PASS:** 30 impacted S1/S2 regression tests (`tests/inventory-s1.test.mjs` and `tests/inventory-s2.test.mjs`).
- **RUN AND PASS:** Independent Node QR decoding verified that generated tags encode only the institutional code `EIU-AST-1398A8DB`.
- **RUN AND PASS:** Real browser flows:
  - Admin opening from manifest `S3UI_C553F0`, creating code `EIU-AST-1398A8DB`.
  - Initial `registered` state correctly flagged as ineligible.
  - Admin commissioning to `in_service` evaluated as eligible.
  - QR exact lookup resolved eligibility without false availability.
  - Narrow viewport (390px) rendered with zero horizontal overflow (`scrollWidth === clientWidth === 390px`).
- **RUN AND PASS:** Remote pilot database migration applied (`20261003064848_inventory_s3_assets.sql`).
- **RUN AND PASS:** Remote pilot rollback smoke verified authenticated intake, duplicate prevention, commissioning, damage transition, retirement, retired reactivation, fact correction, immutable history, and zero quantity lines. Rollback confirmed 0 residual synthetic assets or actors.
- **RUN AND PASS:** Pre-push changed files hygiene check passed.

## Recommended limitations

- Full WCAG 2.2 AA accessibility and cross-browser visual certification remain NOT_RUN (plain semantic elements and accessible labels used, but comprehensive assistive technology testing was not conducted).
- Control-plane documentation in `medlabs-OPs` remains local-only because its remote is inaccessible.
- P1 real operational stock, production database cutover, Vercel deployments, and S4 reservation/handover workflows remain NOT AUTHORIZED.
