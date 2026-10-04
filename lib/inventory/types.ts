export type InventoryResource =
  | "items"
  | "categories"
  | "uoms"
  | "suppliers"
  | "locations"
  | "sources"
  | "source_lines"
  | "source_receipts"
  | "summary"
  | "balances"
  | "transactions"
  | "cohorts"
  | "transaction_detail"
  | "operation_stock"
  | "stock_evidence";

export type InventoryOperation =
  | "create_inventory_item"
  | "update_inventory_item"
  | "inactivate_inventory_item"
  | "reactivate_inventory_item"
  | "create_acquisition_source"
  | "update_acquisition_source"
  | "create_acquisition_source_line"
  | "update_acquisition_source_line"
  | "confirm_opening_balance"
  | "receive_stock"
  | "correct_receipt"
  | "reverse_receipt"
  | "correct_opening_balance"
  | "verify_opening_expiry"
  | "create_inventory_category"
  | "update_inventory_category"
  | "inactivate_inventory_category"
  | "reactivate_inventory_category"
  | "create_inventory_uom"
  | "update_inventory_uom"
  | "inactivate_inventory_uom"
  | "reactivate_inventory_uom"
  | "create_inventory_supplier"
  | "update_inventory_supplier"
  | "inactivate_inventory_supplier"
  | "reactivate_inventory_supplier"
  | "create_inventory_location"
  | "update_inventory_location"
  | "inactivate_inventory_location"
  | "reactivate_inventory_location"
  | "transfer_stock"
  | "change_stock_condition"
  | "reconcile_stocktake"
  | "verify_stocktake_surplus"
  | "append_stocktake_evidence";

export type MaterialKind = "chemical" | "other";
export type TrackingStrategy = "quantity" | "serialized";
export type ReturnSemantics = "returnable" | "nonreturnable" | "in_place";
export type ExpiryPrecision = "not_required" | "day" | "month" | "unknown";
export type StockCondition = "good" | "damaged";
export type UomDimension = "count" | "volume" | "mass" | "package";
export type AcquisitionStatus = "active" | "voided";
export type TransactionOperationType =
  | "RECEIVE"
  | "OPENING"
  | "CORRECT_RECEIPT"
  | "REVERSE_RECEIPT"
  | "CORRECT_OPENING"
  | "TRANSFER"
  | "CONDITION_CHANGE"
  | "STOCKTAKE_ADJUST"
  | "STOCKTAKE_SURPLUS"
  | "VERIFY_SURPLUS"
  | "ASSET_RECEIVE"
  | "ASSET_OPEN"
  | "ASSET_SET_STATE"
  | "ASSET_SET_LIFECYCLE"
  | "ASSET_CORRECT";

export interface InventoryUom {
  code: string;
  name: string;
  dimension: UomDimension;
  allowed_scale: number;
  active: boolean;
  revision: string | number;
}

export interface InventoryCategory {
  id: string;
  code: string;
  name: string;
  active: boolean;
  revision: string | number;
}

export interface InventorySupplier {
  id: string;
  name: string;
  tax_code: string | null;
  contact: string | null;
  notes: string | null;
  active: boolean;
  revision: string | number;
}

export interface InventoryCatalogItem {
  id: string;
  code: string;
  name: string;
  category_id: string;
  category_name?: string;
  material_kind: MaterialKind;
  base_uom_code: string;
  base_uom_name?: string;
  base_uom_dimension?: UomDimension;
  tracking_strategy: TrackingStrategy;
  return_semantics: ReturnSemantics;
  expiry_required: boolean;
  active: boolean;
  revision: string | number;
}

export interface InventoryStorageLocation {
  id: string;
  code: string;
  name: string;
  parent_location_id: string | null;
  parent_location_name?: string | null;
  room_id: string | null;
  room_code?: string | null;
  active: boolean;
  revision: string | number;
}

export interface AcquisitionRecord {
  id: string;
  source_reference: string;
  supplier_id: string;
  supplier_name?: string;
  reference_date: string;
  funding_source: string | null;
  external_reference: string | null;
  notes: string | null;
  status: AcquisitionStatus;
  revision: string | number;
  line_count?: number;
}

export interface AcquisitionRecordLine {
  id: string;
  acquisition_record_id: string;
  line_key: string;
  catalog_item_id: string;
  item_code?: string;
  item_name?: string;
  expected_purchase_quantity: string;
  purchase_uom_code: string;
  purchase_uom_name?: string;
  expected_conversion_factor: string | null;
  unit_cost: string | null;
  currency_code: string | null;
  manufacturer: string | null;
  model: string | null;
  country_of_origin: string | null;
  warranty_start: string | null;
  warranty_end: string | null;
  notes: string | null;
  actual_base_quantity?: string;
  expected_base_quantity?: string | null;
  base_discrepancy?: string | null;
  packaging?: Array<{
    purchase_uom_code: string;
    conversion_factor: string;
    purchase_quantity: string;
    base_quantity: string;
  }>;
  received_base_quantity?: string;
}

export interface InventorySummary {
  active_item_count: number;
  active_source_count: number;
}

export interface InventorySourceReceipt {
  transaction_id: string;
  receipt_reference: string;
  origin_id: string;
  source_line_id: string;
  line_key: string;
  purchase_quantity: string;
  purchase_uom_code: string;
  conversion_factor: string;
  base_quantity: string;
  base_uom_code: string;
}

export interface InventoryStockBalance {
  cohort_id?: string;
  origin_id?: string;
  catalog_item_id?: string;
  item_id?: string;
  item_code: string;
  item_name: string;
  base_uom_code: string;
  base_uom_name?: string;
  location_id: string;
  location_code?: string;
  location_name: string;
  condition: StockCondition;
  quantity: string;
  eligible_quantity?: string;
  available_quantity: string;
  expired_quantity?: string;
  unknown_expiry_quantity?: string;
  expiry_precision?: ExpiryPrecision;
  expiry_date?: string | null;
  expiry_input?: string | null;
  is_eligible?: boolean;
  current_fact_id?: string;
  receipt_reference?: string | null;
  cutover_key?: string | null;
}

export interface InventoryStockOrigin {
  id: string;
  receipt_id: string | null;
  opening_batch_id: string | null;
  line_key: string;
  provenance_group: string;
  catalog_item_id: string;
  source_line_id: string | null;
}

export interface InventoryStockFact {
  id: string;
  origin_id: string;
  version: string | number;
  previous_fact_id: string | null;
  transaction_id: string;
  location_id: string;
  location_code?: string;
  location_name?: string;
  base_uom_code: string;
  purchase_quantity: string | null;
  purchase_uom_code: string | null;
  conversion_factor: string | null;
  base_quantity: string;
  good_quantity: string;
  damaged_quantity: string;
  expiry_precision: ExpiryPrecision;
  expiry_input: string | null;
  expiry_date: string | null;
  source_snapshot: Record<string, unknown>;
  evidence_note: string | null;
}

export interface InventoryTransaction {
  id: string;
  operation: TransactionOperationType;
  business_key: string;
  actor_id: string;
  actor_name?: string;
  occurred_at: string;
  posted_at: string;
  reason: string | null;
  corrects_transaction_id: string | null;
  lines_count?: number;
}

export interface InventoryTransactionLine {
  transaction_id: string;
  line_no: number;
  cohort_id: string;
  catalog_item_id: string;
  item_code?: string;
  item_name?: string;
  location_id: string;
  location_code?: string;
  location_name?: string;
  condition: StockCondition;
  quantity_delta: string;
}

export interface InventoryCohortDetail {
  origin_id: string;
  transaction_id: string;
  current_fact_id: string;
  catalog_item_id: string;
  item_code: string;
  item_name: string;
  base_uom_code: string;
  receipt_reference: string | null;
  cutover_key: string | null;
  provenance_group: string;
  current_location_id: string | null;
  current_location_code: string | null;
  current_location_name: string | null;
  location_state: "single" | "split" | "depleted";
  locations: Array<{
    location_id: string;
    location_code: string;
    location_name: string;
    physical_balance: string;
    good_balance: string;
    damaged_balance: string;
  }>;
  current_expiry_precision: ExpiryPrecision;
  current_expiry_date: string | null;
  good_balance: string;
  damaged_balance: string;
  physical_balance: string;
  eligible_balance: string;
  available_quantity: string;
  line_key?: string;
  remaining_quantity?: string;
}

export interface InventoryStockEvidence {
  id: string;
  origin_id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  note: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface TransactionDetailResult {
  transaction: InventoryTransaction;
  lines: InventoryTransactionLine[];
  facts?: InventoryStockFact[];
  origins: Array<{
    origin_id: string;
    line_key: string;
    catalog_item_id: string;
    item_code: string;
    item_name: string;
    base_uom_code: string;
    original_fact: InventoryStockFact;
    current_fact: InventoryStockFact;
    balances: Array<{
      location_id: string;
      location_name: string;
      condition: StockCondition;
      quantity: string;
    }>;
  }>;
}

export interface InventoryReadFilters {
  q?: string;
  id?: string;
  source_id?: string;
  origin_id?: string;
  item_id?: string;
  location_id?: string;
  condition?: StockCondition;
  active?: boolean;
  page?: number;
  page_size?: number;
  is_held?: boolean;
  include_held?: boolean;
  [key: string]: unknown;
}

export interface InventoryReadResult<T = Record<string, unknown>> {
  rows: T[];
  total: number;
}

export interface InventoryCommandResult<T = Record<string, unknown>> {
  id: string;
  revision?: string | number;
  transaction_id?: string;
  payload?: T;
}

export interface ReceiveStockLineInput {
  line_key: string;
  source_line_id: string;
  catalog_item_id: string;
  location_id: string;
  purchase_quantity: string;
  purchase_uom_code: string;
  conversion_factor: string;
  good_quantity: string;
  damaged_quantity: string;
  expiry_precision: ExpiryPrecision;
  expiry_input?: string;
  evidence_note?: string;
}

export interface ReceiveStockPayload {
  receipt_reference: string;
  occurred_at: string;
  lines: ReceiveStockLineInput[];
}

export interface OpeningStockLineInput {
  line_key: string;
  provenance_group: string;
  catalog_item_id: string;
  location_id: string;
  base_quantity: string;
  good_quantity: string;
  damaged_quantity: string;
  expiry_precision: ExpiryPrecision;
  expiry_input?: string;
  evidence_note?: string;
}

export interface InventoryPilotContext {
  project_ref: "kwpyukofofoaqhmxndlc";
  scope_id: string;
  scope_version: number;
  manifest_id: string;
}

export type ConfirmOpeningBalancePayload = {
  cutover_key: string;
  count_cutoff: string;
  scope_description: string;
  provenance_note: string;
  lines: OpeningStockLineInput[];
} & (
  | { synthetic: true; pilot?: InventoryPilotContext }
  | { synthetic: false; pilot: InventoryPilotContext }
);

export interface CorrectReceiptLineInput {
  origin_id: string;
  expected_version: string | number;
  location_id: string;
  purchase_quantity?: string;
  purchase_uom_code?: string;
  conversion_factor?: string;
  good_quantity: string;
  damaged_quantity: string;
  expiry_precision: ExpiryPrecision;
  expiry_input?: string;
  evidence_note?: string;
}

export interface CorrectReceiptPayload {
  transaction_id: string;
  reason: string;
  lines: CorrectReceiptLineInput[];
}

export interface ReverseReceiptPayload {
  transaction_id: string;
  reason: string;
  versions: Array<{
    origin_id: string;
    expected_version: string | number;
  }>;
}

export interface CorrectOpeningBalanceLineInput {
  origin_id: string;
  expected_version: string | number;
  location_id: string;
  base_quantity: string;
  good_quantity: string;
  damaged_quantity: string;
  expiry_precision: ExpiryPrecision;
  expiry_input?: string;
  evidence_note?: string;
}

export interface CorrectOpeningBalancePayload {
  transaction_id: string;
  reason: string;
  lines: CorrectOpeningBalanceLineInput[];
}

export interface VerifyOpeningExpiryPayload {
  origin_id: string;
  expected_version: string | number;
  expiry_precision: ExpiryPrecision;
  expiry_input: string;
  evidence_note: string;
  reason: string;
}

export interface InventoryOperationStock {
  cohort_id: string;
  origin_id: string;
  current_fact_id: string;
  current_version: number | string;
  stock_revision: number | string;
  catalog_item_id: string;
  item_code: string;
  item_name: string;
  material_kind: MaterialKind;
  expiry_required: boolean;
  base_uom_code: string;
  base_uom_name: string;
  location_id: string;
  location_code: string;
  location_name: string;
  condition: StockCondition;
  quantity: string;
  is_held: boolean;
  hold_reason: string | null;
  available_quantity: string;
  expiry_precision: ExpiryPrecision;
  expiry_date: string | null;
  expiry_input: string | null;
  provenance_group: string;
  receipt_reference: string | null;
  cutover_key: string | null;
  surplus_reference: string | null;
}

export interface TransferStockLineInput {
  origin_id: string;
  expected_version: number | string;
  expected_stock_revision: number | string;
  condition: StockCondition;
  quantity: string;
}

export interface TransferStockPayload {
  source_location_id: string;
  target_location_id: string;
  reason?: string;
  occurred_at?: string;
  lines: TransferStockLineInput[];
}

export interface ChangeStockConditionLineInput {
  origin_id: string;
  expected_version: number | string;
  expected_stock_revision: number | string;
  from_condition: "good";
  to_condition: "damaged";
  quantity: string;
}

export interface ChangeStockConditionPayload {
  location_id: string;
  reason: string;
  occurred_at?: string;
  lines: ChangeStockConditionLineInput[];
}

export interface StocktakeCountLineInput {
  type?: "count" | "adjustment";
  origin_id: string;
  expected_version: number | string;
  expected_stock_revision: number | string;
  condition: StockCondition;
  expected_quantity: string;
  counted_quantity: string;
}

export interface StocktakeSurplusLineInput {
  type?: "surplus";
  catalog_item_id: string;
  condition: StockCondition;
  counted_quantity: string;
  expiry_precision?: ExpiryPrecision;
  expiry_input?: string;
  evidence_note?: string;
}

export type ReconcileStocktakeLineInput =
  StocktakeCountLineInput | StocktakeSurplusLineInput;

export interface ReconcileStocktakePayload {
  stocktake_reference: string;
  location_id: string;
  count_timestamp: string;
  scope_description?: string;
  reason: string;
  evidence_note: string;
  lines: ReconcileStocktakeLineInput[];
}

export interface VerifyStocktakeSurplusPayload {
  origin_id: string;
  expected_version: number | string;
  expected_stock_revision: number | string;
  action: "release" | "append_evidence";
  expiry_precision?: "day" | "month";
  expiry_input?: string;
  reason: string;
  evidence_note: string;
}

export interface AppendStocktakeEvidencePayload {
  origin_id: string;
  evidence_note: string;
  reason: string;
}
