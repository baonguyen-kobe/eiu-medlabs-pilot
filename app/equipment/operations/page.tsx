import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getViewer } from "@/lib/viewer";
import {
  equipmentOperationsSchema,
  operationPhases,
} from "@/lib/equipment-operations";
import { LocalizedText } from "@/components/i18n/language-provider";
import { OperationsQueue } from "@/components/equipment-operations-queue";

export default async function EquipmentOperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const phase =
    typeof params.phase === "string" && params.phase in operationPhases
      ? (params.phase as keyof typeof operationPhases)
      : "all";
  const search =
    typeof params.search === "string" ? params.search.slice(0, 120) : "";
  const rawPage = typeof params.page === "string" ? Number(params.page) : 1;
  const page =
    Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100000
      ? rawPage
      : 1;
  const viewer = await getViewer();
  const read = (filters: { phase: string; search: string; page: number }) =>
    viewer.supabase.rpc("equipment_operations_read", { p_filters: filters });
  // The selected list plus one bounded read per step for the step counts.
  const phaseKeys = Object.keys(operationPhases) as Array<
    keyof typeof operationPhases
  >;
  const [{ data, error }, ...phaseReads] = await Promise.all([
    read({ phase, search, page }),
    ...phaseKeys.map((key) => read({ phase: key, search, page: 1 })),
  ]);
  if (error) {
    if (error.code === "42501") notFound();
    throw new Error(
      "Không tải được công việc kho. Hãy tải lại; dữ liệu cũ không bị thay đổi.",
    );
  }
  const queue = equipmentOperationsSchema.parse(data);
  const phaseCounts = Object.fromEntries(
    phaseKeys.map((key, index) => [
      key,
      phaseReads[index].error
        ? null
        : equipmentOperationsSchema.parse(phaseReads[index].data).total,
    ]),
  ) as Record<keyof typeof operationPhases, number | null>;
  return (
    <WorkspaceShell
      fullName={viewer.fullName}
      roles={viewer.roles}
      roomTypeCodes={viewer.roomTypes.map(({ code }) => code)}
      allowBasicMedicalAccess={viewer.allowBasicMedicalAccess}
      canImportSchedules={viewer.canImportSchedules}
      canManagePersonnel={viewer.canManagePersonnel}
      canManageEmailNotifications={viewer.canManageEmailNotifications}
      title={<LocalizedText text={"Công việc & giao nhận"} />}
      description={
        <LocalizedText
          text={"Phiếu thiết bị cần chuẩn bị, giao, ký, trả hoặc đối soát."}
        />
      }
    >
      <OperationsQueue
        phase={phase}
        search={search}
        page={page}
        queue={queue}
        phaseCounts={phaseCounts}
      />
    </WorkspaceShell>
  );
}
