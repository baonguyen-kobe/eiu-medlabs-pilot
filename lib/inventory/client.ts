import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import type {
  InventoryCommandResult,
  InventoryOperation,
  InventoryReadFilters,
  InventoryReadResult,
  InventoryResource,
} from "./types";

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

/** One authorized, bounded RPC page. URL state and lookup controls own pagination. */
export async function inventoryRead<T = Record<string, unknown>>(
  resource: InventoryResource,
  filters: InventoryReadFilters = {},
): Promise<InventoryReadResult<T>> {
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
  const { data, error } = await supabase.rpc("inventory_read", {
    p_resource: resource,
    p_filters: safeFilters,
  });
  if (error) {
    throw new Error(`INVENTORY_READ_ERROR [${resource}]: ${error.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      `INVENTORY_READ_INVALID_RESPONSE [${resource}]: Expected object envelope`,
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
      `INVENTORY_READ_INVALID_ENVELOPE [${resource}]: Invalid rows or total`,
    );
  }
  return { rows: raw.rows as T[], total: raw.total };
}

/**
 * Dispatches a typed inventory mutation via public.inventory_command.
 * Throws immediately on error or malformed response; never fabricates success.
 */
export async function inventoryCommand<T = Record<string, unknown>>(
  operation: InventoryOperation,
  payload: Record<string, unknown>,
  retryKey?: string,
): Promise<InventoryCommandResult<T>> {
  const supabase = await createClient();
  const safeRetryKey = retryKey ?? crypto.randomUUID();
  const safePayload = toJsonRecord(payload);

  const { data, error } = await supabase.rpc("inventory_command", {
    p_operation: operation,
    p_payload: safePayload,
    p_retry_key: safeRetryKey,
  });

  if (error) {
    throw new Error(`INVENTORY_COMMAND_ERROR [${operation}]: ${error.message}`);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      `INVENTORY_COMMAND_INVALID_RESPONSE [${operation}]: Expected response object, received ${typeof data}`,
    );
  }

  const res = data as Record<string, Json | undefined>;
  const resolvedId =
    (typeof res.id === "string" ? res.id : undefined) ??
    (typeof res.transaction_id === "string" ? res.transaction_id : undefined) ??
    (typeof res.receipt_id === "string" ? res.receipt_id : undefined) ??
    (typeof res.opening_batch_id === "string"
      ? res.opening_batch_id
      : undefined) ??
    (typeof res.code === "string" ? res.code : undefined);

  if (!resolvedId) {
    throw new Error(
      `INVENTORY_COMMAND_MISSING_ID [${operation}]: Response envelope lacked valid entity ID`,
    );
  }

  const revision =
    typeof res.revision === "number" || typeof res.revision === "string"
      ? res.revision
      : undefined;

  const transaction_id =
    typeof res.transaction_id === "string" ? res.transaction_id : undefined;

  return {
    id: resolvedId,
    revision,
    transaction_id,
    payload: res as T,
  };
}
