import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead } from "@/lib/inventory/client";
import { ReceiveForm } from "@/components/inventory/receive-form";
import { AssetReceiveForm } from "@/components/inventory/assets/asset-receive-form";
import {
  IntakeKindSwitch,
  intakeKind,
} from "@/components/inventory/intake-kind-switch";
import { createClient } from "@/lib/supabase/server";
import type {
  AcquisitionRecord,
  AcquisitionRecordLine,
} from "@/lib/inventory/types";

export default async function ReceivePage({
  searchParams,
}: {
  searchParams?: Promise<{ sourceId?: string; kind?: string }>;
}) {
  await requireInventoryViewer();
  const resolvedParams = searchParams ? await searchParams : {};
  const preselectedSourceId = resolvedParams.sourceId;
  const kind = intakeKind(resolvedParams.kind);

  if (kind === "asset") {
    const supabase = await createClient();
    const { data: people } = await supabase.rpc("list_active_people");
    return (
      <div className="space-y-6">
        <IntakeKindSwitch path="/inventory/receive" kind={kind} />
        <AssetReceiveForm people={people ?? []} />
      </div>
    );
  }

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
      <IntakeKindSwitch path="/inventory/receive" kind={kind} />
      <ReceiveForm
        initialSources={initialSources}
        initialSourceLines={initialSourceLines}
        preselectedSourceId={preselectedSourceId}
      />
    </div>
  );
}
