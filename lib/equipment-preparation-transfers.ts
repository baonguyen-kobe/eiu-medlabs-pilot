import { z } from "zod";

const quantity = z.string().regex(/^\d+(\.\d+)?$/);
const sourceSchema = z.object({
  inventory_item_id: z.guid(),
  item_name: z.string(),
  item_code: z.string(),
  base_uom_code: z.string(),
  tracking_strategy: z.enum(["quantity", "serialized"]),
  location_id: z.guid(),
  location_name: z.string(),
  available_quantity: quantity.nullable(),
});
const locationSchema = z.object({ id: z.guid(), name: z.string() });
const assetSchema = z.object({
  id: z.guid(),
  asset_code: z.string(),
  manufacturer_serial: z.string().nullable(),
  revision: z.number().int(),
});
const debtSchema = z.object({
  id: z.guid(),
  cohort_id: z.guid().nullable(),
  asset_id: z.guid().nullable(),
  source_location_id: z.guid(),
  destination_location_id: z.guid(),
  source_name: z.string(),
  destination_name: z.string(),
  item_name: z.string(),
  base_uom_code: z.string(),
  asset_code: z.string().nullable(),
  outstanding_quantity: quantity,
  expected_version: z.number().int().nullable(),
  expected_stock_revision: z.number().int().nullable(),
  asset_revision: z.number().int().nullable(),
  operational_status: z.string().nullable(),
  good_quantity: quantity,
  damaged_quantity: quantity,
  asset_location_id: z.guid().nullable(),
});
export const transferSourcesSchema = z.object({
  rows: z.array(sourceSchema),
  page: z.number().int(),
});
export const transferLocationsSchema = z.object({
  rows: z.array(locationSchema),
  page: z.number().int(),
});
export const transferAssetsSchema = z.object({
  rows: z.array(assetSchema),
  page: z.number().int(),
});
export const transferDebtsSchema = z.object({
  rows: z.array(debtSchema),
  page: z.number().int(),
});
export type TransferSource = z.infer<typeof sourceSchema>;
export type TransferLocation = z.infer<typeof locationSchema>;
export type TransferAsset = z.infer<typeof assetSchema>;
export type TransferDebt = z.infer<typeof debtSchema>;
export type TransferReadResource = "sources" | "locations" | "assets" | "debts";
