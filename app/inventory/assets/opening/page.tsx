import React from "react";
import { requireInventoryAdmin } from "@/lib/inventory/auth";
import { InventoryPageHeader as PageHeader } from "@/components/inventory/inventory-page-header";
import { AssetOpeningForm } from "@/components/inventory/assets/asset-opening-form";
import { LocalizedText } from "@/components/i18n/language-provider";

export default async function AssetOpeningPage() {
  await requireInventoryAdmin();

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <LocalizedText
            text={"Ghi nhận Tồn đầu kỳ Thiết bị / Opening Balance Asset"}
          />
        }
        description={
          <LocalizedText
            text={
              "Khởi tạo thực thể thiết bị cá thể từ biên bản kiểm kê đầu kỳ (Admin-only)."
            }
          />
        }
      />

      <AssetOpeningForm />
    </div>
  );
}
