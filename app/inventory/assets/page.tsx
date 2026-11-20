import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { assetRead } from "@/lib/inventory/asset-client";
import { isUuid } from "@/lib/inventory/client";
import { AssetListView } from "@/components/inventory/assets/asset-list-view";
import type {
  AssetLifecycleStatus,
  AssetOperationalStatus,
  EquipmentAsset,
} from "@/lib/inventory/asset-types";

const PAGE_SIZE = 25;

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    lifecycle_status?: string;
    operational_status?: string;
    source_line_id?: string;
    page?: string;
  }>;
}) {
  const viewer = await requireInventoryViewer();
  const sp = await searchParams;

  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const q = sp.q?.trim() || undefined;
  const lifecycle_status =
    sp.lifecycle_status && sp.lifecycle_status !== "all"
      ? (sp.lifecycle_status as AssetLifecycleStatus)
      : undefined;
  const operational_status =
    sp.operational_status && sp.operational_status !== "all"
      ? (sp.operational_status as AssetOperationalStatus)
      : undefined;
  const source_line_id = isUuid(sp.source_line_id?.trim())
    ? sp.source_line_id?.trim()
    : undefined;
  const result = await assetRead<EquipmentAsset>("assets", {
    q,
    lifecycle_status,
    operational_status,
    source_line_id,
    page,
    page_size: PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      <AssetListView
        assets={result.rows}
        total={result.total}
        page={page}
        pageSize={PAGE_SIZE}
        isAdmin={viewer.isAdmin}
        filters={{
          q,
          lifecycle_status,
          operational_status,
          source_line_id,
        }}
      />
    </div>
  );
}
