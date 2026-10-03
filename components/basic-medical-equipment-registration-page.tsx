import {
  BasicMedicalEquipmentRequestForm,
  type BasicMedicalEquipmentRequestInitialData,
  type BasicMedicalEquipmentRegistrant,
} from "@/components/basic-medical-equipment-request-form";
import { BasicMedicalEquipmentRequestDetail } from "@/components/basic-medical-equipment-request-detail";
import {
  BasicMedicalEquipmentSessionSelector,
  type BasicMedicalEquipmentSessionOption,
} from "@/components/basic-medical-equipment-session-selector";
import { WorkspaceShell } from "@/components/workspace-shell";
import type {
  BasicMedicalEquipmentCatalogItem,
  BasicMedicalRegistrationListItem,
  BasicMedicalRegistrationSessionItem,
} from "@/lib/basic-medical-equipment";
import { businessTodayString } from "@/lib/business-time";
import {
  equipmentRequestCodeBounds,
  formatEquipmentRequestCode,
} from "@/lib/equipment-request-code";
import {
  equipmentRequestSelect,
  equipmentStatusMeta,
  type EquipmentRequestListItem,
} from "@/lib/equipment-requests";
import type { getViewer } from "@/lib/viewer";

type Viewer = Awaited<ReturnType<typeof getViewer>>;
type RequestMode = "edit" | "copy";

type BasicMedicalSessionRow = {
  id: string;
  session_number: number;
  lesson_title: string;
  teaching_lecturer_id: string;
  cancelled_at: string | null;
  teaching: { full_name: string } | null;
  class_schedules: {
    id: string;
    schedule_date: string;
    start_time: string;
    end_time: string;
    schedule_status: string;
  } | null;
  registration: Omit<
    BasicMedicalRegistrationListItem,
    "basic_medical_registration_sessions"
  > | null;
};

function isUuid(value: string | undefined) {
  return Boolean(value && /^[0-9a-f-]{36}$/i.test(value));
}

function sessionOptionLabel(
  registration: BasicMedicalRegistrationListItem,
  session: BasicMedicalRegistrationSessionItem,
) {
  const schedule = session.class_schedules;
  const date = schedule?.schedule_date.split("-").reverse().join("/") ?? "—";
  const time = schedule
    ? `${schedule.start_time.slice(0, 5)}–${schedule.end_time.slice(0, 5)}`
    : "—";
  const room = registration.rooms
    ? `${registration.rooms.room_code}.${registration.rooms.building_code}`
    : "—";
  return [
    date,
    time,
    registration.courses?.course_code,
    registration.courses?.course_name,
    `Buổi ${session.session_number}`,
    session.lesson_title,
    room,
  ]
    .filter(Boolean)
    .join(" · ");
}

function sessionIsActive(
  registration: BasicMedicalRegistrationListItem,
  session: BasicMedicalRegistrationSessionItem,
) {
  return !(
    registration.cancelled_at ||
    session.cancelled_at ||
    session.class_schedules?.schedule_status === "cancelled"
  );
}

function sessionCanCreateEquipmentRequest(
  registration: BasicMedicalRegistrationListItem,
  session: BasicMedicalRegistrationSessionItem,
  today: string,
) {
  return Boolean(
    sessionIsActive(registration, session) &&
    session.class_schedules?.schedule_date &&
    session.class_schedules.schedule_date >= today,
  );
}

function rootAdminAssignedToSession(
  session: BasicMedicalRegistrationSessionItem,
  viewerId: string,
  isRootAdministrator: boolean,
) {
  return isRootAdministrator && session.teaching_lecturer_id === viewerId;
}

function dateTimeInputParts(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function requestOptionLabel(request: EquipmentRequestListItem) {
  const schedule = request.class_schedules;
  const room = schedule?.rooms;
  return [
    `#${formatEquipmentRequestCode(request.created_at)}`,
    schedule?.course_code_snapshot,
    schedule?.schedule_date.split("-").reverse().join("/"),
    room ? `${room.room_code}.${room.building_code}` : null,
    request.profiles?.full_name,
  ]
    .filter(Boolean)
    .join(" · ");
}

function BasicMedicalRequestModePicker({
  mode,
  activeRequestKey,
  editOptions,
}: {
  mode: RequestMode | null;
  activeRequestKey: string;
  editOptions: EquipmentRequestListItem[];
}) {
  return (
    <section
      className="equipment-registration-tools"
      aria-label="Sao chép hoặc điều chỉnh phiếu"
    >
      <div className="equipment-registration-tools-heading">
        <strong>Thao tác với phiếu đã đăng ký</strong>
        {mode ? (
          <a
            className="button button-secondary"
            href="/basic-medical/equipment-requests"
          >
            Đăng ký mới
          </a>
        ) : null}
      </div>
      <div className="equipment-registration-mode-grid">
        <details className="equipment-registration-mode" open={mode === "edit"}>
          <summary className="button equipment-mode-button equipment-mode-edit">
            Điều chỉnh phiếu
          </summary>
          <form action="/basic-medical/equipment-requests" method="get">
            <input type="hidden" name="mode" value="edit" />
            <label>
              Chọn phiếu cần điều chỉnh
              <select
                name="request"
                required
                defaultValue={mode === "edit" ? activeRequestKey : ""}
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
          <form action="/basic-medical/equipment-requests" method="get">
            <input type="hidden" name="mode" value="copy" />
            <label>
              Mã phiếu nguồn
              <input
                name="request"
                required
                defaultValue={mode === "copy" ? activeRequestKey : ""}
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

function initialDataFromRequest(
  request: EquipmentRequestListItem,
  mode: RequestMode,
): BasicMedicalEquipmentRequestInitialData {
  const receive = dateTimeInputParts(request.receive_at);
  const returned = dateTimeInputParts(request.return_at);
  return {
    mode,
    sourceRequestId: request.id,
    requestRevision: request.preparation_revision,
    sourceRequestCode: formatEquipmentRequestCode(request.created_at),
    receiveDate: mode === "copy" ? "" : receive.date,
    receiveTime: receive.time,
    returnDate: mode === "copy" ? "" : returned.date,
    returnTime: returned.time,
    note: request.note ?? "",
    lateRegistrationReason:
      mode === "copy" ? "" : (request.late_registration_reason ?? ""),
    items: request.equipment_request_items.flatMap((item) => {
      const catalog = item.basic_medical_equipment_catalog;
      return catalog
        ? [
            {
              id: mode === "edit" ? item.id : undefined,
              itemName: catalog.item_name,
              catalogItemId: catalog.id,
              quantity: item.quantity,
              note: item.note ?? "",
            },
          ]
        : [];
    }),
  };
}

export async function BasicMedicalEquipmentRegistrationPage({
  viewer,
  sessionId,
  mode: rawMode,
  requestKey,
}: {
  viewer: Viewer;
  sessionId?: string;
  mode?: string;
  requestKey?: string;
}) {
  const {
    supabase,
    userId,
    fullName,
    email,
    roles,
    roomTypes,
    allowBasicMedicalAccess,
    canImportSchedules,
    canManagePersonnel,
    canManageEmailNotifications,
    canManageBasicMedical,
    isRootAdministrator,
  } = viewer;
  const roomTypeCodes = roomTypes.map(({ code }) => code);
  const today = businessTodayString();
  const mode: RequestMode | null =
    rawMode === "edit" || rawMode === "copy" ? rawMode : null;
  const activeRequestKey = String(requestKey ?? "").trim();
  const requestedId = isUuid(activeRequestKey) ? activeRequestKey : "";
  const requestedCodeBounds = requestedId
    ? null
    : equipmentRequestCodeBounds(activeRequestKey);
  const hasValidRequestKey = Boolean(requestedId || requestedCodeBounds);
  const { data: rawSessions, error: sessionError } = await supabase
    .from("basic_medical_registration_sessions")
    .select(
      "id,session_number,lesson_title,teaching_lecturer_id,cancelled_at,teaching:profiles!basic_medical_registration_sessions_teaching_lecturer_id_fkey(full_name),class_schedules!inner(id,schedule_date,start_time,end_time,schedule_status),registration:basic_medical_registrations!inner(id,created_by,registrant_id,registration_code,created_at,academic_year,semester,start_date,end_date,student_count,note,cancelled_at,cancelled_by,cancel_reason,courses(course_code,course_name),rooms(id,room_code,building_code,room_name),registrant:profiles!basic_medical_registrations_registrant_id_fkey(full_name),responsible:profiles!basic_medical_registrations_responsible_lecturer_id_fkey(full_name))",
    )
    .order("session_number");

  const visibleSources = (
    (rawSessions ?? []) as unknown as BasicMedicalSessionRow[]
  ).flatMap((row) => {
    if (!row.registration || !row.class_schedules) return [];
    const session: BasicMedicalRegistrationSessionItem = {
      id: row.id,
      session_number: row.session_number,
      lesson_title: row.lesson_title,
      teaching_lecturer_id: row.teaching_lecturer_id,
      teaching: row.teaching,
      cancelled_at: row.cancelled_at,
      class_schedules: row.class_schedules,
      confirmations: [],
    };
    const registration: BasicMedicalRegistrationListItem = {
      ...row.registration,
      basic_medical_registration_sessions: [session],
    };
    const eligible =
      canManageBasicMedical ||
      registration.created_by === userId ||
      registration.registrant_id === userId ||
      session.teaching_lecturer_id === userId;
    return eligible ? [{ registration, session }] : [];
  });
  const sourceIds = visibleSources.map(({ session }) => session.id);
  const { data: requestRows, error: requestError } = sourceIds.length
    ? await supabase
        .from("equipment_requests")
        .select(equipmentRequestSelect)
        .eq("request_domain", "basic_medical")
        .in("source_identity_id", sourceIds)
    : { data: [], error: null };
  const requestsBySession = new Map(
    ((requestRows ?? []) as unknown as EquipmentRequestListItem[]).map(
      (request) => [request.source_identity_id, request],
    ),
  );
  const sourceResult =
    mode && hasValidRequestKey
      ? await (() => {
          let query = supabase
            .from("equipment_requests")
            .select(equipmentRequestSelect)
            .eq("request_domain", "basic_medical");
          query = requestedId
            ? query.eq("id", requestedId)
            : query
                .gte("created_at", requestedCodeBounds!.from)
                .lt("created_at", requestedCodeBounds!.to);
          return (
            mode === "edit" ? query.in("status", ["new", "preparing"]) : query
          ).maybeSingle();
        })()
      : { data: null, error: null };
  const sourceRequest =
    sourceResult.data as unknown as EquipmentRequestListItem | null;
  const canUseSource = Boolean(
    sourceRequest &&
    (mode !== "edit" ||
      canManageBasicMedical ||
      sourceRequest.registrant_id === userId),
  );
  const selectedSessionId = isUuid(sessionId)
    ? sessionId
    : mode === "edit" && canUseSource
      ? sourceRequest?.source_identity_id
      : undefined;
  const selected = selectedSessionId
    ? visibleSources.find(({ session }) => session.id === selectedSessionId)
    : undefined;
  const selectedRequest = selected
    ? requestsBySession.get(selected.session.id)
    : undefined;
  const canEditSelected = Boolean(mode === "edit" && canUseSource && selected);
  const canCopySelected = Boolean(mode === "copy" && canUseSource && selected);
  const selectedHasRootAssignment = Boolean(
    selected &&
    rootAdminAssignedToSession(selected.session, userId, isRootAdministrator),
  );
  const canCreateSelected = Boolean(
    selected &&
    sessionCanCreateEquipmentRequest(
      selected.registration,
      selected.session,
      today,
    ) &&
    !selectedHasRootAssignment &&
    !selectedRequest &&
    (!mode || canCopySelected),
  );
  const needsForm = canEditSelected || canCreateSelected;
  const [catalogResult, profileResult] = await Promise.all([
    needsForm
      ? supabase
          .from("basic_medical_equipment_catalog")
          .select(
            "id,item_name,commercial_name,item_type,country_of_origin,manufacturer,model,unit,is_active",
          )
          .eq("is_active", true)
          .order("item_name")
      : Promise.resolve({ data: [], error: null }),
    needsForm
      ? supabase.from("profiles").select("phone").eq("id", userId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const availableSessionOptions: BasicMedicalEquipmentSessionOption[] =
    visibleSources
      .filter(
        ({ registration, session }) =>
          sessionCanCreateEquipmentRequest(registration, session, today) &&
          !rootAdminAssignedToSession(session, userId, isRootAdministrator) &&
          !requestsBySession.has(session.id),
      )
      .map(({ registration, session }) => {
        const label = sessionOptionLabel(registration, session);
        return { value: session.id, label, keywords: label };
      });
  const equipmentRegistrant: BasicMedicalEquipmentRegistrant = {
    id: userId,
    fullName,
    email,
    phone: profileResult.data?.phone ?? "",
  };
  const loadError = sessionError ?? requestError ?? catalogResult.error;
  const invalidSession = Boolean(sessionId && !isUuid(sessionId));
  const editOptions = [...requestsBySession.values()].filter(
    (request) =>
      ["new", "preparing"].includes(request.status) &&
      (canManageBasicMedical || request.registrant_id === userId),
  );
  const modeError =
    mode && activeRequestKey && !hasValidRequestKey
      ? "Mã phiếu không hợp lệ. Vui lòng nhập mã phiếu gồm 12 chữ số."
      : mode && hasValidRequestKey && !canUseSource
        ? mode === "edit"
          ? "Chỉ có thể điều chỉnh phiếu trạng thái Mới hoặc Đã soạn."
          : "Không tìm thấy phiếu Y cơ sở hoặc bạn không có quyền xem phiếu này."
        : mode && !hasValidRequestKey
          ? mode === "copy"
            ? "Vui lòng nhập mã phiếu trước khi tải dữ liệu."
            : "Vui lòng chọn một phiếu trước khi tải dữ liệu."
          : "";
  const initialData =
    mode && canUseSource && sourceRequest
      ? initialDataFromRequest(sourceRequest, mode)
      : undefined;

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
      description="Phiếu trang thiết bị thực hành cho buổi học Y cơ sở."
    >
      <BasicMedicalRequestModePicker
        mode={mode}
        activeRequestKey={activeRequestKey}
        editOptions={editOptions}
      />
      {loadError ? (
        <p className="form-error" role="alert">
          Không thể tải dữ liệu đăng ký thiết bị: {loadError.message}
        </p>
      ) : null}
      {modeError ? (
        <p className="form-error" role="alert">
          {modeError}
        </p>
      ) : null}
      {!selected ? (
        <>
          {invalidSession || sessionId ? (
            <p className="form-error" role="alert">
              Không tìm thấy buổi học Y cơ sở phù hợp để đăng ký thiết bị.
            </p>
          ) : null}
          <BasicMedicalEquipmentSessionSelector
            sessions={availableSessionOptions}
            mode={mode === "copy" && canUseSource ? "copy" : undefined}
            requestKey={
              mode === "copy" && canUseSource ? activeRequestKey : undefined
            }
          />
        </>
      ) : canEditSelected && initialData ? (
        <BasicMedicalEquipmentRequestForm
          key={`${initialData.sourceRequestId}:${initialData.requestRevision}`}
          registration={selected.registration}
          session={selected.session}
          catalog={
            (catalogResult.data ?? []) as BasicMedicalEquipmentCatalogItem[]
          }
          today={today}
          equipmentRegistrant={equipmentRegistrant}
          initialData={initialData}
        />
      ) : selectedRequest ? (
        <>
          <section className="data-panel">
            <strong>
              {selectedRequest.status === "cancelled"
                ? "Phiếu thiết bị đã hủy"
                : `Phiếu thiết bị ${equipmentStatusMeta(selectedRequest.status).label}`}
            </strong>
          </section>
          <BasicMedicalEquipmentRequestDetail
            request={selectedRequest}
            registration={selected.registration}
            session={selected.session}
          />
        </>
      ) : canCreateSelected ? (
        <BasicMedicalEquipmentRequestForm
          registration={selected.registration}
          session={selected.session}
          catalog={
            (catalogResult.data ?? []) as BasicMedicalEquipmentCatalogItem[]
          }
          today={today}
          equipmentRegistrant={equipmentRegistrant}
          initialData={initialData}
        />
      ) : (
        <>
          <p className="form-error" role="alert">
            {selectedHasRootAssignment
              ? "Buổi học đang phân công Root Admin làm giảng viên. Vui lòng điều chỉnh giảng viên giảng dạy/hướng dẫn trước khi đăng ký thiết bị."
              : "Buổi học Y cơ sở đã hủy hoặc không còn hợp lệ để đăng ký thiết bị."}
          </p>
          <BasicMedicalEquipmentSessionSelector
            sessions={availableSessionOptions}
            mode={mode === "copy" && canUseSource ? "copy" : undefined}
            requestKey={
              mode === "copy" && canUseSource ? activeRequestKey : undefined
            }
          />
        </>
      )}
    </WorkspaceShell>
  );
}
