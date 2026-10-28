import { BasicMedicalRegistrationList } from "@/components/basic-medical-registration-list";
import { Search } from "@/components/icons";
import { PaginationLinks } from "@/components/pagination-links";
import { WorkspaceShell } from "@/components/workspace-shell";
import type {
  BasicMedicalRegistrationListItem,
  BasicMedicalRoomInventoryItem,
} from "@/lib/basic-medical-equipment";
import { businessTodayString } from "@/lib/business-time";
import {
  equipmentRequestSelect,
  type EquipmentRequestListItem,
} from "@/lib/equipment-requests";
import { isBasicMedicalConfirmationEvidenceEnabled } from "@/lib/basic-medical-confirmation-evidence";
import { normalizePage, paginationRange } from "@/lib/pagination";
import { getViewer } from "@/lib/viewer";
import {
  canViewBasicMedicalRegistrations,
  canViewBasicMedicalSchedules,
} from "@/lib/workspace-access";
import { redirect } from "next/navigation";
import { LocalizedText } from "@/components/i18n/language-provider";
import { LocalizedElement } from "@/components/i18n/localized-element";

type SearchParams = {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
  notice?: string;
  error?: string;
};

export default async function BasicMedicalRegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const {
    supabase,
    userId,
    fullName,
    roles,
    roomTypes,
    allowBasicMedicalAccess,
    canImportSchedules,
    canManagePersonnel,
    canManageEmailNotifications,
    canManageBasicMedical,
  } = await getViewer();
  const roomTypeCodes = roomTypes.map(({ code }) => code);
  if (!canViewBasicMedicalRegistrations(roles, roomTypeCodes)) {
    redirect(
      canViewBasicMedicalSchedules(roles, roomTypeCodes)
        ? "/basic-medical/schedules"
        : "/dashboard",
    );
  }

  const canDelete = canManageBasicMedical;
  const currentPage = normalizePage(query.page);
  const status = ["completed", "incomplete", "cancelled", "all"].includes(
    query.status ?? "",
  )
    ? (query.status as "completed" | "incomplete" | "cancelled" | "all")
    : "incomplete";
  const search = query.q?.trim() ?? "";
  const { from: rowFrom, to: rowTo } = paginationRange(currentPage);

  let listQuery = supabase
    .from("basic_medical_registration_list")
    .select("id", { count: "exact" })
    .order("created_at", { ascending: false });
  if (status === "completed") listQuery = listQuery.eq("is_completed", true);
  if (status === "incomplete") listQuery = listQuery.eq("is_completed", false);
  if (status === "cancelled")
    listQuery = listQuery.not("cancelled_at", "is", null);
  if (status !== "cancelled" && status !== "all")
    listQuery = listQuery.is("cancelled_at", null);
  if (search) listQuery = listQuery.ilike("search_text", `%${search}%`);
  if (query.from) listQuery = listQuery.gte("end_date", query.from);
  if (query.to) listQuery = listQuery.lte("start_date", query.to);

  const {
    data: listRows,
    count,
    error: listError,
  } = await listQuery.range(rowFrom, rowTo);
  const registrationIds = (listRows ?? []).map(({ id }) => id as string);

  const { data: registrationRows, error: registrationError } =
    registrationIds.length
      ? await supabase
          .from("basic_medical_registrations")
          .select(
            "id,registration_code,created_at,created_by,registrant_id,academic_year,semester,start_date,end_date,student_count,note,cancelled_at,cancelled_by,cancel_reason,courses(course_code,course_name),rooms(id,room_code,building_code,room_name),registrant:profiles!basic_medical_registrations_registrant_id_fkey(full_name),responsible:profiles!basic_medical_registrations_responsible_lecturer_id_fkey(full_name),basic_medical_registration_sessions(id,session_number,lesson_title,teaching_lecturer_id,cancelled_at,cancelled_by,cancellation_reason,teaching:profiles!basic_medical_registration_sessions_teaching_lecturer_id_fkey(full_name),class_schedules(id,schedule_date,start_time,end_time,schedule_status),confirmations:basic_medical_session_confirmations(id,signer_id,signed_at,invalidated_at,invalidated_reason))",
          )
          .in("id", registrationIds)
      : { data: [], error: null };

  const [{ data: instructorRows }, { data: peopleRows }] = await Promise.all([
    supabase.rpc("list_basic_medical_instructors"),
    supabase.rpc("list_active_people"),
  ]);
  const instructors = (instructorRows ?? []) as Array<{
    id: string;
    full_name: string;
    title: string | null;
  }>;
  const activePeople = (peopleRows ?? []) as Array<{
    id: string;
    full_name: string;
    title: string | null;
  }>;

  const order = new Map(registrationIds.map((id, index) => [id, index]));
  const registrations = (
    (registrationRows ?? []) as unknown as BasicMedicalRegistrationListItem[]
  ).sort(
    (left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0),
  );
  const roomIds = [
    ...new Set(
      registrations.flatMap((item) => (item.rooms?.id ? [item.rooms.id] : [])),
    ),
  ];
  const sessionIds = registrations.flatMap((registration) =>
    registration.basic_medical_registration_sessions.map(({ id }) => id),
  );
  const [inventoryResult, requestResult] = await Promise.all([
    roomIds.length
      ? supabase
          .from("basic_medical_room_inventory")
          .select(
            "id,room_id,catalog_item_id,total_quantity,good_quantity,damaged_quantity,is_active,last_damage_reported_at,room:rooms(id,room_code,building_code,room_name),catalog:basic_medical_equipment_catalog!inner(id,item_name,commercial_name,item_type,country_of_origin,manufacturer,model,unit,is_active),last_damage_reporter:profiles!basic_medical_room_inventory_last_damage_reporter_id_fkey(full_name)",
          )
          .in("room_id", roomIds)
          .eq("is_active", true)
          .eq("catalog.is_active", true)
          .order("created_at")
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length
      ? supabase
          .from("equipment_requests")
          .select(equipmentRequestSelect)
          .eq("request_domain", "basic_medical")
          .in("source_identity_id", sessionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const inventoryRows = inventoryResult.data;
  const inventoryError = inventoryResult.error;
  const requestRows = (requestResult.data ??
    []) as unknown as EquipmentRequestListItem[];
  const equipmentRequestsBySession = Object.fromEntries(
    requestRows.map((request) => [request.source_identity_id, request]),
  );

  const loadError =
    listError ?? registrationError ?? inventoryError ?? requestResult.error;

  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypeCodes}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={<LocalizedText text={"Phiếu Y cơ sở"} />}
      description={
        <LocalizedText
          text={
            "Theo dõi xác nhận từng buổi học và tình trạng thiết bị trong phòng."
          }
        />
      }
    >
      {query.notice ? (
        <p className="action-feedback success">{query.notice}</p>
      ) : null}
      {query.error || loadError ? (
        <p className="action-feedback error" role="alert">
          {query.error ?? (
            <LocalizedText
              text="Không thể tải dữ liệu: {0}"
              values={[loadError?.message]}
            />
          )}
        </p>
      ) : null}

      <form
        className="class-filter-panel equipment-request-filters basic-medical-registration-filters"
        method="get"
      >
        <label className="data-search">
          <Search size={18} aria-hidden="true" />
          <LocalizedElement
            as="input"
            textAttributes={["placeholder"]}
            name="q"
            type="search"
            defaultValue={search}
            placeholder="Tìm mã môn, tên môn, phòng, giảng viên…"
          />
        </label>
        <label className="class-range-mode">
          <span className="sr-only">
            <LocalizedText text={"Trạng thái"} />
          </span>
          <select name="status" defaultValue={status}>
            <option value="incomplete">
              <LocalizedText text={"Chưa hoàn thành"} />
            </option>
            <option value="completed">
              <LocalizedText text={"Hoàn thành"} />
            </option>
            <option value="cancelled">
              <LocalizedText text={"Đã hủy"} />
            </option>
            <option value="all">
              <LocalizedText text={"Tất cả"} />
            </option>
          </select>
        </label>
        <label className="equipment-date-filter">
          <span>
            <LocalizedText text={"Từ ngày"} />
          </span>
          <LocalizedElement
            as="input"
            textAttributes={["aria-label"]}
            aria-label="Từ ngày"
            name="from"
            type="date"
            defaultValue={query.from}
          />
        </label>
        <label className="equipment-date-filter">
          <span>
            <LocalizedText text={"Đến ngày"} />
          </span>
          <LocalizedElement
            as="input"
            textAttributes={["aria-label"]}
            aria-label="Đến ngày"
            name="to"
            type="date"
            defaultValue={query.to}
          />
        </label>
        <button type="submit" className="button button-primary">
          <LocalizedText text={"Lọc"} />
        </button>
        <a
          className="button button-secondary"
          href="/basic-medical/registrations"
        >
          <LocalizedText text={"Xóa bộ lọc"} />
        </a>
        <span className="equipment-filter-count">
          {count ?? 0}
          <LocalizedText text={" phiếu"} />
        </span>
      </form>

      <BasicMedicalRegistrationList
        registrations={registrations}
        inventories={
          (inventoryRows ?? []) as unknown as BasicMedicalRoomInventoryItem[]
        }
        instructors={instructors}
        activePeople={activePeople}
        viewerId={userId}
        isAdmin={roles.includes("admin")}
        canDelete={canDelete && roles.includes("admin")}
        evidenceEnabled={isBasicMedicalConfirmationEvidenceEnabled()}
        canManageBasicMedical={canManageBasicMedical}
        equipmentRequestsBySession={equipmentRequestsBySession}
        today={businessTodayString()}
      />
      <PaginationLinks
        currentPage={currentPage}
        totalItems={count ?? 0}
        pathname="/basic-medical/registrations"
        query={{ q: search, status, from: query.from, to: query.to }}
      />
    </WorkspaceShell>
  );
}
