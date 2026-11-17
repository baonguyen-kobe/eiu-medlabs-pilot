import React from "react";
import { createClient } from "@/lib/supabase/server";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { AssetReceiveForm } from "@/components/inventory/assets/asset-receive-form";

export default async function AssetReceivePage() {
  await requireInventoryViewer();
  const supabase = await createClient();
  const { data: people } = await supabase.rpc("list_active_people");

  return (
    <div className="space-y-6">
      <AssetReceiveForm people={people ?? []} />
    </div>
  );
}
