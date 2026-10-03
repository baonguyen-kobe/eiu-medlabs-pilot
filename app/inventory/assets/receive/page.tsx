import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { PageHeader } from "@/components/patterns/page-header";
import { AssetReceiveForm } from "@/components/inventory/assets/asset-receive-form";

export default async function AssetReceivePage() {
  await requireInventoryViewer();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tiếp nhận Thiết bị Cá thể / Receive Physical Asset"
        description="Ghi nhận chính xác một thực thể thiết bị từ hồ sơ nguồn và cấp phát tem nhãn mã QR."
      />

      <AssetReceiveForm />
    </div>
  );
}
