import type { ExpiryPrecision } from "./types";

export type AssetLifecycleStatus =
  "registered" | "in_service" | "inactive" | "retired" | "disposed";

export type AssetOperationalStatus =
  "ready" | "in_use" | "under_maintenance" | "damaged" | "prohibited";

export type AssetIntakeKind = "receive" | "open";

export type AssetResource = "assets" | "detail" | "lookup" | "history";

export type AssetOperation =
  | "receive_asset"
  | "open_asset"
  | "set_asset_state"
  | "set_asset_lifecycle"
  | "correct_asset";

export interface EquipmentAsset {
  id: string;
  asset_code: string;
  catalog_item_id: string;
  item_code: string;
  item_name: string;
  source_line_id: string | null;
  intake_kind: AssetIntakeKind;
  intake_reference: string;
  row_key: string;
  manufacturer: string | null;
  model: string | null;
  manufacturer_serial: string | null;
  location_id: string;
  location_code: string;
  location_name: string;
  custodian_id: string | null;
  custodian_name: string | null;
  lifecycle_status: AssetLifecycleStatus;
  operational_status: AssetOperationalStatus;
  expiry_precision: ExpiryPrecision;
  expiry_date: string | null;
  revision: number;
  eligible: boolean;
  ineligibility_reasons: string[];
  created_at: string;
  updated_at: string;
}

export interface EquipmentAssetEvent {
  id: string;
  asset_id: string;
  revision: number;
  operation: string;
  actor_id: string;
  actor_name: string;
  occurred_at: string;
  posted_at: string;
  reason: string;
  evidence_note: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown>;
  corrects_event_id: string | null;
  transaction_id?: string;
}

export interface AssetReadFilters {
  id?: string;
  asset_code?: string;
  q?: string;
  catalog_item_id?: string;
  location_id?: string;
  lifecycle_status?: AssetLifecycleStatus;
  operational_status?: AssetOperationalStatus;
  page?: number;
  page_size?: number;
  transaction_id?: string;
  source_line_id?: string;
}

export interface AssetReadResult<T = EquipmentAsset> {
  rows: T[];
  total: number;
}

export interface AssetCommandResult {
  id: string;
  asset_code: string;
  revision: number;
  event_id: string;
  transaction_id?: string;
}

export interface ReceiveAssetPayload {
  catalog_item_id: string;
  source_line_id: string;
  location_id: string;
  intake_reference: string;
  row_key: string;
  manufacturer?: string | null;
  model?: string | null;
  manufacturer_serial?: string | null;
  custodian_id?: string | null;
  operational_status?: AssetOperationalStatus;
  expiry_precision?: ExpiryPrecision;
  expiry_input?: string | null;
  reason: string;
  evidence_note: string;
  occurred_at?: string;
}

export interface OpenAssetPayload {
  catalog_item_id: string;
  source_line_id?: string | null;
  location_id: string;
  intake_reference: string;
  row_key: string;
  manufacturer?: string | null;
  model?: string | null;
  manufacturer_serial?: string | null;
  custodian_id?: string | null;
  operational_status?: AssetOperationalStatus;
  expiry_precision?: ExpiryPrecision;
  expiry_input?: string | null;
  reason: string;
  evidence_note: string;
  occurred_at?: string;
}

export interface SetAssetStatePayload {
  id: string;
  expected_revision: number;
  location_id: string;
  custodian_id: string | null;
  operational_status: AssetOperationalStatus;
  reason: string;
  evidence_note: string;
  occurred_at?: string;
}

export interface SetAssetLifecyclePayload {
  id: string;
  expected_revision: number;
  lifecycle_status: AssetLifecycleStatus;
  reason: string;
  evidence_note: string;
  occurred_at?: string;
}

export interface CorrectAssetPayload {
  id: string;
  expected_revision: number;
  corrects_event_id: string;
  manufacturer: string | null;
  model: string | null;
  manufacturer_serial: string | null;
  expiry_precision: ExpiryPrecision;
  expiry_input: string | null;
  reason: string;
  evidence_note: string;
  occurred_at?: string;
}

export interface AssetLookupResponse {
  asset: EquipmentAsset | null;
  found: boolean;
  eligible: boolean;
  ineligibility_reasons: string[];
}
