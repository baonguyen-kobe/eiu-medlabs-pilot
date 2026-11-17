import type { SupabaseClient } from "@supabase/supabase-js";
import { isEquipmentRequestId } from "@/lib/equipment-calendar-request";
import {
  equipmentRequestSelect,
  equipmentRequestStatuses,
  type EquipmentRequestDomain,
} from "@/lib/equipment-requests";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

/** URL filters shared by /equipment/requests and /equipment/mine. */
export type EquipmentRequestFilters = {
  q: string;
  domain: string;
  status: string;
  from: string;
  to: string;
};

export type EquipmentRequestSearchParams = Partial<
  Record<keyof EquipmentRequestFilters | "page" | "request", string>
>;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const domains = new Set<string>(["nursing_skills", "basic_medical"]);
const statuses = new Set<string>(
  equipmentRequestStatuses.map(({ value }) => value),
);

export function parseEquipmentRequestFilters(
  params: EquipmentRequestSearchParams,
): EquipmentRequestFilters {
  return {
    q: params.q?.trim().slice(0, 200) ?? "",
    domain: domains.has(params.domain ?? "") ? params.domain! : "",
    status: statuses.has(params.status ?? "") ? params.status! : "",
    from: isoDate.test(params.from ?? "") ? params.from! : "",
    to: isoDate.test(params.to ?? "") ? params.to! : "",
  };
}

/**
 * One page of requests, filtered and counted in the database
 * (list_equipment_request_page), then loaded by id in that order.
 */
export async function loadEquipmentRequestPage(
  supabase: SupabaseClient,
  {
    params,
    domains: allowedDomains,
    mine = false,
  }: {
    params: EquipmentRequestSearchParams;
    domains: readonly EquipmentRequestDomain[];
    mine?: boolean;
  },
) {
  const filters = parseEquipmentRequestFilters(params);
  const focusId = isEquipmentRequestId(params.request)
    ? params.request
    : undefined;
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const { data: page, error } = await supabase.rpc(
    "list_equipment_request_page",
    {
      p_domains: [...allowedDomains],
      p_mine: mine,
      p_query: filters.q || null,
      p_domain: filters.domain || null,
      p_status: filters.status || null,
      p_date_from: filters.from || null,
      p_date_to: filters.to || null,
      p_page: Number.isFinite(requestedPage) ? requestedPage : 1,
      p_page_size: TABLE_PAGE_SIZE,
      // A deep link wins over ?page= only when it has no explicit page.
      p_focus_id: params.page ? null : (focusId ?? null),
    },
  );
  if (error) throw new Error(`Equipment request page: ${error.message}`);

  const {
    ids,
    total,
    page: currentPage,
  } = page as {
    ids: string[];
    total: number;
    page: number;
  };
  let requests: unknown[] = [];
  if (ids.length) {
    const { data, error: rowsError } = await supabase
      .from("equipment_requests")
      .select(equipmentRequestSelect)
      .in("id", ids);
    if (rowsError) throw new Error(`Equipment requests: ${rowsError.message}`);
    const byId = new Map((data ?? []).map((row) => [row.id as string, row]));
    requests = ids.map((id) => byId.get(id)).filter(Boolean) as unknown[];
  }

  return {
    requests,
    paging: { filters, total, page: currentPage },
    focusId,
  };
}
