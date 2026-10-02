import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead } from "@/lib/inventory/client";
import { createClient } from "@/lib/supabase/server";
import { LocationsView } from "@/components/inventory/locations-view";
import { PageHeader } from "@/components/patterns/page-header";
import type { InventoryStorageLocation } from "@/lib/inventory/types";

interface LocationsPageProps {
  searchParams: Promise<{
    q?: string;
    active?: string;
    sort?: string;
    page?: string;
    page_size?: string;
  }>;
}

export default async function LocationsPage({
  searchParams,
}: LocationsPageProps) {
  const viewer = await requireInventoryViewer();
  const supabase = await createClient();
  const params = await searchParams;

  const q = (params.q ?? "").trim();
  const rawActive = params.active ?? "all";
  const active =
    rawActive === "active" || rawActive === "true"
      ? true
      : rawActive === "inactive" || rawActive === "false"
        ? false
        : undefined;

  const sort = params.sort?.trim() || undefined;
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(params.page_size) || 50), 100);

  const [locationsRes, roomsRes] = await Promise.all([
    inventoryRead<InventoryStorageLocation>("locations", {
      q: q || undefined,
      active,
      sort,
      page,
      page_size: pageSize,
    }),
    supabase
      .from("rooms")
      .select("id, room_code, building_code")
      .order("room_code"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vị trí lưu kho & Phân cấp / Storage Locations"
        description="Quản lý cấu trúc vị trí kho cây phân cấp không chu trình và liên kết phòng thực hành"
      />

      <LocationsView
        initialLocations={locationsRes.rows}
        total={locationsRes.total}
        currentPage={page}
        pageSize={pageSize}
        currentQ={q}
        currentActive={rawActive}
        currentSort={sort || ""}
        rooms={roomsRes.data || []}
        isAdmin={viewer.isAdmin}
      />
    </div>
  );
}
