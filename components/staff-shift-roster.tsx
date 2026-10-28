"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  cancelStaffShiftAction,
  registerStaffShiftsAction,
  type ShiftRegistrationPayloadItem,
  updateStaffShiftTimeAction,
} from "@/app/dashboard/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  LockKeyhole,
  Plus,
  Trash2,
  X,
} from "@/components/icons";
import { TimePicker } from "@/components/time-picker";
import { businessTodayString, formatBusinessDate } from "@/lib/business-time";
import {
  AFTERNOON_SHIFT_ALLOWED_TIMES,
  MORNING_SHIFT_ALLOWED_TIMES,
} from "@/lib/time-picker-utils";
import { useScheduleRealtime } from "@/lib/use-schedule-realtime";
import { useLanguage } from "@/components/i18n/language-provider";

export type ShiftSlot = "MORNING" | "AFTERNOON";

export type Shift = {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_slot: ShiftSlot;
  start_time: string;
  end_time: string;
  note: string | null;
  status: string;
  staffName: string;
  registration_source?: string;
  creation_group_id?: string | null;
};

export type Assignee = {
  id: string;
  fullName: string;
};

export type ShiftView = "week" | "month";
export type ShiftTab = "roster" | "register";

type SlotOption = "MORNING" | "AFTERNOON" | "ALL_DAY";

type RegistrationTimes = {
  morningStartTime: string;
  morningEndTime: string;
  afternoonStartTime: string;
  afternoonEndTime: string;
};

export type WeekDayRegistrationRow = RegistrationTimes & {
  date: string;
  dayLabel: string;
  included: boolean;
  selectedAssigneeIds: string[];
  slotOption: SlotOption;
};

export type FreeformRegistrationRow = RegistrationTimes & {
  id: string;
  date: string;
  selectedAssigneeIds: string[];
  slotOption: SlotOption;
};

const weekdayFullNames = [
  "Chủ nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
];

const staffShiftPeriods = [
  ["MORNING", "S\u00e1ng"],
  ["AFTERNOON", "Chi\u1ec1u"],
] as const;

function getDayOfWeekLabel(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3) return "";
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return weekdayFullNames[d.getDay()] ?? "";
}

function generateWeekRows(
  anchor: string,
  defaultAssigneeIds: string[],
): WeekDayRegistrationRow[] {
  const parts = anchor.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const dayOfWeek = d.getDay();
  const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);

  const generated: WeekDayRegistrationRow[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(mon);
    cur.setDate(mon.getDate() + i);
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const dt = String(cur.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${dt}`;
    generated.push({
      date: dateStr,
      dayLabel: `${weekdayFullNames[cur.getDay()]}, ${dt}/${m}/${y}`,
      included: false,
      selectedAssigneeIds: [...defaultAssigneeIds],
      slotOption: "MORNING",
      morningStartTime: "07:30",
      morningEndTime: "11:30",
      afternoonStartTime: "12:30",
      afternoonEndTime: "16:30",
    });
  }
  return generated;
}

/** Per-row Assignee Multi-Select Dropdown for Admin */
function RowAssigneePicker({
  assignees,
  selectedIds,
  onChange,
  onApplyToAll,
}: {
  assignees: Assignee[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onApplyToAll?: () => void;
}) {
  const { text: uiText } = useLanguage();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return assignees;
    const q = search.toLowerCase();
    return assignees.filter((a) => a.fullName.toLowerCase().includes(q));
  }, [assignees, search]);

  const summaryText = useMemo(() => {
    if (selectedIds.length === 0) return "Chọn người trực";
    if (selectedIds.length === 1) {
      const p = assignees.find((a) => a.id === selectedIds[0]);
      return p?.fullName ?? "1 người trực";
    }
    return `${selectedIds.length} người trực`;
  }, [selectedIds, assignees]);

  return (
    <div
      className="staff-shift-assignee relative inline-block text-left"
      ref={popoverRef}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`input text-xs py-1 px-2.5 flex items-center justify-between gap-1.5 min-w-[150px] max-w-[200px] text-left ${
          selectedIds.length === 0
            ? "text-neutral-400 border-dashed"
            : "text-neutral-900 font-medium"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{summaryText}</span>
        <ChevronDown size={13} className="text-neutral-400 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-white rounded-lg border border-neutral-200 shadow-lg p-2.5 z-40 space-y-2">
          <input
            type="text"
            placeholder={uiText("Tìm nhân sự...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input text-xs px-2 py-1 w-full"
            autoFocus
          />

          <div className="flex items-center justify-between text-[11px] px-0.5">
            <button
              type="button"
              onClick={() => onChange(assignees.map((a) => a.id))}
              className="text-primary-700 hover:underline font-medium"
            >
              {uiText("Chọn tất cả")}
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-neutral-500 hover:underline"
            >
              {uiText("Bỏ chọn")}
            </button>
            {onApplyToAll && (
              <button
                type="button"
                onClick={() => {
                  onApplyToAll();
                  setOpen(false);
                }}
                className="text-sky-700 hover:underline font-medium"
                title={uiText(
                  "Áp dụng danh sách người trực này cho tất cả các dòng",
                )}
              >
                {uiText("Áp dụng cho tất cả")}
              </button>
            )}
          </div>

          <div className="max-h-40 overflow-y-auto space-y-1 divide-y divide-neutral-100">
            {filtered.map((person) => {
              const checked = selectedIds.includes(person.id);
              return (
                <label
                  key={person.id}
                  className="flex items-center gap-2 p-1.5 rounded hover:bg-neutral-50 cursor-pointer text-xs select-none"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onChange([...selectedIds, person.id]);
                      } else {
                        onChange(selectedIds.filter((id) => id !== person.id));
                      }
                    }}
                    className="w-3.5 h-3.5 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="truncate">{person.fullName}</span>
                </label>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-[11px] text-neutral-400 py-2 text-center">
                {uiText("Không tìm thấy nhân sự")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RegistrationTimeControls({
  row,
  onChange,
}: {
  row: RegistrationTimes & { slotOption: SlotOption };
  onChange: (field: keyof RegistrationTimes, value: string) => void;
}) {
  const { text: uiText } = useLanguage();

  const renderLine = (
    label: string | null,
    startField: keyof RegistrationTimes,
    endField: keyof RegistrationTimes,
    allowedValues: readonly string[],
  ) => (
    <div className={`staff-shift-time-line ${label ? "" : "is-single"}`}>
      {label ? <span>{uiText(label)}</span> : null}
      <TimePicker
        value={row[startField]}
        onChange={(value) => onChange(startField, value)}
        allowedValues={allowedValues}
        ariaLabel={uiText("Giờ bắt đầu ca {0}", [
          label?.toLowerCase() ?? uiText("trực"),
        ])}
        className="staff-shift-time-picker"
      />
      <span aria-hidden="true">–</span>
      <TimePicker
        value={row[endField]}
        onChange={(value) => onChange(endField, value)}
        allowedValues={allowedValues}
        ariaLabel={uiText("Giờ kết thúc ca {0}", [
          label?.toLowerCase() ?? uiText("trực"),
        ])}
        className="staff-shift-time-picker"
      />
    </div>
  );

  if (row.slotOption === "ALL_DAY") {
    return (
      <div className="staff-shift-time-stack">
        {renderLine(
          uiText("Sáng"),
          "morningStartTime",
          "morningEndTime",
          MORNING_SHIFT_ALLOWED_TIMES,
        )}
        {renderLine(
          uiText("Chiều"),
          "afternoonStartTime",
          "afternoonEndTime",
          AFTERNOON_SHIFT_ALLOWED_TIMES,
        )}
      </div>
    );
  }

  return row.slotOption === "MORNING"
    ? renderLine(
        null,
        "morningStartTime",
        "morningEndTime",
        MORNING_SHIFT_ALLOWED_TIMES,
      )
    : renderLine(
        null,
        "afternoonStartTime",
        "afternoonEndTime",
        AFTERNOON_SHIFT_ALLOWED_TIMES,
      );
}

export function StaffShiftRoster({
  shifts,
  assignees,
  userId,
  userFullName,
  days,
  anchorDate,
  previousDate,
  nextDate,
  periodLabel,
  view,
  tab,
  isAdmin,
  canSelfRegister,
  canManageShiftHistory,
}: {
  shifts: Shift[];
  assignees: Assignee[];
  userId: string;
  userFullName: string;
  days: string[];
  anchorDate: string;
  previousDate: string;
  nextDate: string;
  periodLabel: string;
  view: ShiftView;
  tab: ShiftTab;
  isAdmin: boolean;
  canSelfRegister: boolean;
  canManageShiftHistory: boolean;
}) {
  const { text: uiText } = useLanguage();

  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useScheduleRealtime();

  const todayStr = businessTodayString();

  // Toast / Action feedback state
  const [actionMessage, setActionMessage] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!actionMessage) return;
    const timer = setTimeout(() => setActionMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  // Tab 1: Modal dialogs
  // 1. Quick Register Modal
  const [quickRegisterModal, setQuickRegisterModal] = useState<{
    open: boolean;
    date: string;
    slot: ShiftSlot;
    selectedAssigneeIds: string[];
    startTime: string;
    endTime: string;
    note: string;
    historicalReason: string;
  } | null>(null);

  // 2. Edit Shift Time Modal (Admin or Shift Owner)
  const [editShiftModal, setEditShiftModal] = useState<{
    open: boolean;
    shift: Shift;
    startTime: string;
    endTime: string;
    note: string;
    historicalReason: string;
  } | null>(null);

  // 3. Cancel Shift Confirm Dialog
  const [cancelShiftDialog, setCancelShiftDialog] = useState<{
    open: boolean;
    shift: Shift;
    historicalReason: string;
  } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (quickRegisterModal) setQuickRegisterModal(null);
        if (editShiftModal) setEditShiftModal(null);
        if (cancelShiftDialog) setCancelShiftDialog(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [quickRegisterModal, editShiftModal, cancelShiftDialog]);

  // Tab 2: Registration State
  const [regMode, setRegMode] = useState<"week" | "freeform">("week");
  const [regHistoricalReason, setRegHistoricalReason] = useState("");

  const defaultAssigneeIds = useMemo(
    () => (isAdmin ? [] : [userId]),
    [isAdmin, userId],
  );

  // Tab 2: Week mode rows (7 days from anchorDate's week)
  const [weekAnchor, setWeekAnchor] = useState(anchorDate);
  const [weekRows, setWeekRows] = useState<WeekDayRegistrationRow[]>(() =>
    generateWeekRows(anchorDate, defaultAssigneeIds),
  );

  const updateWeekAnchor = (newAnchor: string) => {
    setWeekAnchor(newAnchor);
    setWeekRows(generateWeekRows(newAnchor, defaultAssigneeIds));
  };

  // Tab 2: Freeform mode rows
  const [freeformRows, setFreeformRows] = useState<FreeformRegistrationRow[]>([
    {
      id: "row-1",
      date: todayStr,
      selectedAssigneeIds: [...defaultAssigneeIds],
      slotOption: "MORNING",
      morningStartTime: "07:30",
      morningEndTime: "11:30",
      afternoonStartTime: "12:30",
      afternoonEndTime: "16:30",
    },
  ]);

  // Handle Quick Register Form Submit (Tab 1 calendar click)
  const handleQuickRegisterSubmit = () => {
    if (!quickRegisterModal) return;
    const {
      date,
      slot,
      selectedAssigneeIds,
      startTime,
      endTime,
      note,
      historicalReason,
    } = quickRegisterModal;

    const assigneesToRegister = isAdmin ? selectedAssigneeIds : [userId];
    if (assigneesToRegister.length === 0) {
      setActionMessage({
        ok: false,
        message: "Vui lòng chọn ít nhất một người trực.",
      });
      return;
    }

    if (date < todayStr && !canManageShiftHistory) {
      setActionMessage({
        ok: false,
        message: "Không thể đăng ký ca trực trong quá khứ.",
      });
      return;
    }

    if (date < todayStr && !historicalReason.trim()) {
      setActionMessage({
        ok: false,
        message: "Vui lòng nhập lý do điều chỉnh lịch sử.",
      });
      return;
    }

    const payload: ShiftRegistrationPayloadItem[] = assigneesToRegister.map(
      (staffId) => ({
        staff_id: staffId,
        shift_date: date,
        shift_slot: slot,
        start_time: startTime,
        end_time: endTime,
        note: note.trim() || null,
      }),
    );

    startTransition(async () => {
      const res = await registerStaffShiftsAction(
        payload,
        date < todayStr ? historicalReason : undefined,
      );
      setActionMessage(res);
      if (res.ok) {
        setQuickRegisterModal(null);
        router.refresh();
      }
    });
  };

  // Handle Edit Shift Submit (Staff own shift or Admin)
  const handleEditShiftSubmit = () => {
    if (!editShiftModal) return;
    const { shift, startTime, endTime, note, historicalReason } =
      editShiftModal;

    if (shift.shift_date < todayStr && !canManageShiftHistory) {
      setActionMessage({
        ok: false,
        message: "Không thể chỉnh sửa ca trực trong quá khứ.",
      });
      return;
    }

    if (shift.shift_date < todayStr && !historicalReason.trim()) {
      setActionMessage({
        ok: false,
        message: "Vui lòng nhập lý do điều chỉnh lịch sử.",
      });
      return;
    }

    startTransition(async () => {
      const res = await updateStaffShiftTimeAction(
        shift.id,
        startTime,
        endTime,
        note.trim() || null,
        shift.shift_date < todayStr ? historicalReason : undefined,
      );
      setActionMessage(res);
      if (res.ok) {
        setEditShiftModal(null);
        router.refresh();
      }
    });
  };

  // Handle Cancel Shift Submit
  const handleCancelShiftSubmit = () => {
    if (!cancelShiftDialog) return;
    const { shift, historicalReason } = cancelShiftDialog;

    if (shift.shift_date < todayStr && !canManageShiftHistory) {
      setActionMessage({
        ok: false,
        message: "Không thể hủy ca trực trong quá khứ.",
      });
      return;
    }

    if (shift.shift_date < todayStr && !historicalReason.trim()) {
      setActionMessage({
        ok: false,
        message: "Vui lòng nhập lý do điều chỉnh lịch sử.",
      });
      return;
    }

    startTransition(async () => {
      const res = await cancelStaffShiftAction(
        shift.id,
        shift.shift_date < todayStr ? historicalReason : undefined,
      );
      setActionMessage(res);
      if (res.ok) {
        setCancelShiftDialog(null);
        router.refresh();
      }
    });
  };

  // The registration tab only offers the two policy-constrained shift windows.
  // All-day preserves the existing atomic Morning + Afternoon payload behavior.
  const buildRowPayload = (
    date: string,
    slotOption: SlotOption,
    times: RegistrationTimes,
    assigneeIds: string[],
  ): ShiftRegistrationPayloadItem[] => {
    const assigneesToUse = isAdmin ? assigneeIds : [userId];
    const items: ShiftRegistrationPayloadItem[] = [];

    for (const staffId of assigneesToUse) {
      if (slotOption === "MORNING") {
        items.push({
          staff_id: staffId,
          shift_date: date,
          shift_slot: "MORNING",
          start_time: times.morningStartTime,
          end_time: times.morningEndTime,
          note: null,
        });
      } else if (slotOption === "AFTERNOON") {
        items.push({
          staff_id: staffId,
          shift_date: date,
          shift_slot: "AFTERNOON",
          start_time: times.afternoonStartTime,
          end_time: times.afternoonEndTime,
          note: null,
        });
      } else if (slotOption === "ALL_DAY") {
        items.push({
          staff_id: staffId,
          shift_date: date,
          shift_slot: "MORNING",
          start_time: times.morningStartTime,
          end_time: times.morningEndTime,
          note: null,
        });
        items.push({
          staff_id: staffId,
          shift_date: date,
          shift_slot: "AFTERNOON",
          start_time: times.afternoonStartTime,
          end_time: times.afternoonEndTime,
          note: null,
        });
      }
    }
    return items;
  };

  // Handle Per-Row Submission ("Đăng ký ca")
  const handleSingleRowSubmit = (
    row: RegistrationTimes & { date: string; slotOption: SlotOption },
    assigneeIds: string[],
    onSuccessCallback?: () => void,
  ) => {
    const assigneesToUse = isAdmin ? assigneeIds : [userId];
    if (assigneesToUse.length === 0) {
      setActionMessage({
        ok: false,
        message: "Vui lòng chọn ít nhất một người trực cho dòng này.",
      });
      return;
    }

    const isPast = row.date < todayStr;
    if (isPast && !canManageShiftHistory) {
      setActionMessage({
        ok: false,
        message: "Không thể đăng ký ca trực trong quá khứ.",
      });
      return;
    }

    if (isPast && !regHistoricalReason.trim()) {
      setActionMessage({
        ok: false,
        message: "Vui lòng nhập lý do điều chỉnh lịch sử ở cuối trang.",
      });
      return;
    }

    const payload = buildRowPayload(
      row.date,
      row.slotOption,
      row,
      assigneesToUse,
    );

    startTransition(async () => {
      const res = await registerStaffShiftsAction(
        payload,
        isPast ? regHistoricalReason : undefined,
      );
      setActionMessage(res);
      if (res.ok) {
        onSuccessCallback?.();
        router.refresh();
      }
    });
  };

  // Handle Batch Submission ("Đăng ký các dòng đã điền")
  const handleBatchRegisterSubmit = () => {
    const payload: ShiftRegistrationPayloadItem[] = [];
    let hasHistorical = false;

    if (regMode === "week") {
      const activeRows = weekRows.filter((r) => r.included);
      if (activeRows.length === 0) {
        setActionMessage({
          ok: false,
          message: "Vui lòng tích chọn ít nhất một ngày trực.",
        });
        return;
      }

      for (const row of activeRows) {
        const assigneesToUse = isAdmin ? row.selectedAssigneeIds : [userId];
        if (assigneesToUse.length === 0) {
          setActionMessage({
            ok: false,
            message: `Dòng ngày ${formatBusinessDate(row.date)} chưa có người trực được chọn.`,
          });
          return;
        }

        if (row.date < todayStr) hasHistorical = true;
        const rowItems = buildRowPayload(
          row.date,
          row.slotOption,
          row,
          assigneesToUse,
        );
        payload.push(...rowItems);
      }
    } else {
      // freeform mode
      if (freeformRows.length === 0) {
        setActionMessage({
          ok: false,
          message: "Vui lòng thêm ít nhất một ngày trực.",
        });
        return;
      }

      for (const row of freeformRows) {
        const assigneesToUse = isAdmin ? row.selectedAssigneeIds : [userId];
        if (assigneesToUse.length === 0) {
          setActionMessage({
            ok: false,
            message: `Dòng ngày ${formatBusinessDate(row.date)} chưa có người trực được chọn.`,
          });
          return;
        }

        if (row.date < todayStr) hasHistorical = true;
        const rowItems = buildRowPayload(
          row.date,
          row.slotOption,
          row,
          assigneesToUse,
        );
        payload.push(...rowItems);
      }
    }

    if (payload.length === 0) {
      setActionMessage({
        ok: false,
        message: "Không có ca trực nào được tạo từ các dòng đã chọn.",
      });
      return;
    }

    if (hasHistorical && !canManageShiftHistory) {
      setActionMessage({
        ok: false,
        message: "Có ngày trực trong quá khứ mà bạn chưa có quyền quản lý.",
      });
      return;
    }

    if (hasHistorical && !regHistoricalReason.trim()) {
      setActionMessage({
        ok: false,
        message: "Vui lòng nhập lý do điều chỉnh lịch sử.",
      });
      return;
    }

    startTransition(async () => {
      const res = await registerStaffShiftsAction(
        payload,
        hasHistorical ? regHistoricalReason : undefined,
      );
      setActionMessage(res);
      if (res.ok) {
        setRegHistoricalReason("");
        if (regMode === "week") {
          setWeekRows((prev) => prev.map((r) => ({ ...r, included: false })));
        } else {
          setFreeformRows([
            {
              id: `row-${Date.now()}`,
              date: todayStr,
              selectedAssigneeIds: [...defaultAssigneeIds],
              slotOption: "MORNING",
              morningStartTime: "07:30",
              morningEndTime: "11:30",
              afternoonStartTime: "12:30",
              afternoonEndTime: "16:30",
            },
          ]);
        }
        router.push(`/staff-shifts?tab=roster&view=${view}&date=${anchorDate}`);
      }
    });
  };

  // Group shifts by date and slot
  const shiftsByDateSlot = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const s of shifts) {
      const key = `${s.shift_date}:${s.shift_slot}`;
      const existing = map.get(key) ?? [];
      existing.push(s);
      map.set(key, existing);
    }
    return map;
  }, [shifts]);

  const monthWeeks = useMemo(
    () =>
      Array.from({ length: Math.ceil(days.length / 7) }, (_, index) =>
        days.slice(index * 7, index * 7 + 7),
      ),
    [days],
  );

  const renderShiftSlot = (date: string, slot: ShiftSlot) => {
    const activeShifts = shiftsByDateSlot.get(`${date}:${slot}`) ?? [];
    const isPast = date < todayStr;
    const isUserInSlot = activeShifts.some(
      (shift) => shift.staff_id === userId,
    );
    const canAdd =
      (!isPast || canManageShiftHistory) &&
      (isAdmin || (canSelfRegister && !isUserInSlot));

    return (
      <div className="slot-events staff-shift-slot-content">
        {activeShifts.map((shift) => {
          const isMe = shift.staff_id === userId;
          return (
            <article className="slot-event slot-event-shift" key={shift.id}>
              <div>
                <time>
                  {shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}
                </time>
                <strong>{shift.staffName || uiText("Nhân sự")}</strong>
                <small>
                  {slot === "MORNING" ? uiText("Ca sáng") : uiText("Ca chiều")}
                </small>
              </div>
              {(isAdmin || isMe) && (
                <div className="staff-shift-event-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setEditShiftModal({
                        open: true,
                        shift,
                        startTime: shift.start_time.slice(0, 5),
                        endTime: shift.end_time.slice(0, 5),
                        note: shift.note ?? "",
                        historicalReason: "",
                      })
                    }
                    aria-label={uiText("Chỉnh sửa giờ trực của {0}", [
                      shift.staffName || uiText("Nhân sự"),
                    ])}
                  >
                    <Clock3 size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCancelShiftDialog({
                        open: true,
                        shift,
                        historicalReason: "",
                      })
                    }
                    aria-label={uiText("Hủy lịch trực của {0}", [
                      shift.staffName || uiText("Nhân sự"),
                    ])}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {canAdd && (
          <button
            className="empty-shift-action staff-shift-empty-action"
            type="button"
            onClick={() =>
              setQuickRegisterModal({
                open: true,
                date,
                slot,
                selectedAssigneeIds: isAdmin ? [] : [userId],
                startTime: slot === "MORNING" ? "07:30" : "12:30",
                endTime: slot === "MORNING" ? "11:30" : "16:30",
                note: "",
                historicalReason: "",
              })
            }
          >
            <Plus size={13} /> {isAdmin ? uiText("Thêm") : uiText("Đăng ký")}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* Tab Navigation */}
      <div className="staff-shift-tabs flex border-b border-neutral-200">
        <Link
          href={`/staff-shifts?tab=roster&view=${view}&date=${anchorDate}`}
          aria-current={tab === "roster" ? "page" : undefined}
          className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
            tab === "roster"
              ? "border-primary-600 text-primary-700 bg-primary-50/40"
              : "border-transparent text-neutral-600 hover:text-neutral-900 hover:border-neutral-300"
          }`}
        >
          {uiText("Lịch trực")}
        </Link>
        <Link
          href={`/staff-shifts?tab=register&view=${view}&date=${anchorDate}`}
          aria-current={tab === "register" ? "page" : undefined}
          className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
            tab === "register"
              ? "border-primary-600 text-primary-700 bg-primary-50/40"
              : "border-transparent text-neutral-600 hover:text-neutral-900 hover:border-neutral-300"
          }`}
        >
          {uiText("Đăng ký lịch trực")}
        </Link>
      </div>

      {/* Toast Notification */}
      {actionMessage && (
        <div
          className={`p-4 rounded-lg flex items-center justify-between text-sm ${
            actionMessage.ok
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-rose-50 text-rose-800 border border-rose-200"
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            {actionMessage.ok ? (
              <Check className="text-emerald-600 flex-shrink-0" size={18} />
            ) : (
              <CircleAlert className="text-rose-600 flex-shrink-0" size={18} />
            )}
            <span>{uiText(actionMessage.message)}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="text-neutral-400 hover:text-neutral-700 p-1"
            aria-label={uiText("Đóng thông báo")}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* TAB 1: LỊCH TRỰC */}
      {tab === "roster" && (
        <div className="space-y-4">
          <div className="calendar-card">
            <div className="calendar-toolbar">
              <div className="calendar-title">
                <div className="date-nav">
                  <Link
                    href={`/staff-shifts?tab=roster&view=${view}&date=${previousDate}`}
                    aria-label={uiText("Kỳ trước")}
                  >
                    <ChevronLeft size={17} />
                  </Link>
                  <Link
                    href={`/staff-shifts?tab=roster&view=${view}&date=${todayStr}`}
                    className="today-button"
                  >
                    {view === "month"
                      ? uiText("Tháng này")
                      : uiText("Tuần này")}
                  </Link>
                  <Link
                    href={`/staff-shifts?tab=roster&view=${view}&date=${nextDate}`}
                    aria-label={uiText("Kỳ sau")}
                  >
                    <ChevronRight size={17} />
                  </Link>
                </div>
                <div>
                  <h3>{uiText(periodLabel)}</h3>
                </div>
              </div>

              <div className="calendar-options">
                <div className="segmented-control">
                  <Link
                    href={`/staff-shifts?tab=roster&view=week&date=${anchorDate}`}
                    className={view === "week" ? "selected" : ""}
                    aria-current={view === "week" ? "page" : undefined}
                  >
                    {uiText("Tuần")}
                  </Link>
                  <Link
                    href={`/staff-shifts?tab=roster&view=month&date=${anchorDate}`}
                    className={view === "month" ? "selected" : ""}
                    aria-current={view === "month" ? "page" : undefined}
                  >
                    {uiText("Tháng")}
                  </Link>
                </div>
              </div>
            </div>
            {/* Calendar Grid */}
            {view === "month" ? (
              <div
                aria-label={uiText(
                  "Lịch trực theo tháng; vuốt ngang để xem thêm ngày",
                )}
                className="period-calendar period-calendar-month staff-shift-month-calendar"
                role="region"
                tabIndex={0}
              >
                {monthWeeks.map((week, weekIndex) => (
                  <section className="period-week" key={week[0] ?? weekIndex}>
                    <div
                      className="period-grid"
                      style={
                        {
                          "--calendar-day-count": week.length,
                        } as React.CSSProperties
                      }
                    >
                      <div className="period-corner">{uiText("BUỔI")}</div>
                      {week.map((date) => {
                        const isToday = date === todayStr;
                        const isSunday =
                          getDayOfWeekLabel(date) === weekdayFullNames[0];
                        const isOutsideMonth =
                          date.slice(0, 7) !== anchorDate.slice(0, 7);
                        return (
                          <header
                            className={`period-day-heading ${isToday ? "is-today" : ""} ${isSunday ? "is-sunday" : ""} ${isOutsideMonth ? "is-outside-month" : ""}`}
                            key={date}
                          >
                            <span>{uiText(getDayOfWeekLabel(date))}</span>
                            <strong>{date.slice(-2)}</strong>
                          </header>
                        );
                      })}
                      {staffShiftPeriods.map(([slot, label]) => (
                        <Fragment key={slot}>
                          <div className="period-label period-label-shift staff-shift-period-label">
                            <span>{uiText("Lịch trực")}</span>
                            <strong>{uiText(label)}</strong>
                          </div>
                          {week.map((date) => (
                            <div
                              className={`period-cell period-cell-shift ${date === todayStr ? "is-today" : ""} ${getDayOfWeekLabel(date) === weekdayFullNames[0] ? "is-sunday" : ""} ${date.slice(0, 7) !== anchorDate.slice(0, 7) ? "is-outside-month" : ""}`}
                              key={`${slot}-${date}`}
                            >
                              {renderShiftSlot(date, slot)}
                            </div>
                          ))}
                        </Fragment>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div
                aria-label={uiText(
                  "Lịch trực theo tuần; vuốt ngang để xem thêm ngày",
                )}
                className="period-calendar period-calendar-week staff-shift-period-calendar"
                role="region"
                tabIndex={0}
              >
                <section className="period-week">
                  <div
                    className="period-grid"
                    style={
                      {
                        "--calendar-day-count": days.length,
                      } as React.CSSProperties
                    }
                  >
                    <div className="period-corner">{uiText("BUỔI")}</div>
                    {days.map((date) => {
                      const isToday = date === todayStr;
                      const isSunday =
                        getDayOfWeekLabel(date) === weekdayFullNames[0];
                      return (
                        <header
                          className={`period-day-heading ${isToday ? "is-today" : ""} ${isSunday ? "is-sunday" : ""}`}
                          key={date}
                        >
                          <span>{uiText(getDayOfWeekLabel(date))}</span>
                          <strong>{date.slice(-2)}</strong>
                        </header>
                      );
                    })}
                    {staffShiftPeriods.map(([slot, label]) => (
                      <Fragment key={slot}>
                        <div className="period-label period-label-shift staff-shift-period-label">
                          <span>{uiText("Lịch trực")}</span>
                          <strong>{uiText(label)}</strong>
                        </div>
                        {days.map((date) => {
                          const isToday = date === todayStr;
                          const isSunday =
                            getDayOfWeekLabel(date) === weekdayFullNames[0];
                          return (
                            <div
                              className={`period-cell period-cell-shift ${isToday ? "is-today" : ""} ${isSunday ? "is-sunday" : ""}`}
                              key={`${slot}-${date}`}
                            >
                              {renderShiftSlot(date, slot)}
                            </div>
                          );
                        })}
                      </Fragment>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ĐĂNG KÝ LỊCH TRỰC */}
      {tab === "register" && (
        <div className="staff-shift-registration max-w-6xl mx-auto space-y-6">
          <div className="staff-shift-registration-card bg-white p-6 rounded-xl border border-neutral-200 shadow-xs space-y-6">
            <div>
              <h2 className="text-base font-bold text-neutral-900">
                {uiText("Đăng ký ca trực mới")}
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                {uiText(
                  'Điền thông tin trực theo dòng. Có thể nhấn "Đăng ký ca" tại từng dòng hoặc "Đăng ký các dòng đã điền" để lưu toàn bộ.',
                )}
              </p>
            </div>

            {/* Mode Segment Control */}
            <div className="flex items-center gap-2 bg-neutral-100 p-1 rounded-lg w-fit">
              <button
                type="button"
                onClick={() => setRegMode("week")}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  regMode === "week"
                    ? "bg-white text-neutral-900 shadow-xs"
                    : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                {uiText("Theo tuần (Thứ 2 – Chủ nhật)")}
              </button>
              <button
                type="button"
                onClick={() => setRegMode("freeform")}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  regMode === "freeform"
                    ? "bg-white text-neutral-900 shadow-xs"
                    : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                {uiText("Tự chọn ngày trực")}
              </button>
            </div>

            {/* Mode 1: Theo tuần */}
            {regMode === "week" && (
              <div className="border-t border-neutral-200 pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-700">
                    {uiText("Chọn các ngày trong tuần:")}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const parts = weekAnchor.split("-").map(Number);
                        const d = new Date(parts[0], parts[1] - 1, parts[2]);
                        d.setDate(d.getDate() - 7);
                        updateWeekAnchor(
                          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                        );
                      }}
                      className="button button-secondary text-xs px-2 py-1 flex items-center gap-1"
                    >
                      <ChevronLeft size={14} />
                      {uiText(" Tuần trước")}
                    </button>
                    <button
                      type="button"
                      onClick={() => updateWeekAnchor(todayStr)}
                      className="button button-secondary text-xs px-2 py-1"
                    >
                      {uiText("Tuần này")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const parts = weekAnchor.split("-").map(Number);
                        const d = new Date(parts[0], parts[1] - 1, parts[2]);
                        d.setDate(d.getDate() + 7);
                        updateWeekAnchor(
                          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                        );
                      }}
                      className="button button-secondary text-xs px-2 py-1 flex items-center gap-1"
                    >
                      {uiText("Tuần sau ")}
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>

                <div className="staff-shift-registration-list space-y-3">
                  {weekRows.map((row, idx) => {
                    const isPast = row.date < todayStr;
                    return (
                      <div
                        key={row.date}
                        className={`staff-shift-registration-row p-3.5 rounded-lg border transition-all ${
                          row.included
                            ? "bg-white border-primary-400 shadow-xs ring-1 ring-primary-400"
                            : "bg-neutral-50/60 border-neutral-200 opacity-80"
                        }`}
                      >
                        <div className="staff-shift-registration-row-grid">
                          {/* Column 1: Ngày checkbox & label */}
                          <label className="staff-shift-registration-date flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={row.included}
                              onChange={(e) => {
                                const next = [...weekRows];
                                next[idx].included = e.target.checked;
                                setWeekRows(next);
                              }}
                              className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                            />
                            <span
                              className={`text-xs font-bold ${
                                row.included
                                  ? "text-neutral-900"
                                  : "text-neutral-600"
                              }`}
                            >
                              {uiText(row.dayLabel)}
                            </span>
                            {isPast && (
                              <span className="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                                <LockKeyhole size={10} />
                                {uiText(" Quá khứ")}
                              </span>
                            )}
                          </label>

                          {row.included && (
                            <div className="staff-shift-registration-fields">
                              {/* Column 2: Người trực */}
                              {isAdmin ? (
                                <RowAssigneePicker
                                  assignees={assignees}
                                  selectedIds={row.selectedAssigneeIds}
                                  onChange={(ids) => {
                                    const next = [...weekRows];
                                    next[idx].selectedAssigneeIds = ids;
                                    setWeekRows(next);
                                  }}
                                  onApplyToAll={() => {
                                    const ids = row.selectedAssigneeIds;
                                    setWeekRows((prev) =>
                                      prev.map((r) => ({
                                        ...r,
                                        selectedAssigneeIds: [...ids],
                                      })),
                                    );
                                  }}
                                />
                              ) : (
                                <div className="staff-shift-assignee text-xs bg-neutral-100 text-neutral-800 px-2.5 py-1 rounded font-medium flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  <span>{userFullName}</span>
                                </div>
                              )}

                              {/* Column 3: Buổi trực */}
                              <select
                                value={row.slotOption}
                                onChange={(e) => {
                                  const next = [...weekRows];
                                  const val = e.target.value as SlotOption;
                                  next[idx].slotOption = val;
                                  setWeekRows(next);
                                }}
                                className="input text-xs py-1 px-2 font-medium"
                              >
                                <option value="MORNING">
                                  {uiText("Sáng (07:30 – 11:30)")}
                                </option>
                                <option value="AFTERNOON">
                                  {uiText("Chiều (12:30 – 16:30)")}
                                </option>
                                <option value="ALL_DAY">
                                  {uiText("Cả ngày (Sáng + Chiều)")}
                                </option>
                              </select>

                              <RegistrationTimeControls
                                row={row}
                                onChange={(field, value) => {
                                  const next = [...weekRows];
                                  next[idx][field] = value;
                                  setWeekRows(next);
                                }}
                              />

                              {/* Column 6: Thao tác đăng ký từng dòng */}
                              <button
                                type="button"
                                onClick={() =>
                                  handleSingleRowSubmit(
                                    row,
                                    row.selectedAssigneeIds,
                                    () => {
                                      const next = [...weekRows];
                                      next[idx].included = false;
                                      setWeekRows(next);
                                    },
                                  )
                                }
                                disabled={pending}
                                className="button button-secondary text-xs px-2.5 py-1 flex items-center gap-1 font-semibold text-primary-700 hover:bg-primary-50"
                              >
                                <Plus size={13} />
                                {uiText(" Đăng ký ca")}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Mode 2: Tự chọn */}
            {regMode === "freeform" && (
              <div className="border-t border-neutral-200 pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-700">
                    {uiText("Danh sách ngày trực:")}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFreeformRows((prev) => [
                        ...prev,
                        {
                          id: `row-${Date.now()}`,
                          date: todayStr,
                          selectedAssigneeIds: [...defaultAssigneeIds],
                          slotOption: "MORNING",
                          morningStartTime: "07:30",
                          morningEndTime: "11:30",
                          afternoonStartTime: "12:30",
                          afternoonEndTime: "16:30",
                        },
                      ])
                    }
                    className="button button-secondary text-xs px-2.5 py-1.5 flex items-center gap-1"
                  >
                    <Plus size={14} />
                    {uiText(" Thêm ngày trực")}
                  </button>
                </div>

                <div className="staff-shift-registration-list space-y-3">
                  {freeformRows.map((row, idx) => {
                    const isPast = row.date < todayStr;
                    return (
                      <div
                        key={row.id}
                        className="staff-shift-registration-row p-3.5 bg-white rounded-lg border border-neutral-200 shadow-2xs space-y-2.5"
                      >
                        <div className="staff-shift-registration-row-grid">
                          {/* Column 1: Ngày trực */}
                          <div className="staff-shift-registration-date flex items-center gap-2">
                            <input
                              type="date"
                              value={row.date}
                              onChange={(e) => {
                                const next = [...freeformRows];
                                next[idx].date = e.target.value;
                                setFreeformRows(next);
                              }}
                              className="input text-xs py-1 px-2.5"
                            />
                            {isPast && (
                              <span className="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                                <LockKeyhole size={10} />
                                {uiText(" Quá khứ")}
                              </span>
                            )}
                          </div>

                          <div className="staff-shift-registration-fields">
                            {/* Column 2: Người trực */}
                            {isAdmin ? (
                              <RowAssigneePicker
                                assignees={assignees}
                                selectedIds={row.selectedAssigneeIds}
                                onChange={(ids) => {
                                  const next = [...freeformRows];
                                  next[idx].selectedAssigneeIds = ids;
                                  setFreeformRows(next);
                                }}
                                onApplyToAll={() => {
                                  const ids = row.selectedAssigneeIds;
                                  setFreeformRows((prev) =>
                                    prev.map((r) => ({
                                      ...r,
                                      selectedAssigneeIds: [...ids],
                                    })),
                                  );
                                }}
                              />
                            ) : (
                              <div className="staff-shift-assignee text-xs bg-neutral-100 text-neutral-800 px-2.5 py-1 rounded font-medium flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <span>{userFullName}</span>
                              </div>
                            )}

                            {/* Column 3: Buổi trực */}
                            <select
                              value={row.slotOption}
                              onChange={(e) => {
                                const next = [...freeformRows];
                                const val = e.target.value as SlotOption;
                                next[idx].slotOption = val;
                                setFreeformRows(next);
                              }}
                              className="input text-xs py-1 px-2 font-medium"
                            >
                              <option value="MORNING">
                                {uiText("Sáng (07:30 – 11:30)")}
                              </option>
                              <option value="AFTERNOON">
                                {uiText("Chiều (12:30 – 16:30)")}
                              </option>
                              <option value="ALL_DAY">
                                {uiText("Cả ngày (Sáng + Chiều)")}
                              </option>
                            </select>

                            <RegistrationTimeControls
                              row={row}
                              onChange={(field, value) => {
                                const next = [...freeformRows];
                                next[idx][field] = value;
                                setFreeformRows(next);
                              }}
                            />

                            {/* Column 5: Đăng ký từng dòng */}
                            <button
                              type="button"
                              onClick={() =>
                                handleSingleRowSubmit(
                                  row,
                                  row.selectedAssigneeIds,
                                  () => {
                                    if (freeformRows.length > 1) {
                                      setFreeformRows((prev) =>
                                        prev.filter((r) => r.id !== row.id),
                                      );
                                    }
                                  },
                                )
                              }
                              disabled={pending}
                              className="button button-secondary text-xs px-2.5 py-1 flex items-center gap-1 font-semibold text-primary-700 hover:bg-primary-50"
                            >
                              <Plus size={13} />
                              {uiText(" Đăng ký ca")}
                            </button>

                            {/* Column 6: Xóa dòng tự chọn */}
                            {freeformRows.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setFreeformRows((prev) =>
                                    prev.filter((r) => r.id !== row.id),
                                  )
                                }
                                className="button button-danger staff-shift-delete-button text-xs px-2.5 py-1 flex items-center gap-1"
                                aria-label={uiText("Xóa dòng ngày trực này")}
                              >
                                <Trash2 size={14} />
                                {uiText(" Xóa")}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Historical Reason Field (if any active date is past) */}
            {((regMode === "week" &&
              weekRows.some((r) => r.included && r.date < todayStr)) ||
              (regMode === "freeform" &&
                freeformRows.some((r) => r.date < todayStr))) && (
              <div className="staff-shift-historical-reason border-t border-amber-200 bg-amber-50/60 p-4 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-amber-800 text-xs font-semibold">
                  <LockKeyhole size={14} />
                  <span>
                    {uiText(
                      "Yêu cầu lý do điều chỉnh lịch sử (vì có ngày trực trong quá khứ)",
                    )}
                  </span>
                </div>
                {canManageShiftHistory ? (
                  <textarea
                    rows={2}
                    placeholder={uiText(
                      "Nhập lý do điều chỉnh lịch sử (bắt buộc)...",
                    )}
                    value={regHistoricalReason}
                    onChange={(e) => setRegHistoricalReason(e.target.value)}
                    className="input text-xs w-full"
                    required
                  />
                ) : (
                  <p className="text-xs text-rose-700 font-medium">
                    {uiText(
                      "Tài khoản của bạn chưa có quyền quản lý lịch sử ca trực. Vui lòng bỏ chọn các ngày trong quá khứ hoặc liên hệ quản trị viên.",
                    )}
                  </p>
                )}
              </div>
            )}

            {/* Batch Submit Button ("Đăng ký các dòng đã điền") */}
            <div className="border-t border-neutral-200 pt-4 flex items-center justify-between gap-3">
              <div className="text-xs text-neutral-500">
                {regMode === "week" ? (
                  <span>
                    {uiText("Đã chọn")}{" "}
                    <strong>{weekRows.filter((r) => r.included).length}</strong>{" "}
                    {uiText("ngày trong tuần")}
                  </span>
                ) : (
                  <span>
                    {uiText("Đang có ")}
                    <strong>{freeformRows.length}</strong>
                    {uiText(" dòng ngày trực")}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleBatchRegisterSubmit}
                disabled={pending}
                className="button button-primary text-xs px-6 py-2.5 font-semibold"
              >
                {pending
                  ? uiText("Đang xử lý...")
                  : uiText("Đăng ký các dòng đã điền")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG 1: Quick Register Modal (Accessible canonical dialog) */}
      {quickRegisterModal?.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/40 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label={uiText("Tạo lịch trực")}
          aria-labelledby="quick-register-modal-title"
        >
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-xl border border-neutral-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <div>
                <h3
                  id="quick-register-modal-title"
                  className="text-sm font-bold text-neutral-900"
                >
                  {uiText("Tạo lịch trực")}
                </h3>
                <p className="text-xs text-neutral-500">
                  {uiText(getDayOfWeekLabel(quickRegisterModal.date))},{" "}
                  {formatBusinessDate(quickRegisterModal.date)}
                  {uiText(" – Buổi")}{" "}
                  {quickRegisterModal.slot === "MORNING"
                    ? uiText("Sáng")
                    : uiText("Chiều")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuickRegisterModal(null)}
                className="text-neutral-400 hover:text-neutral-700 p-1"
                aria-label={uiText("Đóng cửa sổ")}
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3.5">
              {/* Assignee selection for admin */}
              {isAdmin ? (
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-neutral-700">
                    {uiText("Người trực:")}
                  </label>
                  <div className="max-h-36 overflow-y-auto border border-neutral-200 rounded-lg p-2 space-y-1 bg-neutral-50/50">
                    {assignees.map((person) => {
                      const checked =
                        quickRegisterModal.selectedAssigneeIds.includes(
                          person.id,
                        );
                      return (
                        <label
                          key={person.id}
                          className="flex items-center gap-2 p-1.5 rounded hover:bg-neutral-100 cursor-pointer text-xs select-none"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setQuickRegisterModal((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        selectedAssigneeIds: [
                                          ...prev.selectedAssigneeIds,
                                          person.id,
                                        ],
                                      }
                                    : null,
                                );
                              } else {
                                setQuickRegisterModal((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        selectedAssigneeIds:
                                          prev.selectedAssigneeIds.filter(
                                            (id) => id !== person.id,
                                          ),
                                      }
                                    : null,
                                );
                              }
                            }}
                            className="rounded border-neutral-300 text-primary-600"
                          />
                          <span>{person.fullName}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-neutral-600 bg-neutral-50 p-2.5 rounded-lg border border-neutral-200">
                  {uiText("Người trực: ")}
                  <strong>{userFullName}</strong>
                </div>
              )}

              {/* Time Pickers */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-neutral-700">
                  {uiText("Khung giờ trực:")}
                </label>
                <div className="flex items-center gap-2">
                  <TimePicker
                    value={quickRegisterModal.startTime}
                    onChange={(val) =>
                      setQuickRegisterModal((prev) =>
                        prev ? { ...prev, startTime: val } : null,
                      )
                    }
                    allowedValues={
                      quickRegisterModal.slot === "MORNING"
                        ? MORNING_SHIFT_ALLOWED_TIMES
                        : AFTERNOON_SHIFT_ALLOWED_TIMES
                    }
                  />
                  <span className="text-xs text-neutral-400">–</span>
                  <TimePicker
                    value={quickRegisterModal.endTime}
                    onChange={(val) =>
                      setQuickRegisterModal((prev) =>
                        prev ? { ...prev, endTime: val } : null,
                      )
                    }
                    allowedValues={
                      quickRegisterModal.slot === "MORNING"
                        ? MORNING_SHIFT_ALLOWED_TIMES
                        : AFTERNOON_SHIFT_ALLOWED_TIMES
                    }
                  />
                </div>
              </div>

              {/* Note */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-neutral-700">
                  {uiText("Ghi chú (tùy chọn):")}
                </label>
                <input
                  type="text"
                  placeholder={uiText("Nhập ghi chú...")}
                  value={quickRegisterModal.note}
                  onChange={(e) =>
                    setQuickRegisterModal((prev) =>
                      prev ? { ...prev, note: e.target.value } : null,
                    )
                  }
                  className="input text-xs w-full"
                />
              </div>

              {/* Historical Reason */}
              {quickRegisterModal.date < todayStr && (
                <div className="space-y-1.5 bg-amber-50 p-3 rounded-lg border border-amber-200">
                  <label className="block text-xs font-bold text-amber-800">
                    {uiText("Lý do điều chỉnh lịch sử (bắt buộc):")}
                  </label>
                  <textarea
                    rows={2}
                    placeholder={uiText("Nhập lý do...")}
                    value={quickRegisterModal.historicalReason}
                    onChange={(e) =>
                      setQuickRegisterModal((prev) =>
                        prev
                          ? { ...prev, historicalReason: e.target.value }
                          : null,
                      )
                    }
                    className="input text-xs w-full"
                    required
                  />
                </div>
              )}
            </div>

            <div className="border-t border-neutral-200 pt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setQuickRegisterModal(null)}
                className="button button-secondary text-xs px-3 py-1.5"
              >
                {uiText("Hủy")}
              </button>
              <button
                type="button"
                onClick={handleQuickRegisterSubmit}
                disabled={pending}
                className="button button-primary text-xs px-4 py-1.5"
              >
                {pending ? uiText("Đang lưu...") : uiText("Xác nhận")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG 2: Edit Shift Time Modal (Accessible canonical dialog for Admin or Self) */}
      {editShiftModal?.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/40 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-shift-modal-title"
        >
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-xl border border-neutral-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <div>
                <h3
                  id="edit-shift-modal-title"
                  className="text-sm font-bold text-neutral-900"
                >
                  {uiText("Chỉnh sửa giờ ca trực")}
                </h3>
                <p className="text-xs text-neutral-500">
                  {editShiftModal.shift.staffName || uiText("Nhân sự")} –{" "}
                  {formatBusinessDate(editShiftModal.shift.shift_date)}
                  {uiText(" (Buổi")}{" "}
                  {editShiftModal.shift.shift_slot === "MORNING"
                    ? uiText("Sáng")
                    : uiText("Chiều")}
                  )
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditShiftModal(null)}
                className="text-neutral-400 hover:text-neutral-700 p-1"
                aria-label={uiText("Đóng cửa sổ")}
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3.5">
              {/* Time Pickers */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-neutral-700">
                  {uiText("Giờ trực (trong khung giờ buổi")}{" "}
                  {editShiftModal.shift.shift_slot === "MORNING"
                    ? "07:30–11:30"
                    : "12:30–16:30"}
                  ):
                </label>
                <div className="flex items-center gap-2">
                  <TimePicker
                    value={editShiftModal.startTime}
                    onChange={(val) =>
                      setEditShiftModal((prev) =>
                        prev ? { ...prev, startTime: val } : null,
                      )
                    }
                    allowedValues={
                      editShiftModal.shift.shift_slot === "MORNING"
                        ? MORNING_SHIFT_ALLOWED_TIMES
                        : AFTERNOON_SHIFT_ALLOWED_TIMES
                    }
                  />
                  <span className="text-xs text-neutral-400">–</span>
                  <TimePicker
                    value={editShiftModal.endTime}
                    onChange={(val) =>
                      setEditShiftModal((prev) =>
                        prev ? { ...prev, endTime: val } : null,
                      )
                    }
                    allowedValues={
                      editShiftModal.shift.shift_slot === "MORNING"
                        ? MORNING_SHIFT_ALLOWED_TIMES
                        : AFTERNOON_SHIFT_ALLOWED_TIMES
                    }
                  />
                </div>
              </div>

              {/* Note */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-neutral-700">
                  {uiText("Ghi chú:")}
                </label>
                <input
                  type="text"
                  placeholder={uiText("Ghi chú...")}
                  value={editShiftModal.note}
                  onChange={(e) =>
                    setEditShiftModal((prev) =>
                      prev ? { ...prev, note: e.target.value } : null,
                    )
                  }
                  className="input text-xs w-full"
                />
              </div>

              {/* Historical Reason */}
              {editShiftModal.shift.shift_date < todayStr && (
                <div className="space-y-1.5 bg-amber-50 p-3 rounded-lg border border-amber-200">
                  <label className="block text-xs font-bold text-amber-800">
                    {uiText("Lý do điều chỉnh lịch sử (bắt buộc):")}
                  </label>
                  <textarea
                    rows={2}
                    placeholder={uiText("Nhập lý do...")}
                    value={editShiftModal.historicalReason}
                    onChange={(e) =>
                      setEditShiftModal((prev) =>
                        prev
                          ? { ...prev, historicalReason: e.target.value }
                          : null,
                      )
                    }
                    className="input text-xs w-full"
                    required
                  />
                </div>
              )}
            </div>

            <div className="border-t border-neutral-200 pt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditShiftModal(null)}
                className="button button-secondary text-xs px-3 py-1.5"
              >
                {uiText("Hủy")}
              </button>
              <button
                type="button"
                onClick={handleEditShiftSubmit}
                disabled={pending}
                className="button button-primary text-xs px-4 py-1.5"
              >
                {pending ? uiText("Đang lưu...") : uiText("Lưu thay đổi")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG 3: Cancel Shift Confirm Dialog */}
      {cancelShiftDialog?.open && (
        <ConfirmDialog
          open={cancelShiftDialog.open}
          title={uiText("Hủy lịch trực?")}
          description={uiText(
            "Bạn có chắc chắn muốn hủy ca trực ngày {0} (Buổi {1}) của {2}?",
            [
              formatBusinessDate(cancelShiftDialog.shift.shift_date),
              cancelShiftDialog.shift.shift_slot === "MORNING"
                ? uiText("Sáng")
                : uiText("Chiều"),
              cancelShiftDialog.shift.staffName || uiText("Nhân sự"),
            ],
          )}
          confirmLabel={uiText("Hủy ca trực")}
          cancelLabel={uiText("Quay lại")}
          tone="danger"
          pending={pending}
          onConfirm={handleCancelShiftSubmit}
          onCancel={() => setCancelShiftDialog(null)}
        >
          {cancelShiftDialog.shift.shift_date < todayStr ? (
            <div className="mt-3 space-y-1.5 text-left">
              <label className="block text-xs font-bold text-neutral-800">
                {uiText("Lý do hủy ca trực lịch sử (bắt buộc):")}
              </label>
              <textarea
                rows={2}
                placeholder={uiText("Nhập lý do...")}
                value={cancelShiftDialog.historicalReason}
                onChange={(e) =>
                  setCancelShiftDialog((prev) =>
                    prev ? { ...prev, historicalReason: e.target.value } : null,
                  )
                }
                className="input text-xs w-full"
                required
              />
            </div>
          ) : (
            <div className="mt-3 space-y-1.5 text-left">
              <label className="block text-xs font-medium text-neutral-600">
                {uiText("Lý do hủy (tùy chọn):")}
              </label>
              <input
                type="text"
                placeholder={uiText("Nhập lý do hủy...")}
                value={cancelShiftDialog.historicalReason}
                onChange={(e) =>
                  setCancelShiftDialog((prev) =>
                    prev ? { ...prev, historicalReason: e.target.value } : null,
                  )
                }
                className="input text-xs w-full"
              />
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
