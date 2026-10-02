"use server";

import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead } from "@/lib/inventory/client";
import type {
  InventoryReadFilters,
  InventoryReadResult,
  InventoryResource,
} from "@/lib/inventory/types";

/**
 * Shared authorized server action for single bounded RPC page read.
 * Default page_size: 50, capped at max 100 per server-side inventory contract.
 */
export async function readInventoryOptions<T = Record<string, unknown>>(
  resource: InventoryResource,
  filters: InventoryReadFilters = {},
): Promise<InventoryReadResult<T>> {
  await requireInventoryViewer();

  const page =
    typeof filters.page === "number" && filters.page > 0 ? filters.page : 1;
  const pageSize = Math.min(
    typeof filters.page_size === "number" && filters.page_size > 0
      ? filters.page_size
      : 50,
    100,
  );

  return await inventoryRead<T>(resource, {
    ...filters,
    page,
    page_size: pageSize,
  });
}
