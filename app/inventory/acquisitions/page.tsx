import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead } from "@/lib/inventory/client";
import { AcquisitionsView } from "@/components/inventory/acquisitions-view";
import { PageHeader } from "@/components/patterns/page-header";
import type {
  AcquisitionRecord,
  AcquisitionRecordLine,
  InventorySourceReceipt,
} from "@/lib/inventory/types";

interface AcquisitionsPageProps {
  searchParams: Promise<{
    q?: string;
    supplier_id?: string;
    status?: string;
    sort?: string;
    page?: string;
    page_size?: string;
    sourceId?: string;
    line_q?: string;
    line_page?: string;
    line_page_size?: string;
  }>;
}

export default async function AcquisitionsPage({
  searchParams,
}: AcquisitionsPageProps) {
  const viewer = await requireInventoryViewer();
  const params = await searchParams;

  const q = (params.q ?? "").trim();
  const supplierId = params.supplier_id?.trim() || undefined;
  const rawStatus = params.status ?? "all";
  const status =
    rawStatus === "active"
      ? "active"
      : rawStatus === "voided"
        ? "voided"
        : undefined;
  const sort = params.sort?.trim() || undefined;
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(params.page_size) || 50), 100);

  const sourcesRes = await inventoryRead<AcquisitionRecord>("sources", {
    q: q || undefined,
    supplier_id: supplierId,
    status,
    sort,
    page,
    page_size: pageSize,
  });

  const selectedSourceId =
    params.sourceId?.trim() || sourcesRes.rows[0]?.id || null;

  let selectedSource =
    sourcesRes.rows.find((s) => s.id === selectedSourceId) || null;
  if (!selectedSource && selectedSourceId) {
    const singleSourceRes = await inventoryRead<AcquisitionRecord>("sources", {
      id: selectedSourceId,
      page: 1,
      page_size: 1,
    });
    if (singleSourceRes.rows.length > 0) {
      selectedSource = singleSourceRes.rows[0];
    }
  }

  const lineQ = (params.line_q ?? "").trim();
  const linePage = Math.max(1, Number(params.line_page) || 1);
  const linePageSize = Math.min(
    Math.max(1, Number(params.line_page_size) || 50),
    100,
  );

  const [linesRes, receiptsRes] = selectedSourceId
    ? await Promise.all([
        inventoryRead<AcquisitionRecordLine>("source_lines", {
          source_id: selectedSourceId,
          q: lineQ || undefined,
          page: linePage,
          page_size: linePageSize,
        }),
        inventoryRead<InventorySourceReceipt>("source_receipts", {
          source_id: selectedSourceId,
          page: 1,
          page_size: 100,
        }),
      ])
    : [
        { rows: [], total: 0 },
        { rows: [], total: 0 },
      ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hồ sơ nguồn & Cam kết mua sắm / Acquisition Sources"
        description="Quản lý bằng chứng xuất xứ, hợp đồng và đơn giá mua sắm. Lưu hồ sơ có biến động tồn kho bằng 0"
      />

      <AcquisitionsView
        initialSources={sourcesRes.rows}
        sourcesTotal={sourcesRes.total}
        currentSourcePage={page}
        sourcePageSize={pageSize}
        currentSourceQ={q}
        currentSupplierId={supplierId || ""}
        currentStatus={rawStatus}
        currentSort={sort || ""}
        selectedSourceId={selectedSourceId}
        selectedSource={selectedSource}
        initialLines={linesRes.rows}
        linesTotal={linesRes.total}
        currentLinePage={linePage}
        linePageSize={linePageSize}
        currentLineQ={lineQ}
        initialReceipts={receiptsRes.rows}
        isAdmin={viewer.isAdmin}
      />
    </div>
  );
}
