import { redirect } from "next/navigation";
import {
  EquipmentRequestForm,
  type EquipmentRequestInitialData,
} from "@/components/equipment-request-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { businessTodayString } from "@/lib/business-time";
import {
  equipmentRequestCodeBounds,
  formatEquipmentRequestCode,
} from "@/lib/equipment-request-code";
import { NURSING_SKILLS_ROOM_TYPE_ID } from "@/lib/room-types";
import { getViewer } from "@/lib/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EquipmentLateApprovalStatus } from "@/lib/equipment-requests";
import {
  canUseSkillsWorkspace,
  defaultWorkspacePath,
} from "@/lib/workspace-access";

type RequestMode = "copy" | "edit";

type RegisterSearchParams = {
  schedule?: string;
  mode?: string;
  request?: string;
};

type RequestOption = {
  id: string;
  created_at: string;
  status: string;
  registrant_id: string;
  registrant: { full_name: string } | null;
  class_schedules: {
    schedule_date: string;
    course_code_snapshot: string;
    rooms: { room_code: string; building_code: string } | null;
  } | null;
};

type SourceRequest = {
  id: string;
  preparation_revision: number;
  created_at: string;
  status: string;
  semester: string;
  class_schedule_id: string;
  registrant_id: string;
  responsible_lecturer_id: string;
  phone_snapshot: string;
  email_snapshot: string;
  receive_at: string;
  return_at: string;
  note: string | null;
  late_approval_status: EquipmentLateApprovalStatus;
  late_registration_reason: string | null;
  registrant: { full_name: string } | null;
  responsible: { full_name: string } | null;
  equipment_request_items: Array<{
    id: string;
    skill_name: string;
    quantity: number;
    note: string | null;
    equipment_catalog: { id: string; item_name: string } | null;
  }>;
};

const requestDraftSelect =
  "id,preparation_revision,created_at,status,semester,class_schedule_id,registrant_id,responsible_lecturer_id,phone_snapshot,email_snapshot,receive_at,return_at,note,late_approval_status,late_registration_reason,registrant:profiles!equipment_requests_registrant_id_fkey(full_name),responsible:profiles!equipment_requests_responsible_lecturer_id_fkey(full_name),equipment_request_items(id,skill_name,quantity,note,equipment_catalog(id,item_name))";

const dateTimeInputFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function dateTimeInputParts(value: string) {
  const parts = Object.fromEntries(
    dateTimeInputFormatter
      .formatToParts(new Date(value))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: partValue }) => [type, partValue]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function requestOptionLabel(request: RequestOption) {
  const schedule = request.class_schedules;
  const room = schedule?.rooms;
  const date =
    schedule?.schedule_date.split("-").reverse().join("/") ?? "Chưa có ngày";
  return [
    `#${formatEquipmentRequestCode(request.created_at)}`,
    schedule?.course_code_snapshot,
    date,
    room ? `${room.room_code}.${room.building_code}` : null,
    request.registrant?.full_name,
  ]
    .filter(Boolean)
    .join(" · ");
}

function RequestModePicker({
  mode,
  activeRequestId,
  editOptions,
}: {
  mode: RequestMode | null;
  activeRequestId: string;
  editOptions: RequestOption[];
}) {
  return (
    <section
      className="equipment-registration-tools"
      aria-label="Sao chép hoặc điều chỉnh phiếu"
    >
      <div className="equipment-registration-tools-heading">
        <strong>Thao tác với phiếu đã đăng ký</strong>
        {mode ? (
          <a className="button button-secondary" href="/equipment/register">
            Đăng ký mới
          </a>
        ) : null}
      </div>
      <div className="equipment-registration-mode-grid">
        <details className="equipment-registration-mode" open={mode === "edit"}>
          <summary className="button equipment-mode-button equipment-mode-edit">
            Điều chỉnh phiếu
          </summary>
          <form action="/equipment/register" method="get">
            <input type="hidden" name="mode" value="edit" />
            <label>
              Chọn phiếu cần điều chỉnh
              <select
                name="request"
                required
                defaultValue={mode === "edit" ? activeRequestId : ""}
              >
                <option value="" disabled>
                  Chọn phiếu của bạn
                </option>
                {editOptions.map((request) => (
                  <option key={request.id} value={request.id}>
                    {requestOptionLabel(request)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-primary"
              disabled={!editOptions.length}
            >
              Tải phiếu để điều chỉnh
            </button>
          </form>
        </details>

        <details className="equipment-registration-mode" open={mode === "copy"}>
          <summary className="button equipment-mode-button equipment-mode-copy">
            Sao chép phiếu
          </summary>
          <form action="/equipment/register" method="get">
            <input type="hidden" name="mode" value="copy" />
            <label>
              Mã phiếu nguồn
              <input
                name="request"
                required
                defaultValue={mode === "copy" ? activeRequestId : ""}
                placeholder="Nhập mã phiếu, ví dụ: 123465789356"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button className="button button-primary">
              Tải dữ liệu để sao chép
            </button>
          </form>
        </details>
      </div>
    </section>
  );
}

function buildInitialData(
  source: SourceRequest,
  mode: RequestMode,
  userId: string,
  selectedScheduleId: string,
  viewerIsRoot: boolean,
  rootAdministratorId: string | null,
): EquipmentRequestInitialData {
  const receive = dateTimeInputParts(source.receive_at);
  const returned = dateTimeInputParts(source.return_at);
  const grouped = new Map<
    string,
    EquipmentRequestInitialData["skills"][number]["rows"]
  >();

  for (const item of source.equipment_request_items) {
    if (!item.equipment_catalog) continue;
    const rows = grouped.get(item.skill_name) ?? [];
    rows.push({
      id: mode === "edit" ? item.id : undefined,
      itemName: item.equipment_catalog.item_name,
      catalogItemId: item.equipment_catalog.id,
      quantity: item.quantity,
      note: item.note ?? "",
    });
    grouped.set(item.skill_name, rows);
  }

  return {
    mode,
    sourceRequestId: source.id,
    requestRevision: source.preparation_revision,
    sourceRequestCode: formatEquipmentRequestCode(source.created_at),
    classId: mode === "copy" ? selectedScheduleId : source.class_schedule_id,
    semester: source.semester,
    responsibleLecturerId:
      mode === "copy"
        ? viewerIsRoot
          ? ""
          : userId
        : source.responsible_lecturer_id === rootAdministratorId
          ? ""
          : source.responsible_lecturer_id,
    requiresResponsibleLecturerReplacement:
      mode === "edit" && source.responsible_lecturer_id === rootAdministratorId,
    historicalResponsibleLecturerName: source.responsible?.full_name ?? null,
    receiveDate: mode === "copy" ? "" : receive.date,
    receiveTime: receive.time,
    returnDate: mode === "copy" ? "" : returned.date,
    returnTime: returned.time,
    note: source.note ?? "",
    lateApprovalStatus:
      mode === "copy" ? "not_required" : source.late_approval_status,
    lateRegistrationReason:
      mode === "copy" ? "" : (source.late_registration_reason ?? ""),
    skills: [...grouped].map(([skillName, rows]) => ({ skillName, rows })),
  };
}

export default async function EquipmentRegisterPage({
  searchParams,
}: {
  searchParams: Promise<RegisterSearchParams>;
}) {
  const [viewer, query] = await Promise.all([getViewer(), searchParams]);
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
    isRootAdministrator,
  } = viewer;
  const roomTypeCodes = roomTypes.map(({ code }) => code);
  const canUseSkills = canUseSkillsWorkspace(roles, roomTypeCodes);
  if (!canUseSkills) {
    redirect(defaultWorkspacePath(roles, roomTypeCodes));
  }
  if (
    !roles.some((role) =>
      ["lecturer", "staff", "admin", "teaching_assistant"].includes(role),
    )
  ) {
    redirect("/dashboard");
  }

  const mode: RequestMode | null =
    query.mode === "copy" || query.mode === "edit" ? query.mode : null;
  const rawRequestId = String(query.request ?? "").trim();
  const requestedId = /^[0-9a-f-]{36}$/i.test(rawRequestId) ? rawRequestId : "";
  const requestedCodeBounds = !requestedId
    ? equipmentRequestCodeBounds(rawRequestId)
    : null;
  const hasValidRequestKey = Boolean(requestedId || requestedCodeBounds);
  const sourcePromise =
    mode && hasValidRequestKey
      ? (() => {
          let sourceQuery = supabase
            .from("equipment_requests")
            .select(requestDraftSelect);
          sourceQuery = requestedId
            ? sourceQuery.eq("id", requestedId)
            : sourceQuery
                .gte("created_at", requestedCodeBounds!.from)
                .lt("created_at", requestedCodeBounds!.to);
          return (
            mode === "edit"
              ? sourceQuery.in("status", ["new", "preparing"])
              : sourceQuery
          ).maybeSingle();
        })()
      : Promise.resolve({ data: null, error: null });

  const [
    { data: schedules },
    { data: catalog },
    { data: lecturers },
    { data: profile },
    { data: priorItems },
    { data: requestOptionRows },
    sourceResult,
    { data: rootPrincipal },
  ] = await Promise.all([
    supabase
      .from("class_schedules")
      .select(
        "id,schedule_date,start_time,end_time,course_code_snapshot,course_name_snapshot,student_count,semester,rooms!inner(room_code,building_code,room_type_id)",
      )
      .eq("rooms.room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
      .gte("schedule_date", businessTodayString())
      .neq("schedule_status", "cancelled")
      .order("schedule_date")
      .limit(200),
    supabase
      .from("equipment_catalog")
      .select(
        "id,item_name,commercial_name,item_type,country_of_origin,manufacturer,model,unit",
      )
      .eq("is_active", true)
      .order("item_name"),
    supabase.rpc("list_scoped_lecturers", {
      target_room_type_id: NURSING_SKILLS_ROOM_TYPE_ID,
    }),
    supabase
      .from("profiles")
      .select("phone,email")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("equipment_request_items")
      .select("skill_name")
      .order("skill_name")
      .limit(1000),
    supabase
      .from("equipment_requests")
      .select(
        "id,created_at,status,registrant_id,registrant:profiles!equipment_requests_registrant_id_fkey(full_name),class_schedules(schedule_date,course_code_snapshot,rooms(room_code,building_code))",
      )
      .in("status", ["new", "preparing"])
      .order("created_at", { ascending: false })
      .limit(200),
    sourcePromise,
    createAdminClient()
      .from("system_security_principals")
      .select("root_admin_id")
      .eq("singleton", true)
      .maybeSingle(),
  ]);

  const canManageAll = roles.some((role) => ["admin", "staff"].includes(role));
  const requestOptions = (requestOptionRows ??
    []) as unknown as RequestOption[];
  const editOptions = requestOptions.filter(
    (request) => canManageAll || request.registrant_id === userId,
  );
  const source = sourceResult.data as unknown as SourceRequest | null;
  const canUseSource = Boolean(
    source &&
    (mode !== "edit" || ["new", "preparing"].includes(source.status)) &&
    (mode !== "edit" || canManageAll || source.registrant_id === userId),
  );
  if (mode === "edit" && canUseSource && source?.status === "preparing") {
    redirect(`/equipment/preparation/${source.id}`);
  }
  const loadError =
    mode && rawRequestId && !hasValidRequestKey
      ? "Mã phiếu không hợp lệ. Vui lòng nhập mã phiếu gồm 12 chữ số."
      : mode && hasValidRequestKey && !canUseSource
        ? mode === "edit"
          ? "Chỉ có thể điều chỉnh phiếu trạng thái Mới hoặc Đã soạn mà bạn được phép quản lý."
          : "Không tìm thấy phiếu nguồn hoặc bạn không có quyền xem phiếu này."
        : mode && !hasValidRequestKey
          ? mode === "copy"
            ? "Vui lòng nhập mã phiếu trước khi tải dữ liệu."
            : "Vui lòng chọn một phiếu trước khi tải dữ liệu."
          : "";

  let scheduleRows = schedules ?? [];
  if (
    mode === "edit" &&
    canUseSource &&
    source &&
    !scheduleRows.some(({ id }) => id === source.class_schedule_id)
  ) {
    const { data: currentSchedule } = await supabase
      .from("class_schedules")
      .select(
        "id,schedule_date,start_time,end_time,course_code_snapshot,course_name_snapshot,student_count,semester,rooms!inner(room_code,building_code,room_type_id)",
      )
      .eq("id", source.class_schedule_id)
      .eq("rooms.room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
      .neq("schedule_status", "cancelled")
      .maybeSingle();
    if (currentSchedule) scheduleRows = [currentSchedule, ...scheduleRows];
  }

  const classes = scheduleRows.map((schedule) => {
    const room = schedule.rooms as unknown as {
      room_code: string;
      building_code: string;
    };
    return {
      id: schedule.id,
      date: schedule.schedule_date,
      start: schedule.start_time.slice(0, 5),
      end: schedule.end_time.slice(0, 5),
      courseCode: schedule.course_code_snapshot,
      courseName: schedule.course_name_snapshot,
      studentCount: schedule.student_count,
      semester: schedule.semester ?? undefined,
      room: `${room.room_code}.${room.building_code}`,
      label: `${schedule.schedule_date.split("-").reverse().join("/")} · ${schedule.start_time.slice(0, 5)}–${schedule.end_time.slice(0, 5)} · ${schedule.course_code_snapshot} · ${room.room_code}.${room.building_code}`,
    };
  });

  const initialData =
    mode && canUseSource && source
      ? buildInitialData(
          source,
          mode,
          userId,
          query.schedule ?? "",
          isRootAdministrator,
          rootPrincipal?.root_admin_id ?? null,
        )
      : undefined;
  const editingAnotherRegistrant =
    initialData?.mode === "edit" && source?.registrant_id !== userId;
  const formRegistrantId =
    editingAnotherRegistrant && source ? source.registrant_id : userId;
  const formRegistrantName =
    editingAnotherRegistrant && source
      ? (source.registrant?.full_name ?? "Người đăng ký")
      : fullName;
  const formRegistrantEmail =
    editingAnotherRegistrant && source
      ? source.email_snapshot
      : (profile?.email ?? "");
  const formPhone =
    editingAnotherRegistrant && source
      ? source.phone_snapshot
      : (profile?.phone ?? "");
  const skillSuggestions = [
    ...new Set(
      (priorItems ?? []).map(({ skill_name }) => skill_name).filter(Boolean),
    ),
  ];

  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypeCodes}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title="Đăng ký thiết bị"
      description="Phiếu trang thiết bị thực hành cho lớp Skills lab."
    >
      <RequestModePicker
        mode={mode}
        activeRequestId={rawRequestId}
        editOptions={editOptions}
      />
      {loadError ? (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      ) : null}
      <EquipmentRequestForm
        key={
          initialData
            ? `${initialData.mode}:${initialData.sourceRequestId}`
            : "new"
        }
        classes={classes}
        catalog={catalog ?? []}
        lecturers={lecturers ?? []}
        defaultPhone={formPhone}
        defaultClassId={initialData?.classId ?? query.schedule ?? ""}
        registrantId={formRegistrantId}
        registrantName={formRegistrantName}
        registrantEmail={formRegistrantEmail}
        registrantIsOperationallyAssignable={
          formRegistrantId !== rootPrincipal?.root_admin_id
        }
        skillSuggestions={skillSuggestions}
        today={businessTodayString()}
        initialData={initialData}
      />
    </WorkspaceShell>
  );
}
