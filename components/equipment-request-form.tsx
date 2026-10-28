"use client";

import Link from "next/link";
import {
  FormEvent,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createEquipmentRequest,
  updateEquipmentRequest,
} from "@/app/equipment/actions";
import {
  SearchableCombobox,
  type ComboboxOption,
} from "@/components/searchable-combobox";
import {
  equipmentLeadTime,
  equipmentReceiveAt,
  equipmentHandoffTimes,
  lateEquipmentWarning,
} from "@/lib/equipment-lead-time";
import { hasDuplicateCommercialNameWithinActivity } from "@/lib/equipment-request-commercial-name-duplicate";
import type { EquipmentLateApprovalStatus } from "@/lib/equipment-requests";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

type CatalogItem = {
  id: string;
  item_name: string;
  commercial_name: string | null;
  item_type: string | null;
  country_of_origin: string | null;
  manufacturer: string | null;
  model: string | null;
  unit: string;
};

type ClassOption = {
  id: string;
  label: string;
  date: string;
  start: string;
  end: string;
  courseCode: string;
  courseName: string;
  room: string;
  studentCount: number;
  semester?: string;
};

type Lecturer = { id: string; full_name: string };

type DraftEquipment = {
  key: number;
  id?: string;
  itemName: string;
  catalogItemId: string;
  quantity: number;
  note: string;
};

type DraftSkill = {
  key: number;
  skillName: string;
  rows: DraftEquipment[];
};

export type EquipmentRequestInitialData = {
  mode: "copy" | "edit";
  sourceRequestId: string;
  requestRevision: number;
  sourceRequestCode: string;
  classId: string;
  semester: string;
  responsibleLecturerId: string;
  requiresResponsibleLecturerReplacement?: boolean;
  historicalResponsibleLecturerName?: string | null;
  receiveDate: string;
  receiveTime: string;
  returnDate: string;
  returnTime: string;
  note: string;
  lateApprovalStatus: EquipmentLateApprovalStatus;
  lateRegistrationReason: string;
  skills: Array<{
    skillName: string;
    rows: Array<{
      id?: string;
      itemName: string;
      catalogItemId: string;
      quantity: number;
      note: string;
    }>;
  }>;
};

let nextSkillKey = 1;
let nextEquipmentKey = 1;

function createEquipmentRow(): DraftEquipment {
  return {
    key: nextEquipmentKey++,
    itemName: "",
    catalogItemId: "",
    quantity: 1,
    note: "",
  };
}

function createSkill(): DraftSkill {
  return {
    key: nextSkillKey++,
    skillName: "",
    rows: [createEquipmentRow(), createEquipmentRow(), createEquipmentRow()],
  };
}

function hydrateSkills(
  initialData?: EquipmentRequestInitialData,
): DraftSkill[] {
  if (!initialData) return [];
  return initialData.skills.map((skill) => ({
    key: nextSkillKey++,
    skillName: skill.skillName,
    rows: skill.rows.map((row) => ({
      key: nextEquipmentKey++,
      id: initialData.mode === "edit" ? row.id : undefined,
      itemName: row.itemName,
      catalogItemId: row.catalogItemId,
      quantity: row.quantity,
      note: row.note,
    })),
  }));
}

function commercialOption(item: CatalogItem): ComboboxOption {
  const commercialName =
    item.commercial_name?.trim() || "Không có tên thương mại";
  const details = [item.model?.trim(), item.item_name].filter(Boolean);
  return {
    value: item.id,
    label: `${commercialName}${details.length ? ` — ${details.join(" · ")}` : ""}`,
    keywords: [
      item.item_name,
      item.item_type,
      item.country_of_origin,
      item.manufacturer,
      item.model,
      item.unit,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export function EquipmentRequestForm({
  classes,
  catalog,
  lecturers,
  defaultPhone = "",
  defaultClassId = "",
  registrantId,
  registrantName,
  registrantEmail,
  registrantIsOperationallyAssignable,
  skillSuggestions,
  today,
  initialData,
}: {
  classes: ClassOption[];
  catalog: CatalogItem[];
  lecturers: Lecturer[];
  defaultPhone?: string;
  defaultClassId?: string;
  registrantId: string;
  registrantName: string;
  registrantEmail: string;
  registrantIsOperationallyAssignable: boolean;
  skillSuggestions: string[];
  today: string;
  initialData?: EquipmentRequestInitialData;
}) {
  const { text: uiText } = useLanguage();

  const isEditMode = initialData?.mode === "edit";
  const submitAction = isEditMode
    ? updateEquipmentRequest
    : createEquipmentRequest;
  const [state, action, pending] = useActionState(submitAction, {
    ok: false,
    message: "",
  });
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const [classId, setClassId] = useState(
    initialData?.classId ?? defaultClassId,
  );
  const [receiveDate, setReceiveDate] = useState(
    initialData?.receiveDate ?? "",
  );
  const [receiveTime, setReceiveTime] = useState(
    initialData?.receiveTime ?? "",
  );
  const [returnDate, setReturnDate] = useState(initialData?.returnDate ?? "");
  const [lateRegistrationReason, setLateRegistrationReason] = useState(
    initialData?.lateRegistrationReason ?? "",
  );
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [skillCount, setSkillCount] = useState(initialData?.skills.length || 1);
  const [skills, setSkills] = useState<DraftSkill[]>(() =>
    hydrateSkills(initialData),
  );
  const [clientError, setClientError] = useState("");

  useEffect(() => {
    if (!state.message) return;
    feedbackRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [state]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNowMs(Date.now()), 0);
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  const selectedClass = classes.find((item) => item.id === classId);
  const leadTime = useMemo(() => {
    const receiveAt = equipmentReceiveAt(receiveDate, receiveTime);
    return receiveAt && nowMs !== null
      ? equipmentLeadTime(receiveAt, new Date(nowMs))
      : null;
  }, [nowMs, receiveDate, receiveTime]);
  const lateApprovalBasisChanged = Boolean(
    initialData &&
    (receiveDate !== initialData.receiveDate ||
      receiveTime !== initialData.receiveTime ||
      lateRegistrationReason.trim() !==
        initialData.lateRegistrationReason.trim()),
  );
  const needsLateApprovalSubmission = Boolean(
    leadTime?.requiresLateApproval &&
    (initialData?.lateApprovalStatus !== "approved" ||
      lateApprovalBasisChanged),
  );
  const registerReturnTo = initialData
    ? `/equipment/register?mode=${initialData.mode}&request=${initialData.sourceRequestId}`
    : "/equipment/register";
  const catalogIndex = useMemo(() => {
    const byId = new Map<string, CatalogItem>();
    const itemsByName = new Map<string, CatalogItem[]>();
    for (const item of catalog) {
      byId.set(item.id, item);
      itemsByName.set(item.item_name, [
        ...(itemsByName.get(item.item_name) ?? []),
        item,
      ]);
    }
    const itemNameOptions = [...itemsByName.entries()]
      .map(([itemName, items]) => ({
        value: itemName,
        label: itemName,
        keywords: items
          .flatMap((item) => [
            item.commercial_name,
            item.item_type,
            item.manufacturer,
            item.model,
          ])
          .filter(Boolean)
          .join(" "),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "vi"));
    const allCommercialOptions = catalog
      .map(commercialOption)
      .sort((a, b) => a.label.localeCompare(b.label, "vi"));
    const commercialOptionsByItemName = new Map<string, ComboboxOption[]>();
    for (const [itemName, items] of itemsByName) {
      commercialOptionsByItemName.set(
        itemName,
        items
          .map(commercialOption)
          .sort((a, b) => a.label.localeCompare(b.label, "vi")),
      );
    }
    return {
      byId,
      itemsByName,
      itemNameOptions,
      allCommercialOptions,
      commercialOptionsByItemName,
    };
  }, [catalog]);
  const responsibleOptions = useMemo(() => {
    const options = [
      { id: registrantId, full_name: `${registrantName} (Người đăng ký)` },
      ...lecturers.map((person) => ({
        ...person,
        full_name:
          person.id === registrantId
            ? `${person.full_name} (Người đăng ký)`
            : person.full_name,
      })),
    ];
    return [
      ...new Map(options.map((person) => [person.id, person])).values(),
    ].filter(
      (person) =>
        registrantIsOperationallyAssignable || person.id !== registrantId,
    );
  }, [
    lecturers,
    registrantId,
    registrantIsOperationallyAssignable,
    registrantName,
  ]);
  const defaultResponsibleLecturerId =
    initialData?.responsibleLecturerId ??
    (registrantIsOperationallyAssignable ? registrantId : "");
  const payload = useMemo(
    () =>
      skills.flatMap((skill) =>
        skill.rows.map((row) => ({
          id: row.id,
          skillName: skill.skillName,
          catalogItemId: row.catalogItemId,
          quantity: row.quantity,
          note: row.note,
        })),
      ),
    [skills],
  );

  function buildSkillTables() {
    setSkills((current) => {
      if (current.length === skillCount) return current;
      if (current.length > skillCount) return current.slice(0, skillCount);
      return [
        ...current,
        ...Array.from({ length: skillCount - current.length }, createSkill),
      ];
    });
    setClientError("");
  }

  function updateSkill(skillKey: number, patch: Partial<DraftSkill>) {
    setSkills((current) =>
      current.map((skill) =>
        skill.key === skillKey ? { ...skill, ...patch } : skill,
      ),
    );
  }

  function updateRow(
    skillKey: number,
    rowKey: number,
    patch: Partial<DraftEquipment>,
  ) {
    setSkills((current) =>
      current.map((skill) =>
        skill.key === skillKey
          ? {
              ...skill,
              rows: skill.rows.map((row) =>
                row.key === rowKey ? { ...row, ...patch } : row,
              ),
            }
          : skill,
      ),
    );
  }

  function selectItemName(
    skillKey: number,
    row: DraftEquipment,
    itemName: string,
  ) {
    const matches = catalogIndex.itemsByName.get(itemName) ?? [];
    updateRow(skillKey, row.key, {
      itemName,
      catalogItemId: matches.length === 1 ? matches[0].id : "",
    });
  }

  function selectCommercialItem(
    skillKey: number,
    row: DraftEquipment,
    catalogItemId: string,
  ) {
    const selected = catalogIndex.byId.get(catalogItemId);
    updateRow(skillKey, row.key, {
      catalogItemId,
      itemName: selected?.item_name ?? "",
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!skills.length) {
      event.preventDefault();
      setClientError(
        'Chọn số lượng kỹ năng rồi bấm "Tạo bảng thiết bị" trước khi gửi.',
      );
      return;
    }
    if (payload.some((item) => !item.skillName.trim() || !item.catalogItemId)) {
      event.preventDefault();
      setClientError(
        "Mỗi dòng phải chọn Tên thiết bị và Tên thương mại từ danh sách gợi ý.",
      );
      return;
    }
    const formData = new FormData(event.currentTarget);
    const submittedReceiveTime = String(formData.get("receive_time") ?? "");
    const returnTime = String(formData.get("return_time") ?? "");
    if (
      !selectedClass ||
      receiveDate < today ||
      receiveDate > selectedClass.date
    ) {
      event.preventDefault();
      setClientError("Ngày nhận phải từ hôm nay đến ngày học.");
      return;
    }
    if (
      !selectedClass ||
      returnDate < selectedClass.date ||
      returnDate < receiveDate ||
      (returnDate === receiveDate && returnTime < submittedReceiveTime)
    ) {
      event.preventDefault();
      setClientError(
        "Ngày trả phải bằng hoặc sau ngày học; giờ trả không được trước giờ nhận khi cùng ngày.",
      );
      return;
    }
    if (
      !equipmentHandoffTimes.includes(
        submittedReceiveTime as (typeof equipmentHandoffTimes)[number],
      ) ||
      !equipmentHandoffTimes.includes(
        returnTime as (typeof equipmentHandoffTimes)[number],
      )
    ) {
      event.preventDefault();
      setClientError("Giờ nhận và giờ trả không hợp lệ.");
      return;
    }
    if (leadTime?.isExpired) {
      event.preventDefault();
      setClientError("Thời gian nhận thiết bị phải sau thời điểm đăng ký.");
      return;
    }
    if (needsLateApprovalSubmission && !lateRegistrationReason.trim()) {
      event.preventDefault();
      setClientError("Bắt buộc nhập “Lý do đăng ký trễ”.");
      return;
    }
    if (
      hasDuplicateCommercialNameWithinActivity(
        payload.map((item) => ({
          activityId: item.skillName,
          catalogItemId: item.catalogItemId,
        })),
        catalogIndex.byId,
      )
    ) {
      event.preventDefault();
      setClientError(
        "Cùng một tên thương mại thiết bị đã được đăng ký trong kỹ năng/bài thực hành này.",
      );
      return;
    }
  }

  return (
    <form
      action={action}
      className="schedule-form equipment-request-form"
      autoComplete="off"
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="items" value={JSON.stringify(payload)} />
      <input
        type="hidden"
        name="expected_revision"
        value={isEditMode ? initialData.requestRevision : ""}
      />
      {initialData?.mode === "edit" ? (
        <input
          type="hidden"
          name="request_id"
          value={initialData.sourceRequestId}
        />
      ) : null}
      {isEditMode ? (
        <input
          type="hidden"
          name="class_schedule_id"
          value={initialData.classId}
        />
      ) : null}
      {initialData ? (
        <div
          className={`equipment-form-mode-banner equipment-form-mode-${initialData.mode}`}
        >
          <strong>
            {initialData.mode === "copy"
              ? uiText("Đang sao chép phiếu")
              : uiText("Đang điều chỉnh phiếu")}{" "}
            #{initialData.sourceRequestCode}
          </strong>
          {isEditMode ? (
            <p>
              {uiText(
                "Chỉ chỉnh sửa thông tin và ghi chú tại đây. Để thay đổi số lượng, thêm hoặc bỏ thiết bị,",
              )}{" "}
              <Link
                href={`/equipment/preparation/${initialData.sourceRequestId}`}
              >
                {uiText("gửi yêu cầu điều chỉnh trong trang chuẩn bị thiết bị")}
              </Link>
              .
            </p>
          ) : null}
        </div>
      ) : null}
      {state.message ? (
        <p
          ref={feedbackRef}
          className={`${state.ok ? "form-success" : "form-error"} equipment-form-feedback`}
          role="status"
          style={{ textAlign: "center" }}
        >
          <LocalizedText text={state.message ?? ""} />
        </p>
      ) : null}
      {clientError ? (
        <p className="form-error">
          <LocalizedText text={clientError ?? ""} />
        </p>
      ) : null}

      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">01</span>
            <h2>{uiText("Thông tin môn học")}</h2>
          </div>
          <p>
            {uiText(
              "Chọn lớp đã tạo trên Lịch Skills lab hoặc tạo một lớp mới trước.",
            )}
          </p>
        </div>
        <div className="class-picker-row">
          <label>
            {uiText("Lớp Skills lab *")}
            <select
              name={isEditMode ? undefined : "class_schedule_id"}
              required={!isEditMode}
              disabled={isEditMode}
              value={isEditMode ? initialData.classId : classId}
              onChange={(event) => {
                const nextClassId = event.target.value;
                const nextClass = classes.find(
                  (item) => item.id === nextClassId,
                );
                setClassId(nextClassId);
                if (receiveDate && nextClass && receiveDate > nextClass.date) {
                  setReceiveDate("");
                }
                if (returnDate && nextClass && returnDate < nextClass.date)
                  setReturnDate("");
              }}
            >
              <option value="" disabled>
                {uiText("Chọn lớp theo ngày, giờ và phòng")}
              </option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {isEditMode ? null : (
            <Link
              className="button button-secondary create-class-button"
              href={`/schedule-entry/new?returnTo=${encodeURIComponent(registerReturnTo)}`}
            >
              {uiText("+ Tạo lớp mới")}
            </Link>
          )}
        </div>
        <div className="form-grid three">
          <label>
            {uiText("Ngày học")}
            <input
              value={selectedClass?.date.split("-").reverse().join("/") ?? ""}
              readOnly
            />
          </label>
          <label>
            {uiText("Giờ học")}
            <input
              value={
                selectedClass
                  ? `${selectedClass.start}–${selectedClass.end}`
                  : ""
              }
              readOnly
            />
          </label>
          <label>
            {uiText("Học kỳ")}
            <input
              value={
                selectedClass?.semester ||
                (initialData?.mode === "edit" && initialData.classId === classId
                  ? initialData.semester
                  : "")
              }
              readOnly
              placeholder={uiText("Chưa có học kỳ")}
            />
          </label>
          <label>
            {uiText("Mã môn học")}
            <input value={selectedClass?.courseCode ?? ""} readOnly />
          </label>
          <label>
            {uiText("Tên môn học")}
            <input value={selectedClass?.courseName ?? ""} readOnly />
          </label>
          <label>
            {uiText("Số lượng sinh viên")}
            <input value={selectedClass?.studentCount ?? ""} readOnly />
          </label>
          <label>
            {uiText("Loại lab")}
            <input
              value={selectedClass ? uiText("Kỹ năng Điều dưỡng") : ""}
              readOnly
            />
          </label>
          <label>
            {uiText("Phòng/Lab")}
            <input value={selectedClass?.room ?? ""} readOnly />
          </label>
        </div>
      </section>

      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">02</span>
            <h2>{uiText("Thông tin người đăng ký")}</h2>
          </div>
        </div>
        <div className="form-grid three">
          <label>
            {uiText("Người đăng ký")}
            <input value={registrantName} readOnly />
          </label>
          <label>
            {uiText("Email")}
            <input value={registrantEmail} readOnly />
          </label>
          <label>
            {uiText("Số điện thoại *")}
            <input
              name="phone"
              value={defaultPhone}
              readOnly
              required
              pattern="[0-9]{10}"
            />
          </label>
        </div>
        {!/^\d{10}$/.test(defaultPhone) ? (
          <p className="form-error">
            {uiText(
              "Hồ sơ Nhân sự chưa có số điện thoại 10 chữ số. Vui lòng bổ sung trước khi đăng ký.",
            )}
          </p>
        ) : null}
      </section>

      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">03</span>
            <h2>{uiText("Thông tin giảng viên phụ trách")}</h2>
          </div>
        </div>
        <div className="form-grid three">
          <label>
            {uiText("Giảng viên phụ trách *")}
            <select
              name="responsible_lecturer_id"
              required
              defaultValue={defaultResponsibleLecturerId}
            >
              <option value="" disabled>
                {uiText("Select a responsible lecturer")}
              </option>
              {responsibleOptions.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {initialData?.requiresResponsibleLecturerReplacement ? (
          <p className="form-error" role="alert">
            {uiText(
              "Tài khoản Root Admin không thể được phân công vận hành. Vui lòng chọn người thay thế.",
            )}
            {initialData.historicalResponsibleLecturerName
              ? uiText(" Phân công lịch sử: {0}.", [
                  initialData.historicalResponsibleLecturerName,
                ])
              : ""}
          </p>
        ) : null}
      </section>

      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">04</span>
            <h2>{uiText("Thông tin nhận thiết bị")}</h2>
          </div>
        </div>
        <div className="form-grid four">
          <label>
            {uiText("Ngày nhận *")}
            <input
              name="receive_date"
              type="date"
              required
              min={today}
              max={selectedClass?.date}
              value={receiveDate}
              onChange={(event) => {
                const value = event.target.value;
                setReceiveDate(value);
                if (returnDate && returnDate < value) setReturnDate("");
                setClientError("");
              }}
            />
          </label>
          <label>
            {uiText("Giờ nhận *")}
            <select
              name="receive_time"
              value={receiveTime}
              onChange={(event) => {
                setReceiveTime(event.target.value);
                setClientError("");
              }}
              required
            >
              <option value="" disabled>
                {uiText("Chọn giờ")}
              </option>
              {equipmentHandoffTimes.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>
          <label>
            {uiText("Ngày trả *")}
            <input
              name="return_date"
              type="date"
              required
              min={selectedClass?.date || receiveDate || today}
              value={returnDate}
              onChange={(event) => {
                setReturnDate(event.target.value);
                setClientError("");
              }}
            />
          </label>
          <label>
            {uiText("Giờ trả *")}
            <select
              name="return_time"
              defaultValue={initialData?.returnTime ?? ""}
              required
            >
              <option value="" disabled>
                {uiText("Chọn giờ")}
              </option>
              {equipmentHandoffTimes.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>
        </div>
        {leadTime?.requiresLateApproval ? (
          <div className="equipment-late-warning" role="alert">
            <strong>{lateEquipmentWarning(leadTime.remainingMs)}</strong>
            <label>
              {uiText("Lý do đăng ký trễ *")}
              <textarea
                name="late_registration_reason"
                rows={3}
                required
                value={lateRegistrationReason}
                onChange={(event) => {
                  setLateRegistrationReason(event.target.value);
                  setClientError("");
                }}
              />
            </label>
          </div>
        ) : (
          <input type="hidden" name="late_registration_reason" value="" />
        )}
        <div className="skill-count-controls">
          <label>
            {uiText("Số lượng kỹ năng/bài thực hành *")}
            <select
              value={skillCount}
              disabled={isEditMode}
              onChange={(event) => setSkillCount(Number(event.target.value))}
            >
              {[1, 2, 3, 4, 5].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button-secondary"
            onClick={buildSkillTables}
            disabled={isEditMode}
          >
            {uiText("+ Tạo bảng thiết bị")}
          </button>
        </div>
      </section>

      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">05</span>
            <h2>{uiText("Thiết bị theo kỹ năng/bài thực hành")}</h2>
          </div>
          <p>
            {isEditMode
              ? uiText(
                  "Thiết bị và số lượng đã đăng ký được giữ nguyên; có thể sửa tên kỹ năng và ghi chú.",
                )
              : uiText(
                  "Chọn tên thiết bị trước; tên thương mại sẽ được lọc tương ứng và các thông tin danh mục được tự động điền.",
                )}
          </p>
        </div>
        <datalist id="equipment-skill-suggestions">
          {skillSuggestions.map((skill) => (
            <option key={skill} value={skill} />
          ))}
        </datalist>
        {!skills.length ? (
          <p className="panel-empty">
            {uiText(
              "Chọn số lượng kỹ năng ở mục 4 rồi bấm “Tạo bảng thiết bị”.",
            )}
          </p>
        ) : null}
        <div className="equipment-skill-list">
          {skills.map((skill, skillIndex) => (
            <article className="equipment-skill-card" key={skill.key}>
              <div className="equipment-skill-header">
                <strong>
                  {uiText("Kỹ năng/Bài thực hành #")}
                  {skillIndex + 1}
                </strong>
                <span className="badge badge-slate">
                  {skill.rows.length}
                  {uiText(" dòng")}
                </span>
              </div>
              <label>
                {uiText("Tên kỹ năng/Bài thực hành *")}
                <input
                  list="equipment-skill-suggestions"
                  value={skill.skillName}
                  onChange={(event) =>
                    updateSkill(skill.key, { skillName: event.target.value })
                  }
                  required
                  placeholder={uiText("Nhập hoặc chọn tên kỹ năng…")}
                />
              </label>
              <div className="responsive-table">
                <table className="data-table equipment-items-table">
                  <thead>
                    <tr>
                      <th>{uiText("STT")}</th>
                      <th>{uiText("Tên thiết bị và vật tư *")}</th>
                      <th>{uiText("Tên thương mại *")}</th>
                      <th>{uiText("ĐVT")}</th>
                      <th>{uiText("Số lượng *")}</th>
                      <th>{uiText("Ghi chú")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {skill.rows.map((row, rowIndex) => {
                      const commercialOptions =
                        row.itemName && !row.catalogItemId
                          ? (catalogIndex.commercialOptionsByItemName.get(
                              row.itemName,
                            ) ?? [])
                          : catalogIndex.allCommercialOptions;
                      const selected = catalogIndex.byId.get(row.catalogItemId);
                      return (
                        <tr key={row.key}>
                          <td>{rowIndex + 1}</td>
                          <td>
                            <SearchableCombobox
                              value={row.itemName}
                              options={catalogIndex.itemNameOptions}
                              disabled={isEditMode}
                              onChange={(value) =>
                                selectItemName(skill.key, row, value)
                              }
                              required
                              ariaLabel={uiText(
                                "Tên thiết bị dòng {0}, kỹ năng {1}",
                                [rowIndex + 1, skillIndex + 1],
                              )}
                              placeholder={uiText("Gõ hoặc chọn tên thiết bị…")}
                            />
                          </td>
                          <td>
                            <SearchableCombobox
                              value={row.catalogItemId}
                              options={commercialOptions}
                              disabled={isEditMode}
                              onChange={(value) =>
                                selectCommercialItem(skill.key, row, value)
                              }
                              required
                              ariaLabel={uiText(
                                "Tên thương mại dòng {0}, kỹ năng {1}",
                                [rowIndex + 1, skillIndex + 1],
                              )}
                              placeholder={uiText(
                                "Gõ hoặc chọn tên thương mại…",
                              )}
                            />
                          </td>
                          <td>
                            <input value={selected?.unit ?? ""} readOnly />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="1"
                              value={row.quantity}
                              readOnly={isEditMode}
                              onChange={(event) =>
                                updateRow(skill.key, row.key, {
                                  quantity: Number(event.target.value),
                                })
                              }
                              required
                            />
                          </td>
                          <td>
                            <input
                              value={row.note}
                              onChange={(event) =>
                                updateRow(skill.key, row.key, {
                                  note: event.target.value,
                                })
                              }
                              placeholder={uiText("Nếu có")}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="button button-secondary"
                              disabled={isEditMode || skill.rows.length === 1}
                              onClick={() =>
                                updateSkill(skill.key, {
                                  rows: skill.rows.filter(
                                    (item) => item.key !== row.key,
                                  ),
                                })
                              }
                            >
                              {uiText("Xóa")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="button button-secondary"
                disabled={isEditMode}
                onClick={() =>
                  updateSkill(skill.key, {
                    rows: [...skill.rows, createEquipmentRow()],
                  })
                }
              >
                {uiText("+ Thêm dòng")}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section>
        <label>
          {uiText("Ghi chú chung")}
          <textarea
            name="note"
            rows={3}
            defaultValue={initialData?.note ?? ""}
          />
        </label>
      </section>
      <footer>
        <Link className="button button-secondary" href="/class-schedules">
          {uiText("Hủy")}
        </Link>
        <button
          type="submit"
          className="button button-primary"
          disabled={pending || !/^\d{10}$/.test(defaultPhone)}
        >
          {pending
            ? uiText("Đang lưu…")
            : needsLateApprovalSubmission
              ? uiText("Gửi yêu cầu duyệt đăng ký trễ")
              : initialData?.mode === "edit"
                ? uiText("Lưu điều chỉnh")
                : initialData?.mode === "copy"
                  ? uiText("Tạo phiếu sao chép")
                  : uiText("Gửi đăng ký")}
        </button>
      </footer>
    </form>
  );
}
