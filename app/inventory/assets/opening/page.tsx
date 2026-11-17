import React from "react";
import { requireInventoryAdmin } from "@/lib/inventory/auth";
import { AssetOpeningForm } from "@/components/inventory/assets/asset-opening-form";

export default async function AssetOpeningPage() {
  await requireInventoryAdmin();

  return (
    <div className="space-y-6">
      <AssetOpeningForm />
    </div>
  );
}
