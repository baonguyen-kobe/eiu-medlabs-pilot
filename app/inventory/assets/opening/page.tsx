import React from "react";
import { requireInventoryAdmin } from "@/lib/inventory/auth";
import { PageHeader } from "@/components/patterns/page-header";
import { AssetOpeningForm } from "@/components/inventory/assets/asset-opening-form";

export default async function AssetOpeningPage() {
  await requireInventoryAdmin();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ghi nhận Tồn đầu kỳ Thiết bị / Opening Balance Asset"
        description="Khởi tạo thực thể thiết bị cá thể từ biên bản kiểm kê đầu kỳ (Admin-only)."
      />

      <AssetOpeningForm />
    </div>
  );
}
