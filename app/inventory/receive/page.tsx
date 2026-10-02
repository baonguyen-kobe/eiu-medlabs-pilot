import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead } from "@/lib/inventory/client";
import { ReceiveForm } from "@/components/inventory/receive-form";
import { PageHeader } from "@/components/patterns/page-header";
import type {
  AcquisitionRecord,
  AcquisitionRecordLine,
} from "@/lib/inventory/types";

export default async function ReceivePage({
  searchParams,
}: {
  searchParams?: Promise<{ sourceId?: string }>;
}) {
  await requireInventoryViewer();
  const resolvedParams = searchParams ? await searchParams : {};
  const preselectedSourceId = resolvedParams.sourceId;

  let initialSources: AcquisitionRecord[] = [];
  let initialSourceLines: AcquisitionRecordLine[] = [];

  if (preselectedSourceId) {
    const [sourceRes, linesRes] = await Promise.all([
      inventoryRead<AcquisitionRecord>("sources", {
        id: preselectedSourceId,
        page: 1,
        page_size: 1,
      }),
      inventoryRead<AcquisitionRecordLine>("source_lines", {
        source_id: preselectedSourceId,
        page: 1,
        page_size: 50,
      }),
    ]);
    initialSources = sourceRes.rows;
    initialSourceLines = linesRes.rows;
  } else {
    // Single bounded first page to bootstrap default selection without unbounded fetch
    const sourceRes = await inventoryRead<AcquisitionRecord>("sources", {
      active: true,
      page: 1,
      page_size: 10,
    });
    initialSources = sourceRes.rows;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nhận kho thực tế / Receive Stock"
        description="Ghi nhận hàng hóa thực tế nhập kho, quy đổi chính xác số lượng theo ĐVT cơ sở và phân loại chất lượng"
      />

      <ReceiveForm
        initialSources={initialSources}
        initialSourceLines={initialSourceLines}
        preselectedSourceId={preselectedSourceId}
      />
    </div>
  );
}
