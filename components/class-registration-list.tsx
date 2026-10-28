"use client";

import { CalendarDays, Download, Search, Trash2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  updateClassSchedule,
  claimClass,
  deleteClassSchedule,
  withdrawClass,
} from "@/app/dashboard/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatBusinessDate } from "@/lib/business-time";
import type { ClassDateRange, ClassRangeMode } from "@/lib/class-date-range";
import type { AppRole } from "@/lib/viewer";
import { useScheduleRealtime } from "@/lib/use-schedule-realtime";
import {
  SearchableCombobox,
  type ComboboxOption,
} from "@/components/searchable-combobox";
import { TimePicker } from "@/components/time-picker";
import { PaginationControls } from "@/components/pagination-controls";
import { TABLE_PAGE_SIZE, totalPagesFor } from "@/lib/pagination";
import { useLanguage } from "@/components/i18n/language-provider";

export type RegistrationClass = {
  id: string;
  course_id?: string | null;
  schedule_date: string;
  start_time: string;
  end_time: string;
  course_code_snapshot: string;
  course_name_snapshot: string;
  lecturer_id: string | null;
  lecturer_2_id: string | null;
  lecturerNames: string[];
  claimable: boolean;
  roomLabel: string;
  roomId: string;
  roomTypeId: string;
  roomTypeName: string;
  student_count: number;
  created_by?: string | null;
  has_equipment_request?: boolean;
};

export function ClassRegistrationList({
  classes,
  mode,
  viewerId,
  roles,
  range,
  courses = [],
  lecturerOptionsByRoomType = {},
  roomTypeOptions = [],
  roomOptions = [],
  isRootAdministrator = false,
}: {
  classes: RegistrationClass[];
  mode: "open" | "mine";
  viewerId: string;
  roles: AppRole[];
  range: ClassDateRange;
  courses?: Array<{ id: string; course_code: string; course_name: string }>;
  lecturerOptionsByRoomType?: Record<string, ComboboxOption[]>;
  roomTypeOptions?: Array<{ id: string; name: string }>;
  roomOptions?: Array<{ id: string; label: string; roomTypeId: string }>;
  isRootAdministrator?: boolean;
}) {
  const { text: uiText } = useLanguage();

  const router = useRouter();
  useScheduleRealtime();
  const [query, setQuery] = useState("");
  const [emptyOnly, setEmptyOnly] = useState(false);
  const [roomTypeId, setRoomTypeId] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [rangeMode, setRangeMode] = useState<ClassRangeMode>(range.mode);
  const [anchorDate, setAnchorDate] = useState(range.anchor);
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const courseMap = useMemo(
    () => new Map(courses.map((c) => [c.id, c])),
    [courses],
  );

  const [assignmentDrafts, setAssignmentDrafts] = useState<
    Record<string, string[]>
  >(() =>
    Object.fromEntries(
      classes.map((item) => [
        item.id,
        [item.lecturer_id ?? "", item.lecturer_2_id ?? ""],
      ]),
    ),
  );

  const [detailDrafts, setDetailDrafts] = useState<
    Record<
      string,
      {
        date: string;
        start: string;
        end: string;
        courseId: string;
        roomId: string;
        studentCount: string;
      }
    >
  >(() =>
    Object.fromEntries(
      classes.map((item) => [
        item.id,
        {
          date: item.schedule_date,
          start: item.start_time.slice(0, 5),
          end: item.end_time.slice(0, 5),
          courseId: item.course_id ?? "",
          roomId: item.roomId,
          studentCount: String(item.student_count ?? ""),
        },
      ]),
    ),
  );

  const [confirmation, setConfirmation] = useState<{
    item: RegistrationClass;
    action: "withdraw" | "delete";
  } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    range.error ? { ok: false, text: range.error } : null,
  );
  const [pending, startTransition] = useTransition();

  const isManager = roles.some((role) => ["admin", "staff"].includes(role));
  const isTA = roles.includes("teaching_assistant");
  const isLecturer = roles.includes("lecturer");
  const canClaim =
    !isRootAdministrator &&
    (roles.includes("lecturer") || roles.includes("admin"));

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    return classes.filter((item) => {
      if (mode === "open" && emptyOnly && item.lecturerNames.length > 0)
        return false;
      if (roomTypeId !== "all" && item.roomTypeId !== roomTypeId) return false;
      if (!normalized) return true;
      return [
        item.course_code_snapshot,
        item.course_name_snapshot,
        item.roomLabel,
        item.lecturerNames.join(" ") || "Chưa có giảng viên",
        item.schedule_date,
      ].some((value) => value.toLocaleLowerCase("vi").includes(normalized));
    });
  }, [classes, emptyOnly, mode, query, roomTypeId]);

  const safePage = Math.min(
    currentPage,
    totalPagesFor(filtered.length, TABLE_PAGE_SIZE),
  );
  const pageItems = filtered.slice(
    (safePage - 1) * TABLE_PAGE_SIZE,
    safePage * TABLE_PAGE_SIZE,
  );

  async function exportFilteredClasses() {
    if (!filtered.length || exporting) return;
    setExporting(true);
    setMessage(null);
    try {
      const XLSX = await import("@e965/xlsx");
      const rows = filtered.map((item, index) => ({
        STT: index + 1,
        "Ngày học": formatBusinessDate(item.schedule_date),
        "Giờ bắt đầu": item.start_time.slice(0, 5),
        "Giờ kết thúc": item.end_time.slice(0, 5),
        "Mã môn học": item.course_code_snapshot,
        "Tên môn học": item.course_name_snapshot,
        "Phòng/Lab": item.roomLabel,
        "Loại phòng": item.roomTypeName,
        "Số sinh viên": item.student_count,
        "Giảng viên 1": item.lecturerNames[0] ?? "",
        "Giảng viên 2": item.lecturerNames[1] ?? "",
      }));
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [
        { wch: 7 },
        { wch: 14 },
        { wch: 13 },
        { wch: 13 },
        { wch: 16 },
        { wch: 42 },
        { wch: 18 },
        { wch: 24 },
        { wch: 14 },
        { wch: 28 },
        { wch: 28 },
      ];
      XLSX.utils.book_append_sheet(workbook, sheet, "Lớp đang mở");
      const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
      const url = URL.createObjectURL(
        new Blob([output], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `lop-dang-mo-${range.from.replaceAll("-", "")}-${range.to.replaceAll("-", "")}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage({ ok: false, text: "Không thể xuất danh sách lớp." });
    } finally {
      setExporting(false);
    }
  }

  function applyRange(
    nextMode = rangeMode,
    nextAnchor = anchorDate,
    nextFrom = customFrom,
    nextTo = customTo,
  ) {
    setCurrentPage(1);
    const params = new URLSearchParams({ period: nextMode });
    if (nextMode === "custom") {
      const from = new Date(`${nextFrom}T00:00:00`);
      const to = new Date(`${nextTo}T00:00:00`);
      const sixMonthsLater = new Date(from);
      sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
      if (!nextFrom || !nextTo || from > to || to > sixMonthsLater) {
        setMessage({
          ok: false,
          text: "Khoảng lọc phải hợp lệ và không vượt quá 6 tháng.",
        });
        return;
      }
      params.set("from", nextFrom);
      params.set("to", nextTo);
    } else if (nextMode !== "default") {
      params.set("date", nextAnchor);
    }
    router.push(
      `${mode === "open" ? "/classes/open" : "/classes/mine"}?${params}`,
      {
        scroll: false,
      },
    );
  }

  function runAction(
    item: RegistrationClass,
    action: "claim" | "withdraw" | "delete",
  ) {
    setMessage(null);
    setPendingId(item.id);
    startTransition(async () => {
      const result =
        action === "claim"
          ? await claimClass(item.id)
          : action === "withdraw"
            ? await withdrawClass(item.id)
            : await deleteClassSchedule(item.id);
      setMessage({ ok: result.ok, text: result.message });
      setPendingId(null);
      if (result.ok) router.refresh();
    });
  }

  function saveRow(item: RegistrationClass) {
    const draft = detailDrafts[item.id];
    if (!draft) return;
    if (!draft.date) {
      setMessage({ ok: false, text: "Vui lòng chọn ngày học." });
      return;
    }
    if (!draft.start || !draft.end || draft.end <= draft.start) {
      setMessage({ ok: false, text: "Thời gian học không hợp lệ." });
      return;
    }
    const rawStudentCount = draft.studentCount.trim();
    if (!rawStudentCount) {
      setMessage({ ok: false, text: "Vui lòng nhập số sinh viên." });
      return;
    }
    const studentCount = Number(rawStudentCount);
    if (!Number.isInteger(studentCount) || studentCount < 1) {
      setMessage({
        ok: false,
        text: "Số sinh viên phải là số nguyên từ 1 trở lên.",
      });
      return;
    }

    const assignmentDraft = assignmentDrafts[item.id] ?? [
      item.lecturer_id ?? "",
      item.lecturer_2_id ?? "",
    ];
    const lecturerIds = isManager
      ? assignmentDraft.filter(Boolean)
      : ([item.lecturer_id, item.lecturer_2_id].filter(Boolean) as string[]);

    setMessage(null);
    setPendingId(item.id);
    startTransition(async () => {
      const result = await updateClassSchedule(item.id, {
        scheduleDate: draft.date,
        startTime: draft.start,
        endTime: draft.end,
        courseId: draft.courseId || item.course_id || undefined,
        roomId: draft.roomId,
        studentCount,
        lecturerIds,
      });
      setMessage({ ok: result.ok, text: result.message });
      setPendingId(null);
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="data-panel class-list-panel">
      <div className="class-filter-panel">
        <label className="data-search">
          <Search size={18} />
          <input
            name="class_search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCurrentPage(1);
            }}
            placeholder={uiText("Tìm mã môn học, tên lớp, phòng, giảng viên…")}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="class-range-mode">
          <CalendarDays size={17} />
          <select
            aria-label={uiText("Kiểu lọc thời gian")}
            value={rangeMode}
            onChange={(event) => {
              const nextMode = event.target.value as ClassRangeMode;
              setCurrentPage(1);
              setRangeMode(nextMode);
              applyRange(nextMode);
            }}
          >
            <option value="default">{uiText("Mặc định")}</option>
            <option value="week">{uiText("Theo tuần")}</option>
            <option value="month">{uiText("Theo tháng")}</option>
            <option value="day">{uiText("Chọn ngày")}</option>
            <option value="custom">{uiText("Khoảng tùy chỉnh")}</option>
          </select>
        </label>
        {rangeMode === "custom" ? (
          <div className="class-range-dates">
            <input
              name="from_date"
              aria-label={uiText("Từ ngày")}
              type="date"
              value={customFrom}
              onChange={(event) => {
                const value = event.target.value;
                setCustomFrom(value);
                applyRange("custom", anchorDate, value, customTo);
              }}
            />
            <span>{uiText("đến")}</span>
            <input
              name="to_date"
              aria-label={uiText("Đến ngày")}
              type="date"
              value={customTo}
              onChange={(event) => {
                const value = event.target.value;
                setCustomTo(value);
                applyRange("custom", anchorDate, customFrom, value);
              }}
            />
          </div>
        ) : rangeMode !== "default" ? (
          <input
            name="anchor_date"
            aria-label={uiText("Ngày làm mốc")}
            type="date"
            value={anchorDate}
            onChange={(event) => {
              const value = event.target.value;
              setAnchorDate(value);
              applyRange(rangeMode, value);
            }}
          />
        ) : null}
        {mode === "open" ? (
          <label className="empty-class-toggle">
            <input
              name="empty_classes"
              type="checkbox"
              checked={emptyOnly}
              onChange={(event) => {
                setEmptyOnly(event.target.checked);
                setCurrentPage(1);
              }}
            />
            {uiText("Lớp trống")}
          </label>
        ) : null}
        {mode === "open" && roomTypeOptions.length > 1 ? (
          <label className="class-range-mode">
            <span className="sr-only">{uiText("Loại phòng")}</span>
            <select
              value={roomTypeId}
              onChange={(event) => {
                setRoomTypeId(event.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="all">{uiText("Tất cả Loại phòng")}</option>
              {roomTypeOptions.map((roomType) => (
                <option key={roomType.id} value={roomType.id}>
                  {roomType.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {mode === "open" ? (
          <button
            className="button button-secondary"
            type="button"
            disabled={!filtered.length || exporting}
            onClick={exportFilteredClasses}
          >
            <Download size={17} /> {exporting ? uiText("Đang xuất…") : "Export"}
          </button>
        ) : null}
        <span className="inline-toolbar-count-slot class-result-count-slot">
          <span className="class-result-count inline-toolbar-count">
            {filtered.length}
            {uiText(" lớp")}
          </span>
        </span>
      </div>

      {message ? (
        <p
          className={`action-feedback ${message.ok ? "success" : "error"}`}
          role="status"
        >
          {uiText(message.text)}
        </p>
      ) : null}

      <div
        className="responsive-table"
        role="region"
        aria-label={uiText("Danh sách lớp; vuốt ngang để xem đầy đủ")}
        tabIndex={0}
      >
        <table
          className={`data-table class-registration-table class-registration-table-${mode}`}
        >
          <colgroup>
            <col className="class-registration-col-date" />
            <col className="class-registration-col-time" />
            <col className="class-registration-col-course-code" />
            <col className="class-registration-col-course-name" />
            <col className="class-registration-col-room" />
            <col className="class-registration-col-student-count" />
            {mode === "open" ? (
              <col className="class-registration-col-lecturers" />
            ) : null}
            <col className="class-registration-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>{uiText("Ngày")}</th>
              <th>{uiText("Thời gian")}</th>
              <th>{uiText("Mã môn")}</th>
              <th>{uiText("Tên môn học")}</th>
              <th>{uiText("Phòng")}</th>
              <th>{uiText("Số sinh viên")}</th>
              {mode === "open" ? <th>{uiText("Giảng viên")}</th> : null}
              <th>
                <span className="sr-only">{uiText("Thao tác")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((item) => {
              const lecturerIds = [item.lecturer_id, item.lecturer_2_id].filter(
                Boolean,
              ) as string[];
              const assignmentDraft = assignmentDrafts[item.id] ?? [
                item.lecturer_id ?? "",
                item.lecturer_2_id ?? "",
              ];
              const duplicateAssignment = Boolean(
                assignmentDraft[0] &&
                assignmentDraft[1] &&
                assignmentDraft[0] === assignmentDraft[1],
              );
              const isTAOwner = isTA && item.created_by === viewerId;
              const isLecturerAssigned =
                isLecturer &&
                (item.lecturer_id === viewerId ||
                  item.lecturer_2_id === viewerId);
              const isLecturerCreator =
                isLecturer && item.created_by === viewerId;
              const isLecturerRelated = isLecturerAssigned || isLecturerCreator;

              const isLocked = Boolean(item.has_equipment_request);
              const canEditDetails =
                !isLocked && (isManager || isTAOwner || isLecturerRelated);
              const canManageLecturers = !isLocked && isManager;
              const canDeleteRow =
                !isLocked && (isManager || isTAOwner || isLecturerCreator);
              const canWithdrawRow =
                !isLocked && isLecturerAssigned && canClaim && item.claimable;
              const canJoinRow =
                !isLocked &&
                canClaim &&
                item.claimable &&
                lecturerIds.length < 2 &&
                !lecturerIds.includes(viewerId);

              const detailDraft = detailDrafts[item.id] ?? {
                date: item.schedule_date,
                start: item.start_time.slice(0, 5),
                end: item.end_time.slice(0, 5),
                courseId: item.course_id ?? "",
                roomId: item.roomId,
                studentCount: String(item.student_count ?? ""),
              };
              const updateDetail = (patch: Partial<typeof detailDraft>) =>
                setDetailDrafts((current) => ({
                  ...current,
                  [item.id]: { ...(current[item.id] ?? detailDraft), ...patch },
                }));

              const displayedCourseName =
                canEditDetails &&
                detailDraft.courseId &&
                courseMap.has(detailDraft.courseId)
                  ? courseMap.get(detailDraft.courseId)!.course_name
                  : item.course_name_snapshot;

              return (
                <tr key={item.id}>
                  <td>
                    {canEditDetails ? (
                      <input
                        aria-label={uiText("Ngày học {0}", [
                          item.course_code_snapshot,
                        ])}
                        type="date"
                        value={detailDraft.date}
                        onChange={(event) =>
                          updateDetail({ date: event.target.value })
                        }
                      />
                    ) : (
                      formatBusinessDate(item.schedule_date)
                    )}
                  </td>
                  <td className="mono">
                    {canEditDetails ? (
                      <span className="inline-time-editor">
                        <TimePicker
                          ariaLabel={uiText("Giờ bắt đầu {0}", [
                            item.course_code_snapshot,
                          ])}
                          value={detailDraft.start}
                          onChange={(val) => updateDetail({ start: val })}
                          required
                        />
                        <TimePicker
                          ariaLabel={uiText("Giờ kết thúc {0}", [
                            item.course_code_snapshot,
                          ])}
                          value={detailDraft.end}
                          onChange={(val) => updateDetail({ end: val })}
                          required
                        />
                      </span>
                    ) : (
                      `${item.start_time.slice(0, 5)}–${item.end_time.slice(0, 5)}`
                    )}
                  </td>
                  <td>
                    {canEditDetails && courses.length > 0 ? (
                      <select
                        aria-label={uiText("Mã môn học {0}", [
                          item.course_code_snapshot,
                        ])}
                        value={detailDraft.courseId || item.course_id || ""}
                        onChange={(event) =>
                          updateDetail({ courseId: event.target.value })
                        }
                      >
                        {courses.map((course) => (
                          <option key={course.id} value={course.id}>
                            {course.course_code}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <strong>{item.course_code_snapshot}</strong>
                    )}
                  </td>
                  <td>{displayedCourseName}</td>
                  <td>
                    {canEditDetails ? (
                      <select
                        aria-label={uiText("Phòng {0}", [
                          item.course_code_snapshot,
                        ])}
                        value={detailDraft.roomId}
                        onChange={(event) =>
                          updateDetail({ roomId: event.target.value })
                        }
                      >
                        {roomOptions
                          .filter(
                            (room) =>
                              !item.roomTypeId ||
                              room.roomTypeId === item.roomTypeId,
                          )
                          .map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.label}
                            </option>
                          ))}
                      </select>
                    ) : (
                      item.roomLabel
                    )}
                  </td>
                  <td className="class-registration-student-count-cell">
                    {canEditDetails ? (
                      <input
                        className="student-count-input"
                        aria-label={uiText("Số sinh viên {0}", [
                          item.course_code_snapshot,
                        ])}
                        type="number"
                        min="1"
                        step="1"
                        value={detailDraft.studentCount}
                        onChange={(event) =>
                          updateDetail({
                            studentCount: event.target.value,
                          })
                        }
                      />
                    ) : (
                      <strong>{item.student_count}</strong>
                    )}
                  </td>
                  {mode === "open" ? (
                    <td className="lecturer-name">
                      {canManageLecturers ? (
                        <LecturerAssignmentFields
                          disabled={pending}
                          item={item}
                          options={
                            lecturerOptionsByRoomType[item.roomTypeId] ?? []
                          }
                          value={assignmentDraft}
                          onChange={(ids) =>
                            setAssignmentDrafts((current) => ({
                              ...current,
                              [item.id]: ids,
                            }))
                          }
                        />
                      ) : item.lecturerNames.length ? (
                        <span className="lecturer-name-list">
                          {item.lecturerNames.map((name) => (
                            <strong key={name}>{name}</strong>
                          ))}
                        </span>
                      ) : (
                        <strong>{uiText("Chưa có giảng viên")}</strong>
                      )}
                    </td>
                  ) : null}
                  <td className="table-action">
                    <div className="row-actions">
                      {isLocked ? (
                        <span
                          className="badge-tag badge-tag-warning"
                          title={uiText(
                            "Lớp đã có Phiếu đăng ký thiết bị (khóa chỉnh sửa)",
                          )}
                        >
                          {uiText("Khóa thiết bị")}
                        </span>
                      ) : null}
                      {canEditDetails ? (
                        <button
                          className="button button-primary row-action-button"
                          disabled={
                            pending ||
                            (canManageLecturers && duplicateAssignment)
                          }
                          type="button"
                          onClick={() => saveRow(item)}
                        >
                          {uiText("Lưu")}
                        </button>
                      ) : null}
                      {canJoinRow ? (
                        <button
                          className="button button-primary row-action-button"
                          disabled={pending}
                          onClick={() => runAction(item, "claim")}
                        >
                          {uiText("Nhận lớp")}
                        </button>
                      ) : null}
                      {canWithdrawRow ? (
                        <button
                          className="button button-danger row-action-button"
                          disabled={pending}
                          onClick={() =>
                            setConfirmation({ item, action: "withdraw" })
                          }
                        >
                          {uiText("Hủy")}
                        </button>
                      ) : null}
                      {canDeleteRow ? (
                        <button
                          className="button button-outline-danger row-action-button"
                          disabled={pending}
                          onClick={() =>
                            setConfirmation({ item, action: "delete" })
                          }
                          aria-label={uiText("Xóa lớp {0}", [
                            item.course_code_snapshot,
                          ])}
                        >
                          <Trash2 size={16} />
                          {uiText(" Xóa")}
                        </button>
                      ) : null}
                      {pendingId === item.id ? (
                        <span className="sr-only">{uiText("Đang xử lý")}</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!filtered.length ? (
        <p className="panel-empty">
          {uiText("Không có lớp phù hợp với bộ lọc hiện tại.")}
        </p>
      ) : null}
      <PaginationControls
        currentPage={safePage}
        totalItems={filtered.length}
        onPageChange={setCurrentPage}
      />
      <ConfirmDialog
        open={Boolean(confirmation)}
        title={
          confirmation?.action === "delete"
            ? uiText("Xóa lịch học?")
            : uiText("Hủy nhận lớp?")
        }
        description={
          confirmation?.action === "delete"
            ? uiText(
                "Lớp {0} ngày {1} sẽ bị xóa. Thao tác này không thể hoàn tác.",
                [
                  confirmation.item.course_code_snapshot,
                  formatBusinessDate(confirmation.item.schedule_date),
                ],
              )
            : uiText("Lớp {0} sẽ trở lại trạng thái chưa có giảng viên.", [
                confirmation?.item.course_code_snapshot ?? uiText("đã chọn"),
              ])
        }
        confirmLabel={
          confirmation?.action === "delete"
            ? uiText("Xóa lịch học")
            : uiText("Hủy nhận lớp")
        }
        pending={pending}
        onConfirm={() => {
          if (!confirmation) return;
          const { item, action } = confirmation;
          setConfirmation(null);
          runAction(item, action);
        }}
        onCancel={() => setConfirmation(null)}
      />
    </section>
  );
}

function LecturerAssignmentFields({
  item,
  options,
  disabled,
  value,
  onChange,
}: {
  item: RegistrationClass;
  options: ComboboxOption[];
  disabled: boolean;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { text: uiText } = useLanguage();

  const firstId = value[0] ?? "";
  const secondId = value[1] ?? "";
  const currentLecturers = [item.lecturer_id, item.lecturer_2_id]
    .map((id, index) =>
      id
        ? {
            value: id,
            label: item.lecturerNames[index] ?? "Giảng viên",
          }
        : null,
    )
    .filter((option): option is ComboboxOption => Boolean(option));
  const availableOptions = [...options];
  for (const current of currentLecturers) {
    if (!availableOptions.some((option) => option.value === current.value)) {
      availableOptions.push(current);
    }
  }

  return (
    <div className="table-lecturer-editor">
      <SearchableCombobox
        ariaLabel={uiText("Giảng viên 1 của lớp {0}", [
          item.course_code_snapshot,
        ])}
        disabled={disabled}
        emptyLabel={uiText("Chưa chọn giảng viên")}
        onChange={(nextId) => onChange([nextId, secondId])}
        options={availableOptions.filter((option) => option.value !== secondId)}
        placeholder={uiText("Giảng viên 1…")}
        value={firstId}
      />
      <SearchableCombobox
        ariaLabel={uiText("Giảng viên 2 của lớp {0}", [
          item.course_code_snapshot,
        ])}
        disabled={disabled}
        emptyLabel={uiText("Không có giảng viên 2")}
        onChange={(nextId) => onChange([firstId, nextId])}
        options={availableOptions.filter((option) => option.value !== firstId)}
        placeholder={uiText("Giảng viên 2…")}
        value={secondId}
      />
    </div>
  );
}
