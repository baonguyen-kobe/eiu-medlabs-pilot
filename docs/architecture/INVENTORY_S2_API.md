# S2 physical inventory API

Status: implementation and targeted technical verification complete; VERIFY pending Owner acceptance. Authority: Owner-approved S2 delta and control-plane INV-050. Extends [accepted S1](INVENTORY_S1_API.md); see [executed evidence](INVENTORY_S2_ACCEPTANCE.md).

## Storage and security

Migration: `supabase/migrations/20261003030000_inventory_s2_operations.sql`; declarative authority: `supabase/schemas/35_inventory_s2_operations.sql`. Adds three tables (`inventory_stocktake_surplus_records`, `inventory_stock_holds`, `inventory_stock_evidence`), surplus origin FK and monotonic cohort `revision`. Existing ledger and `inventory_stock_balances` remain the sole stock accounting path.

Active Admin/Staff may read and execute physical operations; only active Admin may verify/release surplus. Authorization and operation-specific privilege checks occur before retry replay. RLS permits role-gated SELECT, not direct client mutations. Facts, ledger and evidence are immutable; initial surplus count fields cannot be rewritten. Existing global transaction writer lock serializes commands.

All operations use `inventory_command(p_operation,p_payload,p_retry_key)`. Decimal quantities are strings. Each selected cohort line carries `expected_version` (fact) and `expected_stock_revision` (movement). No token aliases. A multi-condition batch validates the pre-command cohort snapshot and increments movement revision once per affected cohort. Old physical counts must not be silently rebased onto newly fetched tokens.

## Commands

| Operation                   | Payload                                                                                                                                                       | Result             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `transfer_stock`            | `source_location_id`, `target_location_id`, `occurred_at`, `reason`, `lines: [{origin_id,condition,quantity,expected_version,expected_stock_revision}]`       | `transaction_id`   |
| `change_stock_condition`    | `location_id`, `occurred_at`, `reason`, `lines: [{origin_id,from_condition:'good',to_condition:'damaged',quantity,expected_version,expected_stock_revision}]` | `transaction_id`   |
| `reconcile_stocktake`       | `stocktake_reference`, `location_id`, `count_timestamp`, `reason`, `evidence_note`, `lines` below                                                             | `transaction_id`   |
| `verify_stocktake_surplus`  | Admin only: `origin_id`, `action:'release'`, both freshness tokens, `reason`, `evidence_note`, optionally verified `expiry_precision` and `expiry_input`      | `transaction_id`   |
| `append_stocktake_evidence` | `origin_id`, `reason`, `evidence_note`; append-only, no freshness token                                                                                       | `id` (evidence ID) |

Transfer posts paired source debit/destination credit, retaining the origin, condition, fact/expiry and hold. Condition change posts good debit/damaged credit at one location; repair is excluded. Neither operation fabricates an intake or changes provenance.

### Count lines

`{type:'count', origin_id, condition, counted_quantity, expected_quantity, expected_version, expected_stock_revision}`.

The server locks and validates current stock, derives `counted_quantity - current_quantity`, and atomically writes signed ledger/balance changes. Zero delta has no artificial ledger line but retains immutable evidence. Evidence includes validated location, count time, transaction, fact/stock tokens, expected/count/delta quantities, condition and stocktake reference. Such evidence prevents rewriting the original intake through S1 correction paths.

`stocktake_reference` is a business identity independent of transport retry key. Reusing it with a different retry key cannot create duplicate surplus/count postings.

### Surplus lines

`{type:'surplus', catalog_item_id, condition, counted_quantity, evidence_note, expiry_precision, expiry_input?}`.

Creates its own surplus record/origin and immutable fact, with `provenance_group='STOCKTAKE_SURPLUS'`. Purchase/source/receipt history remains unknown; do not assign an arbitrary existing cohort. Physical stock is on-hand immediately but held/non-issueable. Hold follows origin across locations.

Admin may release non-expiry stock from count evidence alone. Chemical/required-expiry surplus with unknown expiry cannot be released until verified day/month expiry is supplied. Releasing a hold does not bypass good-condition, active item/location or unexpired-stock eligibility. Later evidence is appended, never backfilled into the original count or receipt.

## Reads

All use the S1 `{rows,total,page,page_size}` envelope (page size capped at 100).

- `operation_stock`: dimensional cohort/location/condition rows, including zero balances needed for count workflows. Filters include `origin_id`, `item_id`, `location_id`, `condition`, `active`, `is_held`, `include_held`, `provenance_group`, `q`, paging/sort. Provenance filters apply before count and pagination. Fields include exact quantity/available quantity, `current_version`, `stock_revision`, hold and expiry/provenance data.
- `stock_evidence`: origin-scoped paginated immutable evidence with actor, action, note, metadata and posting time.
- `cohorts`: actual positive locations, distinct from historical intake. `location_state` is `single`, `split` or `depleted`; `current_location_*` is null for unfiltered split/depleted cohorts. `locations` exposes dimensional location IDs/codes/names and good/damaged/physical balances. A location filter scopes quantities and requires actual positive stock there.
- `balances`/`cohorts` eligibility excludes active holds. Eligibility filters and returned eligible totals use the same condition/activity/expiry/hold predicates.
- `transaction_detail`: includes origins associated through physical ledger lines or count evidence, including zero-delta counts. Evidence history is reachable from transaction/verification UI.

## UI and scope

`/inventory/operations?tab=transfer|condition|stocktake|surplus`, linked from stock. Optional `location_id` and `origin_id` preselect a dimensional workflow. History remains `/inventory/transactions` and its transaction details.

No S3, repair, assets/QR, reservations, issue/handover/return, real P1 cutover, production or Vercel deployment. Isolated pilot delivery and evidence are recorded in the S2 acceptance report; this API document is not a verification claim.
