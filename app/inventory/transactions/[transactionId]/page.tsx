import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { assetRead } from "@/lib/inventory/asset-client";
import type { EquipmentAssetEvent } from "@/lib/inventory/asset-types";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead } from "@/lib/inventory/client";
import { TransactionDetailView } from "@/components/inventory/transaction-detail-view";
import { PageHeader } from "@/components/patterns/page-header";
import type {
  InventoryStorageLocation,
  InventoryUom,
  TransactionDetailResult,
} from "@/lib/inventory/types";

export default async function TransactionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ transactionId: string }>;
  searchParams?: Promise<{ origin?: string }>;
}) {
  const viewer = await requireInventoryViewer();
  const { transactionId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const selectedOriginId = resolvedSearchParams.origin;

  let detail: TransactionDetailResult | null = null;
  let locations: InventoryStorageLocation[] = [];
  let uoms: InventoryUom[] = [];
  let queryError: string | null = null;

  try {
    const [detailRes, locationsRes, uomsRes] = await Promise.all([
      inventoryRead<TransactionDetailResult>("transaction_detail", {
        id: transactionId,
      }),
      inventoryRead<InventoryStorageLocation>("locations", {
        active: true,
        page_size: 100,
      }),
      inventoryRead<InventoryUom>("uoms", { active: true, page_size: 100 }),
    ]);
    detail = detailRes.rows[0] ?? null;
    locations = locationsRes.rows;
    uoms = uomsRes.rows;
  } catch (err: unknown) {
    queryError =
      err instanceof Error ? err.message : "Lỗi tải chi tiết giao dịch";
  }

  if (queryError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Chi tiết giao dịch / Transaction Detail"
          description="Lỗi khi truy xuất dữ liệu sổ cái"
        />
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm">
          <p className="font-semibold">Không thể tải thông tin giao dịch:</p>
          <p className="mt-1 font-mono text-xs">{queryError}</p>
          <div className="mt-4">
            <Link
              href="/inventory/transactions"
              className="button button-secondary text-xs"
            >
              &larr; Quay lại danh sách lịch sử
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!detail || !detail.transaction) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Chi tiết giao dịch / Transaction Detail"
          description="Không tìm thấy bản ghi"
        />
        <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-sm">
          <p className="font-semibold">Giao dịch không tồn tại</p>
          <p className="mt-1 text-xs text-slate-500">
            Không tìm thấy thông tin cho mã giao dịch{" "}
            <span className="font-mono">{transactionId}</span>.
          </p>
          <div className="mt-4">
            <Link
              href="/inventory/transactions"
              className="button button-secondary text-xs"
            >
              &larr; Quay lại danh sách lịch sử
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Exact-asset effects share the transaction header, not the quantity ledger.
  if (detail.transaction.operation.startsWith("ASSET_")) {
    const events = await assetRead<EquipmentAssetEvent>("history", {
      transaction_id: transactionId,
      page_size: 1,
    });
    const event = events.rows[0];
    if (!event) {
      throw new Error("ASSET_TRANSACTION_EFFECT_MISSING");
    }
    redirect(`/inventory/assets/${event.asset_id}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Chi tiết giao dịch: ${detail.transaction.business_key}`}
        description="Lịch sử dịch chuyển số dư và đối chiếu bằng chứng sự thật nguồn gốc"
      />

      <TransactionDetailView
        detail={detail}
        locations={locations}
        uoms={uoms}
        isAdmin={viewer.isAdmin}
        selectedOriginId={selectedOriginId}
      />
    </div>
  );
}
