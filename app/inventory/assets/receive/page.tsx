import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { AssetReceiveForm } from "@/components/inventory/assets/asset-receive-form";

export default async function AssetReceivePage() {
  await requireInventoryViewer();

  return (
    <div className="space-y-6">
      <AssetReceiveForm />
    </div>
  );
}
