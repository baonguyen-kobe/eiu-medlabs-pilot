import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { OpeningForm } from "@/components/inventory/opening-form";
import { AssetOpeningForm } from "@/components/inventory/assets/asset-opening-form";
import {
  IntakeKindSwitch,
  intakeKind,
} from "@/components/inventory/intake-kind-switch";
import { getInterfaceText } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export default async function OpeningPage({
  searchParams,
}: {
  searchParams?: Promise<{ kind?: string }>;
}) {
  const viewer = await requireInventoryViewer();
  const text = await getInterfaceText();

  if (!viewer.isAdmin) {
    return (
      <p className="form-error" role="alert">
        {text("Chỉ Admin được khai báo tồn đầu kỳ.")}
      </p>
    );
  }

  const kind = intakeKind((await searchParams)?.kind);
  let people: Array<{ id: string; full_name: string; title: string | null }> =
    [];
  if (kind === "asset") {
    const supabase = await createClient();
    people = (await supabase.rpc("list_active_people")).data ?? [];
  }

  return (
    <div className="space-y-6">
      <IntakeKindSwitch path="/inventory/opening" kind={kind} />
      {kind === "asset" ? (
        <AssetOpeningForm people={people} />
      ) : (
        <OpeningForm />
      )}
    </div>
  );
}
