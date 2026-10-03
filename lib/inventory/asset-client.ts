import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import type {
  AssetCommandResult,
  AssetOperation,
  AssetReadFilters,
  AssetReadResult,
  AssetResource,
} from "./asset-types";

const RPC_BOUNDED_PAGE_SIZE = 100;

function toJsonRecord(
  input: Record<string, unknown>,
): Record<string, Json | undefined> {
  const result: Record<string, Json | undefined> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value as Json[];
    } else if (typeof value === "object") {
      result[key] = value as { [key: string]: Json | undefined };
    }
  }
  return result;
}

/**
 * Executes an authorized, bounded read via public.equipment_asset_read.
 * Deterministic ordering and page/page_size clamped to 1..100.
 */
export async function assetRead<T = Record<string, unknown>>(
  resource: AssetResource,
  filters: AssetReadFilters = {},
): Promise<AssetReadResult<T>> {
  const supabase = await createClient();
  const safeFilters = toJsonRecord({
    ...filters,
    page:
      Number.isSafeInteger(filters.page) && (filters.page ?? 0) > 0
        ? filters.page
        : 1,
    page_size: Math.max(
      1,
      Math.min(
        Number.isSafeInteger(filters.page_size) ? filters.page_size! : 50,
        RPC_BOUNDED_PAGE_SIZE,
      ),
    ),
  });

  const { data, error } = await supabase.rpc("equipment_asset_read", {
    p_resource: resource,
    p_filters: safeFilters,
  });

  if (error) {
    throw new Error(`ASSET_READ_ERROR [${resource}]: ${error.message}`);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      `ASSET_READ_INVALID_RESPONSE [${resource}]: Expected object envelope`,
    );
  }

  const raw = data as Record<string, Json | undefined>;
  if (
    !Array.isArray(raw.rows) ||
    typeof raw.total !== "number" ||
    !Number.isSafeInteger(raw.total) ||
    raw.total < 0
  ) {
    throw new Error(
      `ASSET_READ_INVALID_ENVELOPE [${resource}]: Invalid rows or total`,
    );
  }

  return { rows: raw.rows as T[], total: raw.total };
}

/**
 * Dispatches an exact asset mutation via public.equipment_asset_command.
 * Throws immediately on error; never fabricates success.
 */
export async function assetCommand(
  operation: AssetOperation,
  payload: Record<string, unknown>,
  retryKey?: string,
): Promise<AssetCommandResult> {
  const supabase = await createClient();
  const safeRetryKey = retryKey ?? crypto.randomUUID();
  const safePayload = toJsonRecord(payload);

  const { data, error } = await supabase.rpc("equipment_asset_command", {
    p_operation: operation,
    p_payload: safePayload,
    p_retry_key: safeRetryKey,
  });

  if (error) {
    throw new Error(`ASSET_COMMAND_ERROR [${operation}]: ${error.message}`);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      `ASSET_COMMAND_INVALID_RESPONSE [${operation}]: Expected response object`,
    );
  }

  const res = data as Record<string, unknown>;
  const id = typeof res.id === "string" ? res.id : undefined;
  const asset_code =
    typeof res.asset_code === "string" ? res.asset_code : undefined;
  const revision =
    typeof res.revision === "number"
      ? res.revision
      : typeof res.revision === "string"
        ? parseInt(res.revision, 10)
        : undefined;
  const event_id = typeof res.event_id === "string" ? res.event_id : undefined;
  const transaction_id =
    typeof res.transaction_id === "string" ? res.transaction_id : undefined;

  if (!id || !asset_code || revision === undefined || !event_id) {
    throw new Error(
      `ASSET_COMMAND_MISSING_FIELDS [${operation}]: Response envelope lacked required fields (id, asset_code, revision, event_id)`,
    );
  }

  return {
    id,
    asset_code,
    revision,
    event_id,
    transaction_id,
  };
}
