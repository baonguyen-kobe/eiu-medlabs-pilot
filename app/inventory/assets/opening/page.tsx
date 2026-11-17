import React from "react";
import { createClient } from "@/lib/supabase/server";
import { requireInventoryAdmin } from "@/lib/inventory/auth";
import { AssetOpeningForm } from "@/components/inventory/assets/asset-opening-form";

export default async function AssetOpeningPage() {
  await requireInventoryAdmin();
  const supabase = await createClient();
  const { data: people } = await supabase.rpc("list_active_people");

  return (
    <div className="space-y-6">
      <AssetOpeningForm people={people ?? []} />
    </div>
  );
}
