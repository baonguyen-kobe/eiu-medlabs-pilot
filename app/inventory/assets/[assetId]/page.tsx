import React from "react";
import { notFound } from "next/navigation";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { assetRead } from "@/lib/inventory/asset-client";
import { generateAssetQrSvg } from "@/lib/inventory/asset-qr";
import { AssetDetailView } from "@/components/inventory/assets/asset-detail-view";
import type {
  EquipmentAsset,
  EquipmentAssetEvent,
} from "@/lib/inventory/asset-types";

const HISTORY_PAGE_SIZE = 10;

export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const viewer = await requireInventoryViewer();
  const { assetId } = await params;
  const sp = await searchParams;

  const historyPage = Math.max(1, parseInt(sp.page || "1", 10) || 1);

  const [detailResult, historyResult] = await Promise.all([
    assetRead<EquipmentAsset>("detail", { id: assetId }),
    assetRead<EquipmentAssetEvent>("history", {
      id: assetId,
      page: historyPage,
      page_size: HISTORY_PAGE_SIZE,
    }),
  ]);

  if (!detailResult.rows || detailResult.rows.length === 0) {
    notFound();
  }

  const asset = detailResult.rows[0];
  const qrSvg = await generateAssetQrSvg(asset.asset_code);

  return (
    <AssetDetailView
      asset={asset}
      events={historyResult.rows}
      eventsTotal={historyResult.total}
      eventsPage={historyPage}
      eventsPageSize={HISTORY_PAGE_SIZE}
      qrSvg={qrSvg}
      isAdmin={viewer.isAdmin}
    />
  );
}
