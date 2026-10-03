"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchableCombobox } from "@/components/searchable-combobox";
import {
  createBasicMedicalEquipmentRequest,
  updateBasicMedicalEquipmentRequest,
  type BasicMedicalEquipmentRequestActionState,
} from "@/app/basic-medical/registrations/actions";
import {
  equipmentHandoffTimes,
  equipmentLeadTime,
  equipmentReceiveAt,
  lateEquipmentWarning,
} from "@/lib/equipment-lead-time";
import { hasDuplicateCommercialNameWithinActivity } from "@/lib/equipment-request-commercial-name-duplicate";
import type {
  BasicMedicalEquipmentCatalogItem,
  BasicMedicalRegistrationListItem,
  BasicMedicalRegistrationSessionItem,
} from "@/lib/basic-medical-equipment";

export type BasicMedicalEquipmentRegistrant = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
};

type DraftItem = {
  key: number;
  id?: string;
  itemName: string;
  catalogItemId: string;
  quantity: number;
  note: string;
};

export type BasicMedicalEquipmentRequestInitialData = {
  mode: "edit" | "copy";
  sourceRequestId: string;
  requestRevision: number;
  sourceRequestCode: string;
  receiveDate: string;
  receiveTime: string;
  returnDate: string;
  returnTime: string;
  note: string;
  lateRegistrationReason: string;
  items: Array<Omit<DraftItem, "key">>;
};

const initialState: BasicMedicalEquipmentRequestActionState = {
  ok: false,
  message: "",
};

function formatDate(value?: string) {
  return value ? value.split("-").reverse().join("/") : "—";
}

function formatTime(value?: string) {
  return value?.slice(0, 5) ?? "—";
}

export function BasicMedicalEquipmentRequestForm({
  registration,
  session,
  catalog,
  today,
  equipmentRegistrant,
  initialData,
}: {
  registration: BasicMedicalRegistrationListItem;
  session: BasicMedicalRegistrationSessionItem;
  catalog: BasicMedicalEquipmentCatalogItem[];
  today: string;
  equipmentRegistrant: BasicMedicalEquipmentRegistrant;
  initialData?: BasicMedicalEquipmentRequestInitialData;
}) {
  const router = useRouter();
  const isEditMode = initialData?.mode === "edit";
  const [state, formAction, pending] = useActionState(
    isEditMode
      ? updateBasicMedicalEquipmentRequest
      : createBasicMedicalEquipmentRequest,
    initialState,
  );
  const nextKey = useRef((initialData?.items.length ?? 1) + 1);
  const [items, setItems] = useState<DraftItem[]>(
    initialData?.items.length
      ? initialData.items.map((item, index) => ({
          ...item,
          id: isEditMode ? item.id : undefined,
          key: index + 1,
        }))
      : [{ key: 1, itemName: "", catalogItemId: "", quantity: 1, note: "" }],
  );
  const [receiveDate, setReceiveDate] = useState(
    initialData?.receiveDate || today,
  );
  const [receiveTime, setReceiveTime] = useState<
    (typeof equipmentHandoffTimes)[number]
  >(
    (initialData?.receiveTime as (typeof equipmentHandoffTimes)[number]) ||
      "09:00",
  );
  const [returnDate, setReturnDate] = useState(
    initialData?.returnDate || session.class_schedules?.schedule_date || today,
  );
  const [returnTime, setReturnTime] = useState<
    (typeof equipmentHandoffTimes)[number]
  >(
    (initialData?.returnTime as (typeof equipmentHandoffTimes)[number]) ||
      "16:00",
  );
  const [clientError, setClientError] = useState("");
  const [lateRegistrationReason, setLateRegistrationReason] = useState(
    initialData?.lateRegistrationReason ?? "",
  );
  const [nowMs, setNowMs] = useState<number | null>(null);
  const scheduleDate = session.class_schedules?.schedule_date ?? today;
  const receiveAt = useMemo(
    () => equipmentReceiveAt(receiveDate, receiveTime),
    [receiveDate, receiveTime],
  );
  const leadTime =
    receiveAt && nowMs !== null
      ? equipmentLeadTime(receiveAt, new Date(nowMs))
      : null;
  const phoneIsValid = /^\d{10}$/.test(equipmentRegistrant.phone);
  const catalogIndex = useMemo(() => {
    const byId = new Map(catalog.map((item) => [item.id, item]));
    const itemsByName = new Map<string, BasicMedicalEquipmentCatalogItem[]>();
    for (const item of catalog) {
      itemsByName.set(item.item_name, [
        ...(itemsByName.get(item.item_name) ?? []),
        item,
      ]);
    }
    const options = (catalogItems: BasicMedicalEquipmentCatalogItem[]) =>
      catalogItems.map((item) => ({
        value: item.id,
        label: item.commercial_name || item.item_name,
        keywords: [item.item_name, item.model, item.manufacturer]
          .filter(Boolean)
          .join(" "),
      }));

    return {
      byId,
      itemsByName,
      itemNameOptions: [...itemsByName.entries()].map(([value, matches]) => ({
        value,
        label: value,
        keywords: matches.map((item) => item.commercial_name ?? "").join(" "),
      })),
      allCommercialOptions: options(catalog),
      commercialOptionsByItemName: new Map(
        [...itemsByName.entries()].map(([name, matches]) => [
          name,
          options(matches),
        ]),
      ),
    };
  }, [catalog]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNowMs(Date.now()), 0);
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [router, state.ok]);

  function updateItem(key: number, patch: Partial<DraftItem>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  function selectItemName(item: DraftItem, itemName: string) {
    const matches = catalogIndex.itemsByName.get(itemName) ?? [];
    updateItem(item.key, {
      itemName,
      catalogItemId: matches.length === 1 ? matches[0].id : "",
    });
  }

  function selectCommercialItem(item: DraftItem, catalogItemId: string) {
    updateItem(item.key, {
      catalogItemId,
      itemName: catalogIndex.byId.get(catalogItemId)?.item_name ?? "",
    });
  }

  function submitCheck(event: React.FormEvent<HTMLFormElement>) {
    if (
      !items.length ||
      !phoneIsValid ||
      items.some(
        (item) => !item.itemName || !item.catalogItemId || item.quantity < 1,
      ) ||
      receiveDate < today ||
      receiveDate > scheduleDate ||
      returnDate < scheduleDate ||
      (returnDate === receiveDate && returnTime < receiveTime) ||
      leadTime?.isExpired
    ) {
      event.preventDefault();
      setClientError(
        "Vui lòng kiểm tra ngày giờ và ít nhất một thiết bị hợp lệ.",
      );
      return;
    }
    if (leadTime?.requiresLateApproval && !lateRegistrationReason.trim()) {
      event.preventDefault();
      setClientError("Vui lòng nhập Lý do đăng ký trễ.");
      return;
    }
    if (
      hasDuplicateCommercialNameWithinActivity(
        items.map((item) => ({
          activityId: session.id,
          catalogItemId: item.catalogItemId,
        })),
        catalogIndex.byId,
      )
    ) {
      event.preventDefault();
      setClientError(
        "Cùng một tên thương mại thiết bị đã được đăng ký trong bài TN-TH này.",
      );
      return;
    }
    setClientError("");
  }

  return (
    <form
      className="schedule-form equipment-request-form"
      action={formAction}
      autoComplete="off"
      onSubmit={submitCheck}
    >
      <input type="hidden" name="session_id" value={session.id} />
      {isEditMode ? (
        <input
          type="hidden"
          name="request_id"
          value={initialData.sourceRequestId}
        />
      ) : null}
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(
          items.map(({ id, catalogItemId, quantity, note }) => ({
            id,
            catalogItemId,
            quantity,
            note,
          })),
        )}
      />
      <input
        type="hidden"
        name="expected_revision"
        value={initialData?.requestRevision ?? ""}
      />
      {initialData ? (
        <div
          className={`equipment-form-mode-banner equipment-form-mode-${initialData.mode}`}
        >
          <strong>
            {initialData.mode === "copy"
              ? "Đang sao chép phiếu"
              : "Đang điều chỉnh phiếu"}{" "}
            #{initialData.sourceRequestCode}
          </strong>
        </div>
      ) : null}
      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">01</span>
            <h2>Thông tin môn học</h2>
          </div>
        </div>
        <div className="form-grid four">
          <label>
            Ngày học
            <input value={formatDate(scheduleDate)} readOnly />
          </label>
          <label>
            Giờ học
            <input
              value={`${formatTime(session.class_schedules?.start_time)}–${formatTime(session.class_schedules?.end_time)}`}
              readOnly
            />
          </label>
          <label>
            Học kỳ
            <input value={registration.semester} readOnly />
          </label>
          <label>
            Mã môn học
            <input value={registration.courses?.course_code ?? ""} readOnly />
          </label>
          <label>
            Tên môn học
            <input value={registration.courses?.course_name ?? ""} readOnly />
          </label>
          <label>
            Số lượng sinh viên
            <input value={registration.student_count} readOnly />
          </label>
          <label>
            Loại lab
            <input value="Y cơ sở" readOnly />
          </label>
          <label>
            Phòng/Lab
            <input
              value={`${registration.rooms?.room_code ?? ""}.${registration.rooms?.building_code ?? ""}`}
              readOnly
            />
          </label>
          <label>
            Buổi học
            <input value={`Buổi ${session.session_number}`} readOnly />
          </label>
          <label>
            Tên bài TN-TH
            <input value={session.lesson_title} readOnly />
          </label>
        </div>
      </section>
      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">02</span>
            <h2>Thông tin người đăng ký</h2>
          </div>
        </div>
        <div className="form-grid three">
          <label>
            Người đăng ký
            <input value={equipmentRegistrant.fullName} readOnly />
          </label>
          <label>
            Email
            <input value={equipmentRegistrant.email} readOnly />
          </label>
          <label>
            Số điện thoại *
            <input value={equipmentRegistrant.phone} readOnly />
          </label>
        </div>
        {!phoneIsValid ? (
          <p className="form-error" role="alert">
            Hồ sơ Nhân sự chưa có số điện thoại 10 chữ số. Vui lòng bổ sung
            trước khi đăng ký.
          </p>
        ) : null}
      </section>
      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">03</span>
            <h2>Thông tin giảng viên phụ trách</h2>
          </div>
        </div>
        <div className="form-grid">
          <label>
            Giảng viên phụ trách
            <input value={session.teaching?.full_name ?? ""} readOnly />
          </label>
        </div>
      </section>
      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">04</span>
            <h2>Thông tin nhận thiết bị</h2>
          </div>
        </div>
        <div className="form-grid four">
          <label>
            Ngày nhận *
            <input
              name="receive_date"
              type="date"
              min={today}
              max={scheduleDate}
              value={receiveDate}
              onChange={(event) => {
                setReceiveDate(event.target.value);
                setClientError("");
              }}
              required
            />
          </label>
          <label>
            Giờ nhận *
            <select
              name="receive_time"
              value={receiveTime}
              onChange={(event) => {
                setReceiveTime(event.target.value as typeof receiveTime);
                setClientError("");
              }}
              required
            >
              {equipmentHandoffTimes.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ngày trả *
            <input
              name="return_date"
              type="date"
              min={scheduleDate}
              value={returnDate}
              onChange={(event) => {
                setReturnDate(event.target.value);
                setClientError("");
              }}
              required
            />
          </label>
          <label>
            Giờ trả *
            <select
              name="return_time"
              value={returnTime}
              onChange={(event) => {
                setReturnTime(event.target.value as typeof returnTime);
                setClientError("");
              }}
              required
            >
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
              Lý do đăng ký trễ *
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
      </section>
      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">05</span>
            <h2>Thiết bị theo bài TN-TH</h2>
          </div>
        </div>
        <article className="equipment-skill-card">
          <label>
            Tên kỹ năng/Bài thực hành *
            <input value={session.lesson_title} readOnly />
          </label>
          <div className="responsive-table">
            <table className="data-table equipment-items-table">
              <thead>
                <tr>
                  <th>STT</th>
                  <th>Tên thiết bị và vật tư *</th>
                  <th>Tên thương mại *</th>
                  <th>ĐVT</th>
                  <th>Số lượng *</th>
                  <th>Ghi chú</th>
                  <th>
                    <span className="sr-only">Xóa</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const commercialOptions =
                    item.itemName && !item.catalogItemId
                      ? (catalogIndex.commercialOptionsByItemName.get(
                          item.itemName,
                        ) ?? [])
                      : catalogIndex.allCommercialOptions;
                  return (
                    <tr key={item.key}>
                      <td>{index + 1}</td>
                      <td>
                        <SearchableCombobox
                          value={item.itemName}
                          options={catalogIndex.itemNameOptions}
                          onChange={(value) => selectItemName(item, value)}
                          required
                          ariaLabel={`Tên thiết bị dòng ${index + 1}`}
                          placeholder="Gõ hoặc chọn tên thiết bị…"
                        />
                      </td>
                      <td>
                        <SearchableCombobox
                          value={item.catalogItemId}
                          options={commercialOptions}
                          onChange={(value) =>
                            selectCommercialItem(item, value)
                          }
                          required
                          ariaLabel={`Tên thương mại dòng ${index + 1}`}
                          placeholder="Gõ hoặc chọn tên thương mại…"
                        />
                      </td>
                      <td>
                        <input
                          value={
                            catalogIndex.byId.get(item.catalogItemId)?.unit ??
                            ""
                          }
                          readOnly
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Số lượng thiết bị dòng ${index + 1}`}
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(item.key, {
                              quantity: Number(event.target.value),
                            })
                          }
                          required
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Ghi chú thiết bị dòng ${index + 1}`}
                          value={item.note}
                          onChange={(event) =>
                            updateItem(item.key, { note: event.target.value })
                          }
                          placeholder="Nếu có"
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={pending || items.length === 1}
                          onClick={() =>
                            setItems((current) =>
                              current.filter(
                                (candidate) => candidate.key !== item.key,
                              ),
                            )
                          }
                        >
                          Xóa
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
            disabled={pending}
            onClick={() =>
              setItems((current) => [
                ...current,
                {
                  key: nextKey.current++,
                  itemName: "",
                  catalogItemId: "",
                  quantity: 1,
                  note: "",
                },
              ])
            }
          >
            + Thêm dòng
          </button>
        </article>
      </section>
      <section>
        <label>
          Ghi chú chung
          <textarea name="note" rows={3} defaultValue={initialData?.note} />
        </label>
      </section>
      {clientError ? (
        <p className="form-error" role="alert">
          {clientError}
        </p>
      ) : null}
      {state.message ? (
        <p className={state.ok ? "form-success" : "form-error"} role="status">
          {state.message}
        </p>
      ) : null}
      <footer>
        <a
          className="button button-secondary"
          href="/basic-medical/equipment-requests"
        >
          Hủy
        </a>
        <button
          type="submit"
          className="button button-primary"
          disabled={pending || !catalog.length || !phoneIsValid}
        >
          {pending
            ? "Đang lưu…"
            : leadTime?.requiresLateApproval
              ? "Gửi yêu cầu duyệt đăng ký trễ"
              : isEditMode
                ? "Lưu điều chỉnh"
                : initialData?.mode === "copy"
                  ? "Tạo phiếu sao chép"
                  : "Gửi đăng ký"}
        </button>
      </footer>
    </form>
  );
}
