# S3 Serialized Asset + QR API

Owner-authorized S3 under control-plane INV-052; implementation verification in progress. S1/S2 remain accepted. This document mirrors the bounded application contract, not the entire local control plane.

## Canonical identity and invariants

`equipment_assets` stores exact institutional physical identity, never quantity balance. Server-generated `EIU-AST-XXXXXXXX` code is mandatory, unique and immutable. Manufacturer serial nullable; when present requires manufacturer/model and is unique on trimmed case-insensitive **manufacturer + model + serial across SKUs**. Different manufacturer/model may share serial. Unknown serial alone cannot prove duplicate physical identity; stable intake tuple `(kind, intake_reference, row_key)` prevents duplicate posting independently of retry key.

Existing catalog must be serialized/discrete; item/source-line/location/profiles are reused. First asset fact locks sensitive item semantics and source-line item linkage. Existing `inventory_transactions` headers own posting metadata; `equipment_asset_events` are immutable typed exact-asset effects with before/after snapshots and correction reference. No quantity transaction lines, stock facts or balance increments. All mutations append audit and replay atomically.

## Authorization

Active Admin/Staff only, checked from current profile/roles, not user metadata or client flag. Admin-only opening and lifecycle; opening/required-expiry corrections Admin-only. Staff/Admin receipt, observed physical-state update and ordinary receipt metadata correction. RLS permits authorized reads; direct client writes denied. RPC privilege precedes replay and matches current authority after profile locking. Existing conservative Inventory writer lock orders S1/S2 and exact-asset writes.

Replay identity is actor + S3 family + retry UUID. Same actor/key/different S3 operation or payload rejected; other actors and quantity operations keep independent namespaces. Null/unknown operations rejected before replay. Expected revision required for every existing-asset mutation.

## Commands

`equipment_asset_command(p_operation text, p_payload jsonb, p_retry_key uuid)` returns `{id, asset_code, revision, event_id, transaction_id}`.

All commands require `reason`, `evidence_note`; optional `occurred_at` defaults server-side. Code never caller supplied.

| Operation             | Payload                                                                                                                                                                                   | Authority                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `receive_asset`       | catalog_item_id, source_line_id, location_id, intake_reference, row_key; optional manufacturer/model/manufacturer_serial, custodian_id, operational_status, expiry_precision/expiry_input | Admin/Staff                                                 |
| `open_asset`          | Same, source_line optional; reference denotes opening manifest                                                                                                                            | Admin                                                       |
| `set_asset_state`     | id, expected_revision, location_id, explicit nullable custodian_id, operational_status                                                                                                    | Admin/Staff                                                 |
| `set_asset_lifecycle` | id, expected_revision, lifecycle_status                                                                                                                                                   | Admin                                                       |
| `correct_asset`       | id, expected_revision, corrects_event_id; explicit manufacturer/model/manufacturer_serial/expiry_precision/expiry_input snapshot                                                          | Admin for opening or required expiry; otherwise Staff/Admin |

Correction snapshot fields cannot be omitted (explicit null is distinct). Asset code/catalog/intake identity cannot be corrected through generic JSON patches. Corrected event must belong to this asset; original event remains unchanged.

## Lifecycle and eligibility

Initial intake is `registered`. Lifecycle is separate from `ready | in_use | under_maintenance | damaged | prohibited` operational status. Admin can commission registered/inactive/retired into `in_service`, inactivate registered/in_service, retire registered/in_service/inactive, or dispose registered/in_service/inactive/retired. **Admin retired reactivation is Owner-approved with reason/evidence. Disposed has no ordinary reactivation.** No automatic ready or lifecycle transition from physical-state changes.

Current location/custodian is observed inventory custody, not formal handover/loan/return. Eligibility is derived from in_service + ready + active catalog/location + required expiry known and not expired on Asia/Ho_Chi_Minh business date. No reservation/future availability promise. Day/month precision is retained; month input is YYYY-MM and normalizes to month-end. Unknown expiry allowed only for Admin opening; receipt requires known expiry when required. Physical expired assets remain recorded but ineligible.

## Reads and UI

`equipment_asset_read(p_resource text, p_filters jsonb)` returns `{rows,total}`, deterministic pagination capped at100.

- `assets`: q, catalog_item_id, location_id, lifecycle_status, operational_status, page/page_size.
- `detail`: id.
- `lookup`: exact asset_code; invalid/unknown rejected, ineligible identity returned with explicit reasons, no mutation/reservation.
- `history`: exactly one of id or transaction_id, with page/page_size. Immutable snapshots, actor, reason/evidence, corrected-event and shared transaction identity.

Routes `/inventory/assets`, `/inventory/assets/[assetId]`, `/inventory/assets/receive`, `/inventory/assets/opening`. Generic ASSET_* transaction detail resolves to canonical asset detail, not an empty quantity screen. Shared transaction list supports exact-asset operation labels/filters.

QR contains **only asset_code**, no manufacturer serial, custody, cost, token or sensitive URL. Server uses pinned qrcode1.5.4 SVG generation with standard quiet zone; authenticated manual/hardware scanner lookup. No public asset endpoint or camera requirement.

## Boundaries

No S4 allocation/reservation, handover/return/recovery, Basic Medical cutover, real P1 stock, production mutation or Vercel deployment. Migration `20261003064848_inventory_s3_assets.sql` is the forward artifact; `supabase/schemas/36_inventory_s3_assets.sql` is declarative source. Pilot delivery and executed evidence recorded separately; this API document alone is not PASS or Owner acceptance.
