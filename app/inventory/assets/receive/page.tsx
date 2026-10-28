import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { InventoryPageHeader as PageHeader } from "@/components/inventory/inventory-page-header";
import { AssetReceiveForm } from "@/components/inventory/assets/asset-receive-form";
import { LocalizedText } from "@/components/i18n/language-provider";

export default async function AssetReceivePage() {
  await requireInventoryViewer();

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <LocalizedText
            text={"Tiếp nhận Thiết bị Cá thể / Receive Physical Asset"}
          />
        }
        description={
          <LocalizedText
            text={
              "Ghi nhận chính xác một thực thể thiết bị từ hồ sơ nguồn và cấp phát tem nhãn mã QR."
            }
          />
        }
      />

      <AssetReceiveForm />
    </div>
  );
}
