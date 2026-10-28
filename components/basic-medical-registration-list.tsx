"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  confirmBasicMedicalSession,
  cancelBasicMedicalRegistration,
  cancelBasicMedicalSession,
  invalidateBasicMedicalSessionConfirmation,
  updateBasicMedicalSessionTeachingLecturer,
} from "@/app/basic-medical/registrations/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Trash2 } from "@/components/icons";
import { formatBasicMedicalRegistrationCode } from "@/lib/basic-medical-registration-code";
import {
  activeSessionConfirmation,
  createBasicMedicalConfirmationTimerLifecycle,
  isBasicMedicalConfirmationTooEarly,
  type BasicMedicalRegistrationListItem,
  type BasicMedicalSessionConfirmation,
  type BasicMedicalRegistrationSessionItem,
  type BasicMedicalRoomInventoryItem,
  type BasicMedicalInstructorOption,
} from "@/lib/basic-medical-equipment";
import {
  equipmentStatusMeta,
  type EquipmentRequestListItem,
} from "@/lib/equipment-requests";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatDate(value?: string) {
  return value ? value.split("-").reverse().join("/") : "—";
}

function formatTime(value?: string) {
  return value?.slice(0, 5) ?? "—";
}

function earliestConfirmationDate(
  session: BasicMedicalRegistrationSessionItem,
) {
  const schedule = session.class_schedules;
  if (!schedule) return null;
  const end = new Date(
    `${schedule.schedule_date}T${schedule.end_time.slice(0, 8)}+07:00`,
  );
  return new Date(end.getTime() - 60 * 60 * 1000);
}

type DamageDraft = Record<string, number>;

function BasicMedicalConfirmationModal({
  registration,
  session,
  inventories,
  onClose,
  onConfirmed,
}: {
  registration: BasicMedicalRegistrationListItem;
  session: BasicMedicalRegistrationSessionItem;
  inventories: BasicMedicalRoomInventoryItem[];
  onClose: () => void;
  onConfirmed: (confirmation: { id: string; signed_at: string }) => void;
}) {
  const { text: uiText } = useLanguage();

  const [stage, setStage] = useState<"condition" | "signature">("condition");
  const [damageByInventory, setDamageByInventory] = useState<DamageDraft>({});
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPending, onClose]);

  useEffect(() => {
    if (stage !== "signature") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.max(Math.round(rect.width * ratio), 1);
    canvas.height = Math.max(Math.round(rect.height * ratio), 1);
    const context = canvas.getContext("2d");
    context?.scale(ratio, ratio);
    if (context) {
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 2.5;
      context.strokeStyle = "#173f6b";
    }
  }, [stage]);

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  function validateAndContinue() {
    const invalid = inventories.find((inventory) => {
      const damaged = damageByInventory[inventory.id] ?? 0;
      return (
        !Number.isInteger(damaged) ||
        damaged < 0 ||
        damaged > inventory.good_quantity
      );
    });
    if (invalid) {
      setNotice({
        ok: false,
        message: `Số lượng hư mới của ${invalid.catalog?.item_name ?? "thiết bị"} phải từ 0 đến ${invalid.good_quantity}.`,
      });
      return;
    }
    setNotice(null);
    setStage("signature");
  }

  function submitConfirmation(signatureData: string) {
    startTransition(async () => {
      const result = await confirmBasicMedicalSession({
        sessionId: session.id,
        signatureData,
        checks: inventories.map((inventory) => ({
          inventoryId: inventory.id,
          newlyDamagedQuantity: damageByInventory[inventory.id] ?? 0,
          expectedCatalogItemId: inventory.catalog_item_id,
          expectedTotalQuantity: inventory.total_quantity,
          expectedGoodQuantity: inventory.good_quantity,
          expectedDamagedQuantity: inventory.damaged_quantity,
          expectedItemName: inventory.catalog?.item_name ?? "",
          expectedCommercialName: inventory.catalog?.commercial_name ?? null,
          expectedUnit: inventory.catalog?.unit ?? "",
        })),
      });
      if (!result.ok || !result.confirmationId || !result.signedAt) {
        setNotice({ ok: false, message: result.message });
        return;
      }
      onConfirmed({ id: result.confirmationId, signed_at: result.signedAt });
      onClose();
    });
  }

  const room = registration.rooms;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="equipment-modal-layer signature-modal-layer"
      role="presentation"
    >
      <button
        type="button"
        className="equipment-modal-backdrop"
        aria-label={uiText("Đóng cửa sổ xác nhận")}
        onClick={() => !isPending && onClose()}
      />
      <section
        className="equipment-modal basic-medical-confirmation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="basic-medical-confirmation-title"
      >
        <header className="equipment-modal-header">
          <div>
            <span>{uiText("Xác nhận buổi học Y cơ sở")}</span>
            <h2 id="basic-medical-confirmation-title">
              {registration.courses?.course_code} · {session.lesson_title}
            </h2>
            <p>
              {formatDate(session.class_schedules?.schedule_date)} ·{" "}
              {formatTime(session.class_schedules?.start_time)}–
              {formatTime(session.class_schedules?.end_time)} ·{" "}
              {room?.room_code}.{room?.building_code}
            </p>
          </div>
          <button
            type="button"
            className="equipment-modal-close"
            disabled={isPending}
            aria-label={uiText("Đóng cửa sổ xác nhận")}
            onClick={onClose}
          >
            {uiText("×")}
          </button>
        </header>
        <div className="equipment-modal-body">
          {notice ? (
            <p
              className={notice.ok ? "form-success" : "form-error"}
              role="status"
            >
              <LocalizedText text={notice.message ?? ""} />
            </p>
          ) : null}
          {stage === "condition" ? (
            <>
              <div className="basic-medical-condition-heading">
                <div>
                  <strong>
                    {uiText("Thay đổi tình trạng thiết bị phòng")}
                  </strong>
                  <p>
                    {uiText(
                      "Số lượng Hư là số hư mới phát hiện trong buổi học này.",
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={validateAndContinue}
                >
                  {uiText("Lưu tình trạng")}
                </button>
              </div>
              <div className="responsive-table">
                <table className="data-table basic-medical-condition-table">
                  <thead>
                    <tr>
                      <th>{uiText("STT")}</th>
                      <th>{uiText("Tên thiết bị và vật tư")}</th>
                      <th>{uiText("Tên thương mại")}</th>
                      <th>{uiText("ĐVT")}</th>
                      <th>{uiText("Hiện có")}</th>
                      <th>{uiText("Tình trạng")}</th>
                      <th>{uiText("Số lượng hư mới")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventories.map((inventory, index) => {
                      const damaged = damageByInventory[inventory.id] ?? 0;
                      const isDamaged = damaged > 0;
                      return (
                        <tr key={inventory.id}>
                          <td>{index + 1}</td>
                          <td>
                            <strong>{inventory.catalog?.item_name}</strong>
                          </td>
                          <td>{inventory.catalog?.commercial_name || "—"}</td>
                          <td>{inventory.catalog?.unit || "—"}</td>
                          <td>
                            {inventory.good_quantity}
                            {uiText(" Tốt ·")} {inventory.damaged_quantity}
                            {uiText(" Hư")}
                          </td>
                          <td>
                            <label className="inline-choice">
                              <input
                                type="radio"
                                name={`condition-${inventory.id}`}
                                checked={!isDamaged}
                                onChange={() =>
                                  setDamageByInventory((current) => ({
                                    ...current,
                                    [inventory.id]: 0,
                                  }))
                                }
                              />
                              {uiText("Tốt")}
                            </label>
                            <label className="inline-choice">
                              <input
                                type="radio"
                                name={`condition-${inventory.id}`}
                                checked={isDamaged}
                                onChange={() =>
                                  setDamageByInventory((current) => ({
                                    ...current,
                                    [inventory.id]: 1,
                                  }))
                                }
                              />
                              {uiText("Hư")}
                            </label>
                          </td>
                          <td>
                            {isDamaged ? (
                              <input
                                aria-label={uiText("Số lượng hư mới của {0}", [
                                  inventory.catalog?.item_name ??
                                    uiText("thiết bị"),
                                ])}
                                type="number"
                                min="1"
                                max={inventory.good_quantity}
                                value={damaged}
                                onChange={(event) =>
                                  setDamageByInventory((current) => ({
                                    ...current,
                                    [inventory.id]: Number(event.target.value),
                                  }))
                                }
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!inventories.length ? (
                <p className="panel-empty">
                  {uiText(
                    "Phòng chưa có thiết bị trong danh mục. Bạn vẫn có thể tiếp tục ký xác nhận.",
                  )}
                </p>
              ) : null}
              <div className="signature-modal-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={onClose}
                >
                  {uiText("Hủy")}
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={validateAndContinue}
                >
                  {uiText("Lưu tình trạng và tiếp tục ký")}
                </button>
              </div>
            </>
          ) : (
            <div className="signature-modal-body basic-medical-signature-step">
              <p>
                {uiText(
                  "Ký trong khung để xác nhận buổi học và tình trạng thiết bị phòng.",
                )}
              </p>
              <button
                type="button"
                className="button button-secondary basic-medical-condition-trigger"
                disabled={isPending}
                onClick={() => setStage("condition")}
              >
                {uiText("Thay đổi tình trạng thiết bị phòng")}
              </button>
              <canvas
                ref={canvasRef}
                className="signature-canvas"
                aria-label={uiText("Khung vẽ chữ ký")}
                onPointerDown={(event) => {
                  event.preventDefault();
                  drawingRef.current = true;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const point = pointFromEvent(event);
                  const context = event.currentTarget.getContext("2d");
                  context?.beginPath();
                  context?.moveTo(point.x, point.y);
                }}
                onPointerMove={(event) => {
                  if (!drawingRef.current) return;
                  event.preventDefault();
                  const point = pointFromEvent(event);
                  const context = event.currentTarget.getContext("2d");
                  context?.lineTo(point.x, point.y);
                  context?.stroke();
                  setHasInk(true);
                }}
                onPointerUp={(event) => {
                  drawingRef.current = false;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  drawingRef.current = false;
                }}
              />
              <div className="signature-modal-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={isPending}
                  onClick={onClose}
                >
                  {uiText("Hủy")}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={isPending || !hasInk}
                  onClick={clearSignature}
                >
                  {uiText("Ký lại")}
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={isPending || !hasInk}
                  onClick={() => {
                    const signature = canvasRef.current?.toDataURL("image/png");
                    if (signature) submitConfirmation(signature);
                  }}
                >
                  {isPending ? uiText("Đang lưu…") : uiText("Ký và xác nhận")}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function SessionStatus({
  session,
  confirmation,
  historicalConfirmations,
  evidenceEnabled,
  viewerId,
  peopleById,
  now,
  onOpen,
}: {
  session: BasicMedicalRegistrationSessionItem;
  confirmation?: { id: string; signed_at: string };
  historicalConfirmations: BasicMedicalRegistrationSessionItem["confirmations"];
  evidenceEnabled: boolean;
  viewerId: string;
  peopleById?: Map<string, string>;
  now: number;
  onOpen: () => void;
}) {
  const { text: uiText } = useLanguage();

  if (confirmation) {
    return (
      <div className="basic-medical-session-status">
        <span className="request-status request-status-green">
          {uiText("Xác nhận")}
        </span>
        <small>
          {dateTimeFormatter.format(new Date(confirmation.signed_at))}
        </small>
        {evidenceEnabled ? (
          <>
            <Link
              className="button button-secondary basic-medical-confirm-button"
              href={`/basic-medical/registrations/confirmations/${confirmation.id}`}
            >
              {uiText("Xem bằng chứng")}
            </Link>
            {historicalConfirmations
              .filter(
                (historical) =>
                  historical.invalidated_at !== null &&
                  historical.id !== confirmation.id,
              )
              .map((historical) => (
                <Link
                  key={historical.id}
                  className="button button-secondary basic-medical-confirm-button"
                  href={`/basic-medical/registrations/confirmations/${historical.id}`}
                >
                  {uiText("Bằng chứng đã vô hiệu")}
                </Link>
              ))}
          </>
        ) : null}
      </div>
    );
  }
  const invalidatedConfirmations = historicalConfirmations.filter(
    (historical) => historical.invalidated_at !== null,
  );
  if (invalidatedConfirmations.length) {
    return (
      <div className="basic-medical-session-status">
        <span className="request-status request-status-gray">
          {uiText("Xác nhận đã vô hiệu")}
        </span>
        {evidenceEnabled
          ? invalidatedConfirmations.map((historical) => (
              <Link
                key={historical.id}
                className="button button-secondary basic-medical-confirm-button"
                href={`/basic-medical/registrations/confirmations/${historical.id}`}
              >
                {uiText("Xem bằng chứng")}
              </Link>
            ))
          : null}
      </div>
    );
  }
  const isCancelled = Boolean(
    session.cancelled_at ||
    session.class_schedules?.schedule_status === "cancelled",
  );
  if (isCancelled) {
    const cancellerName =
      (session.cancelled_by ? peopleById?.get(session.cancelled_by) : null) ??
      "Người dùng";
    return (
      <div className="basic-medical-session-status">
        <span className="request-status request-status-gray">
          {uiText("Đã hủy")}
        </span>
        {session.cancellation_reason ? (
          <div className="basic-medical-session-cancellation-metadata">
            <div>
              <span className="cancellation-meta-label">
                {uiText("Người hủy lớp:")}
              </span>{" "}
              <strong>{cancellerName}</strong>
            </div>
            <div>
              <span className="cancellation-meta-label">
                {uiText("Lý do hủy:")}
              </span>{" "}
              <span>{session.cancellation_reason}</span>
            </div>
          </div>
        ) : null}
      </div>
    );
  }
  const isTeachingLecturer = session.teaching_lecturer_id === viewerId;
  const earliest = earliestConfirmationDate(session);
  const tooEarly = isBasicMedicalConfirmationTooEarly(
    earliest?.getTime() ?? null,
    now,
  );
  if (!isTeachingLecturer) {
    return (
      <span className="request-status request-status-red">
        {uiText("Chưa xác nhận")}
      </span>
    );
  }
  return (
    <div className="basic-medical-session-status">
      <button
        type="button"
        className="button button-secondary basic-medical-confirm-button"
        disabled={tooEarly}
        onClick={onOpen}
      >
        {uiText("Xác nhận")}
      </button>
      {tooEarly && earliest ? (
        <small>
          {uiText("Từ ")}
          {dateTimeFormatter.format(earliest)}
        </small>
      ) : null}
    </div>
  );
}

function SessionLecturerCell({
  session,
  instructors,
  peopleById,
  isEditing,
  selectedLecturerId,
  onLecturerChange,
  isSaving,
}: {
  session: BasicMedicalRegistrationSessionItem;
  instructors: BasicMedicalInstructorOption[];
  peopleById?: Map<string, string>;
  isEditing: boolean;
  selectedLecturerId: string;
  onLecturerChange: (lecturerId: string) => void;
  isSaving: boolean;
}) {
  const { text: uiText } = useLanguage();

  if (!isEditing) {
    const displayName =
      instructors.find(
        (instructor) => instructor.id === session.teaching_lecturer_id,
      )?.full_name ??
      peopleById?.get(session.teaching_lecturer_id) ??
      session.teaching?.full_name ??
      "—";
    return <td>{displayName}</td>;
  }

  return (
    <td>
      <div className="basic-medical-session-lecturer-cell">
        <select
          className="form-select basic-medical-lecturer-select"
          value={selectedLecturerId}
          onChange={(event) => onLecturerChange(event.target.value)}
          disabled={isSaving}
          aria-label={uiText("Giảng viên giảng dạy/hướng dẫn")}
        >
          {instructors.map((instructor) => (
            <option key={instructor.id} value={instructor.id}>
              {instructor.title
                ? `${instructor.title} ${instructor.full_name}`
                : instructor.full_name}
            </option>
          ))}
        </select>
      </div>
    </td>
  );
}

function SessionAdministrativeActions({
  session,
  confirmation,
  registration,
  viewerId,
  isAdmin = false,
}: {
  session: BasicMedicalRegistrationSessionItem;
  confirmation?: BasicMedicalSessionConfirmation;
  registration: BasicMedicalRegistrationListItem;
  viewerId: string;
  isAdmin?: boolean;
}) {
  const { text: uiText } = useLanguage();

  const [invalidateOpen, setInvalidateOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [isPending, startTransition] = useTransition();

  if (
    session.cancelled_at ||
    session.class_schedules?.schedule_status === "cancelled"
  ) {
    return null;
  }

  const canCancelSession =
    isAdmin ||
    registration.created_by === viewerId ||
    session.teaching_lecturer_id === viewerId;

  if (!confirmation) {
    if (!canCancelSession) return null;
    const formId = `cancel-session-${session.id}`;
    return (
      <>
        <form id={formId} action={cancelBasicMedicalSession}>
          <input type="hidden" name="session_id" value={session.id} />
        </form>
        <button
          type="button"
          className="button button-danger basic-medical-confirm-button"
          onClick={() => setCancelOpen(true)}
        >
          {uiText("Hủy lớp")}
        </button>
        <ConfirmDialog
          open={cancelOpen}
          title={uiText("Hủy buổi học Y cơ sở?")}
          description={uiText(
            "Chỉ hủy đúng buổi đã chọn; các buổi khác của Phiếu Y cơ sở không thay đổi.",
          )}
          confirmLabel={uiText("Hủy buổi học")}
          pending={isPending}
          onCancel={() => setCancelOpen(false)}
          onConfirm={() => {
            if (!cancellationReason.trim()) return;
            startTransition(() => {
              const form = document.getElementById(
                formId,
              ) as HTMLFormElement | null;
              if (!form) return;
              const input = document.createElement("input");
              input.type = "hidden";
              input.name = "reason";
              input.value = cancellationReason.trim();
              form.append(input);
              form.requestSubmit();
            });
          }}
        >
          <label className="form-field">
            <span>{uiText("Lý do hủy buổi học *")}</span>
            <input
              value={cancellationReason}
              required
              onChange={(event) => setCancellationReason(event.target.value)}
              placeholder={uiText("Nhập lý do bắt buộc")}
            />
          </label>
        </ConfirmDialog>
      </>
    );
  }
  if (!isAdmin) return null;

  const formId = `invalidate-confirmation-${confirmation.id}`;
  return (
    <>
      <form id={formId} action={invalidateBasicMedicalSessionConfirmation}>
        <input type="hidden" name="confirmation_id" value={confirmation.id} />
      </form>
      <button
        type="button"
        className="button button-warning basic-medical-confirm-button"
        disabled={isPending}
        onClick={() => setInvalidateOpen(true)}
      >
        {uiText("Vô hiệu hóa xác nhận")}
      </button>
      <ConfirmDialog
        open={invalidateOpen}
        title={uiText("Vô hiệu hóa xác nhận buổi học?")}
        description={uiText(
          "{0} · {1} | {2} · {3}–{4} | {5} {6}{7} | Giảng viên buổi học: {8} · Xác nhận lúc {9}. Chữ ký và bằng chứng gốc sẽ được giữ nguyên.",
          [
            registration.courses?.course_code ?? uiText("Môn học"),
            registration.courses?.course_name ?? "",
            formatDate(session.class_schedules?.schedule_date),
            formatTime(session.class_schedules?.start_time),
            formatTime(session.class_schedules?.end_time),
            registration.rooms?.building_code ?? "",
            registration.rooms?.room_code ?? "",
            registration.rooms?.room_name
              ? ` – ${registration.rooms.room_name}`
              : "",
            session.teaching?.full_name ?? uiText("Không xác định"),
            dateTimeFormatter.format(new Date(confirmation.signed_at)),
          ],
        )}
        confirmLabel={uiText("Vô hiệu hóa")}
        pending={isPending}
        onCancel={() => setInvalidateOpen(false)}
        onConfirm={() => {
          if (!reason.trim()) return;
          startTransition(() => {
            const form = document.getElementById(
              formId,
            ) as HTMLFormElement | null;
            if (!form) return;
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = "reason";
            input.value = reason.trim();
            form.append(input);
            form.requestSubmit();
          });
        }}
      >
        <label className="form-field">
          <span>{uiText("Lý do vô hiệu hóa *")}</span>
          <input
            value={reason}
            required
            onChange={(event) => setReason(event.target.value)}
            placeholder={uiText("Nhập lý do bắt buộc")}
          />
        </label>
      </ConfirmDialog>
    </>
  );
}

export function BasicMedicalRegistrationList({
  registrations,
  inventories,
  instructors = [],
  activePeople = [],
  viewerId,
  isAdmin = false,
  canDelete,
  evidenceEnabled,
  canManageBasicMedical,
  equipmentRequestsBySession,
  today,
}: {
  registrations: BasicMedicalRegistrationListItem[];
  inventories: BasicMedicalRoomInventoryItem[];
  instructors?: BasicMedicalInstructorOption[];
  activePeople?: Array<{ id: string; full_name: string; title: string | null }>;
  viewerId: string;
  isAdmin?: boolean;
  canDelete: boolean;
  evidenceEnabled: boolean;
  canManageBasicMedical: boolean;
  equipmentRequestsBySession: Record<string, EquipmentRequestListItem>;
  today: string;
}) {
  const { text: uiText } = useLanguage();

  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [confirmationNow, setConfirmationNow] = useState(() => Date.now());
  const [confirmationBySession, setConfirmationBySession] = useState(() => {
    const entries = registrations.flatMap((registration) =>
      registration.basic_medical_registration_sessions.flatMap((session) => {
        const confirmation = activeSessionConfirmation(session);
        return confirmation ? [[session.id, confirmation] as const] : [];
      }),
    );
    return new Map(entries);
  });
  const [active, setActive] = useState<{
    registration: BasicMedicalRegistrationListItem;
    session: BasicMedicalRegistrationSessionItem;
  } | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [selectedLecturerId, setSelectedLecturerId] = useState<string>("");
  const [isSavingLecturer, startSavingTransition] = useTransition();
  const peopleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of activePeople) {
      if (person.id && person.full_name) map.set(person.id, person.full_name);
    }
    for (const instructor of instructors) {
      if (instructor.id && instructor.full_name) {
        map.set(instructor.id, instructor.full_name);
      }
    }
    return map;
  }, [activePeople, instructors]);

  function handleStartEditLecturer(
    session: BasicMedicalRegistrationSessionItem,
  ) {
    setEditingSessionId(session.id);
    setSelectedLecturerId(
      session.teaching_lecturer_id || (instructors[0]?.id ?? ""),
    );
  }

  function handleCancelEditLecturer() {
    setEditingSessionId(null);
    setSelectedLecturerId("");
  }

  function handleSaveLecturer(session: BasicMedicalRegistrationSessionItem) {
    if (!selectedLecturerId) return;
    if (selectedLecturerId === session.teaching_lecturer_id) {
      setEditingSessionId(null);
      return;
    }
    startSavingTransition(() => {
      const form = document.getElementById(
        `change-lecturer-${session.id}`,
      ) as HTMLFormElement | null;
      if (!form) return;
      form.requestSubmit();
    });
  }

  const inventoriesByRoom = useMemo(() => {
    const map = new Map<string, BasicMedicalRoomInventoryItem[]>();
    for (const inventory of inventories) {
      map.set(inventory.room_id, [
        ...(map.get(inventory.room_id) ?? []),
        inventory,
      ]);
    }
    return map;
  }, [inventories]);

  useEffect(() => {
    const nextEligibilityAt = registrations
      .flatMap(
        (registration) => registration.basic_medical_registration_sessions,
      )
      .filter(
        (session) => session.class_schedules?.schedule_status !== "cancelled",
      )
      .map((session) => earliestConfirmationDate(session)?.getTime() ?? null)
      .filter(
        (value): value is number => value !== null && value > confirmationNow,
      )
      .reduce<number | null>(
        (earliest, value) =>
          earliest === null || value < earliest ? value : earliest,
        null,
      );
    const timerLifecycle = createBasicMedicalConfirmationTimerLifecycle({
      setTimer: window.setTimeout,
      clearTimer: window.clearTimeout,
      onWake: () => setConfirmationNow(Date.now()),
    });
    timerLifecycle.update({
      eligibilityAt: nextEligibilityAt,
      now: Date.now(),
    });
    return timerLifecycle.dispose;
  }, [confirmationNow, registrations]);

  return (
    <>
      <div className="equipment-request-list-panel data-panel basic-medical-registration-panel">
        <div className="responsive-table">
          <table className="data-table equipment-request-table basic-medical-registration-table">
            <colgroup>
              <col className="basic-medical-registration-col-course" />
              <col className="basic-medical-registration-col-period" />
              <col className="basic-medical-registration-col-room" />
              <col className="basic-medical-registration-col-sessions" />
              <col className="basic-medical-registration-col-status" />
            </colgroup>
            <thead>
              <tr>
                <th>{uiText("Môn học")}</th>
                <th>{uiText("Thời gian đăng ký")}</th>
                <th>{uiText("Phòng")}</th>
                <th>{uiText("Số buổi")}</th>
                <th>{uiText("Trạng thái")}</th>
              </tr>
            </thead>
            {registrations.map((registration) => {
              const sessions = [
                ...registration.basic_medical_registration_sessions,
              ].sort((a, b) => a.session_number - b.session_number);
              const isCompleted =
                sessions.length > 0 &&
                sessions.every((session) =>
                  confirmationBySession.has(session.id),
                );
              const isCancelled = Boolean(registration.cancelled_at);
              const isOpen = expanded.has(registration.id);
              const toggleRegistration = () =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(registration.id)) next.delete(registration.id);
                  else next.add(registration.id);
                  return next;
                });
              return (
                <tbody key={registration.id}>
                  <tr
                    className="equipment-request-table-row"
                    onClick={toggleRegistration}
                  >
                    <td>
                      <button
                        type="button"
                        className="equipment-request-course-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleRegistration();
                        }}
                      >
                        <strong>{registration.courses?.course_code}</strong>
                        <span>{registration.courses?.course_name}</span>
                      </button>
                    </td>
                    <td className="equipment-request-date-cell">
                      <strong>
                        {formatDate(registration.start_date)}–
                        {formatDate(registration.end_date)}
                      </strong>
                      <span>
                        {registration.semester} · {registration.academic_year}
                      </span>
                    </td>
                    <td className="equipment-request-room-cell">
                      <strong>
                        {registration.rooms?.room_code}.
                        {registration.rooms?.building_code}
                      </strong>
                      <span>{registration.rooms?.room_name || "—"}</span>
                    </td>
                    <td>{sessions.length}</td>
                    <td className="basic-medical-registration-status-cell">
                      <div className="basic-medical-registration-status-control">
                        <span
                          className={`request-status request-status-${isCancelled ? "gray" : isCompleted ? "green" : "red"}`}
                        >
                          {isCancelled
                            ? uiText("Đã hủy")
                            : isCompleted
                              ? uiText("Hoàn thành")
                              : uiText("Chưa hoàn thành")}
                        </span>
                        <button
                          type="button"
                          className={`equipment-request-chevron${isOpen ? " is-open" : ""}`}
                          aria-label={
                            isOpen
                              ? uiText("Thu gọn phiếu")
                              : uiText("Mở phiếu")
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleRegistration();
                          }}
                        >
                          ⌄
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="equipment-request-detail-row">
                      <td colSpan={5}>
                        <div className="equipment-request-details">
                          <div className="equipment-request-detail-grid basic-medical-registration-detail-grid">
                            <div className="basic-medical-registration-detail-code">
                              <span>{uiText("Mã phiếu")}</span>
                              <strong className="mono">
                                {formatBasicMedicalRegistrationCode(
                                  registration.registration_code,
                                )}
                              </strong>
                            </div>
                            <div className="basic-medical-registration-detail-registrant">
                              <span>{uiText("Người đăng ký")}</span>
                              <strong>
                                {registration.registrant?.full_name}
                              </strong>
                            </div>
                            <div className="basic-medical-registration-detail-responsible">
                              <span>{uiText("Giảng viên phụ trách")}</span>
                              <strong>
                                {registration.responsible?.full_name}
                              </strong>
                            </div>
                            <div className="basic-medical-registration-detail-student-count">
                              <span>{uiText("Số sinh viên")}</span>
                              <strong>{registration.student_count}</strong>
                            </div>
                            <div className="basic-medical-registration-detail-note">
                              <span>{uiText("Ghi chú")}</span>
                              <strong>
                                {registration.note ||
                                  uiText("Không có ghi chú")}
                              </strong>
                            </div>
                            {canDelete && !isCancelled ? (
                              <div className="basic-medical-registration-detail-action">
                                <form action={cancelBasicMedicalRegistration}>
                                  <input
                                    type="hidden"
                                    name="id"
                                    value={registration.id}
                                  />
                                  <ConfirmSubmitButton
                                    className="button button-danger"
                                    message={uiText(
                                      "Hủy phiếu {0}? Các lịch tương lai sẽ chuyển sang Đã hủy. Dữ liệu và lịch sử đã có được giữ lại.",
                                      [
                                        registration.courses?.course_code ??
                                          uiText("Y cơ sở"),
                                      ],
                                    )}
                                  >
                                    <Trash2 size={17} aria-hidden="true" />
                                    {uiText(" Hủy phiếu")}
                                  </ConfirmSubmitButton>
                                </form>
                              </div>
                            ) : null}
                            {isCancelled ? (
                              <div className="basic-medical-registration-detail-history">
                                <div>
                                  <span>{uiText("Thời điểm hủy")}</span>
                                  <strong>
                                    {dateTimeFormatter.format(
                                      new Date(registration.cancelled_at ?? ""),
                                    )}
                                  </strong>
                                </div>
                                <div>
                                  <span>{uiText("Lý do hủy")}</span>
                                  <strong>
                                    {registration.cancel_reason ||
                                      uiText("Không có lý do")}
                                  </strong>
                                </div>
                              </div>
                            ) : null}
                            {!isCancelled &&
                              sessions
                                .filter(
                                  (s) =>
                                    s.class_schedules?.schedule_status ===
                                      "cancelled" || Boolean(s.cancelled_at),
                                )
                                .map((s) => {
                                  const sCancellerName =
                                    (s.cancelled_by
                                      ? peopleById.get(s.cancelled_by)
                                      : null) ?? uiText("Người dùng");
                                  return (
                                    <div
                                      key={`cancelled-session-${s.id}`}
                                      className="basic-medical-registration-detail-session-cancellation"
                                    >
                                      <div className="basic-medical-session-cancel-track-1">
                                        <span>{uiText("Buổi học")}</span>
                                        <strong>
                                          {uiText("Buổi ")}
                                          {s.session_number}
                                        </strong>
                                      </div>
                                      <div className="basic-medical-session-cancel-track-2">
                                        <span>{uiText("Người hủy lớp")}</span>
                                        <strong>{sCancellerName}</strong>
                                      </div>
                                      <div className="basic-medical-session-cancel-track-3">
                                        <span>{uiText("Lý do hủy")}</span>
                                        <strong>
                                          {s.cancellation_reason ||
                                            uiText("Không có lý do")}
                                        </strong>
                                      </div>
                                    </div>
                                  );
                                })}
                          </div>
                          <div className="responsive-table basic-medical-session-viewport">
                            <table className="data-table basic-medical-session-table">
                              <colgroup>
                                <col className="basic-medical-session-col-index" />
                                <col className="basic-medical-session-col-date" />
                                <col className="basic-medical-session-col-time" />
                                <col className="basic-medical-session-col-lesson" />
                                <col className="basic-medical-session-col-lecturer" />
                                <col className="basic-medical-session-col-status" />
                              </colgroup>
                              <thead>
                                <tr>
                                  <th>#</th>
                                  <th>{uiText("Ngày")}</th>
                                  <th>{uiText("Thời gian")}</th>
                                  <th>{uiText("Tên bài TN-TH")}</th>
                                  <th>
                                    {uiText("Giảng viên giảng dạy/hướng dẫn")}
                                  </th>
                                  <th>{uiText("Trạng thái / Thao tác")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sessions.map((session) => {
                                  const confirmation =
                                    confirmationBySession.get(session.id);
                                  const isEditing =
                                    editingSessionId === session.id;
                                  const isSessionCancelled =
                                    session.class_schedules?.schedule_status ===
                                      "cancelled" ||
                                    Boolean(session.cancelled_at);
                                  const canEditLecturer =
                                    !isCancelled &&
                                    !isSessionCancelled &&
                                    (isAdmin ||
                                      registration.created_by === viewerId) &&
                                    instructors.length > 0;
                                  const equipmentRequest =
                                    equipmentRequestsBySession[session.id];
                                  const sessionCanCreateEquipment = Boolean(
                                    session.class_schedules?.schedule_date &&
                                    session.class_schedules.schedule_date >=
                                      today,
                                  );
                                  const canCreateEquipmentRequest =
                                    !isCancelled &&
                                    !isSessionCancelled &&
                                    sessionCanCreateEquipment &&
                                    !equipmentRequest &&
                                    (canManageBasicMedical ||
                                      registration.created_by === viewerId ||
                                      registration.registrant_id === viewerId ||
                                      session.teaching_lecturer_id ===
                                        viewerId);

                                  return (
                                    <tr key={session.id}>
                                      <td>{session.session_number}</td>
                                      <td>
                                        {formatDate(
                                          session.class_schedules
                                            ?.schedule_date,
                                        )}
                                      </td>
                                      <td>
                                        {formatTime(
                                          session.class_schedules?.start_time,
                                        )}
                                        –
                                        {formatTime(
                                          session.class_schedules?.end_time,
                                        )}
                                      </td>
                                      <td>{session.lesson_title}</td>
                                      <SessionLecturerCell
                                        session={session}
                                        instructors={instructors}
                                        peopleById={peopleById}
                                        isEditing={isEditing}
                                        selectedLecturerId={selectedLecturerId}
                                        onLecturerChange={setSelectedLecturerId}
                                        isSaving={isSavingLecturer}
                                      />
                                      <td className="basic-medical-session-action-cell">
                                        <div className="basic-medical-session-action-stack">
                                          <div className="basic-medical-session-status-row">
                                            <SessionStatus
                                              session={session}
                                              confirmation={confirmation}
                                              historicalConfirmations={
                                                session.confirmations
                                              }
                                              evidenceEnabled={evidenceEnabled}
                                              viewerId={viewerId}
                                              peopleById={peopleById}
                                              now={confirmationNow}
                                              onOpen={() =>
                                                setActive({
                                                  registration,
                                                  session,
                                                })
                                              }
                                            />
                                            {canEditLecturer ? (
                                              isEditing ? (
                                                <div className="basic-medical-session-lecturer-actions">
                                                  <form
                                                    id={`change-lecturer-${session.id}`}
                                                    action={
                                                      updateBasicMedicalSessionTeachingLecturer
                                                    }
                                                  >
                                                    <input
                                                      type="hidden"
                                                      name="session_id"
                                                      value={session.id}
                                                    />
                                                    <input
                                                      type="hidden"
                                                      name="teaching_lecturer_id"
                                                      value={selectedLecturerId}
                                                    />
                                                  </form>
                                                  <button
                                                    type="button"
                                                    className="button button-primary basic-medical-lecturer-save-button"
                                                    disabled={isSavingLecturer}
                                                    onClick={() =>
                                                      handleSaveLecturer(
                                                        session,
                                                      )
                                                    }
                                                  >
                                                    {isSavingLecturer
                                                      ? uiText("Đang lưu…")
                                                      : uiText("Lưu")}
                                                  </button>
                                                  <button
                                                    type="button"
                                                    className="button button-secondary basic-medical-lecturer-cancel-button"
                                                    disabled={isSavingLecturer}
                                                    onClick={
                                                      handleCancelEditLecturer
                                                    }
                                                  >
                                                    {uiText("Hủy")}
                                                  </button>
                                                </div>
                                              ) : (
                                                <div className="basic-medical-session-lecturer-actions">
                                                  <button
                                                    type="button"
                                                    className="button button-secondary basic-medical-lecturer-edit-button"
                                                    onClick={() =>
                                                      handleStartEditLecturer(
                                                        session,
                                                      )
                                                    }
                                                  >
                                                    {uiText("Sửa")}
                                                  </button>
                                                </div>
                                              )
                                            ) : null}
                                          </div>
                                          <SessionAdministrativeActions
                                            session={session}
                                            confirmation={confirmation}
                                            registration={registration}
                                            viewerId={viewerId}
                                            isAdmin={isAdmin}
                                          />
                                          {equipmentRequest ? (
                                            equipmentRequest.status ===
                                            "cancelled" ? (
                                              <div className="basic-medical-equipment-request-actions">
                                                <span className="request-status request-status-red">
                                                  {uiText(
                                                    "Phiếu thiết bị đã hủy",
                                                  )}
                                                </span>
                                                <Link
                                                  className="button button-secondary"
                                                  href={`/basic-medical/equipment-requests?session=${session.id}`}
                                                >
                                                  {uiText("Xem phiếu thiết bị")}
                                                </Link>
                                              </div>
                                            ) : (
                                              <div className="basic-medical-equipment-request-actions">
                                                <span
                                                  className={`request-status request-status-${equipmentStatusMeta(equipmentRequest.status).color}`}
                                                >
                                                  {
                                                    equipmentStatusMeta(
                                                      equipmentRequest.status,
                                                    ).label
                                                  }
                                                </span>
                                                <Link
                                                  className="button button-secondary"
                                                  href={`/basic-medical/equipment-requests?session=${session.id}`}
                                                >
                                                  {uiText("Xem phiếu thiết bị")}
                                                </Link>
                                              </div>
                                            )
                                          ) : canCreateEquipmentRequest ? (
                                            <Link
                                              className="button button-primary"
                                              href={`/basic-medical/equipment-requests?session=${session.id}`}
                                            >
                                              {uiText("Đăng ký thiết bị")}
                                            </Link>
                                          ) : null}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
          </table>
        </div>
        {!registrations.length ? (
          <p className="panel-empty">
            {uiText("Không có phiếu phù hợp với bộ lọc hiện tại.")}
          </p>
        ) : null}
      </div>
      {active ? (
        <BasicMedicalConfirmationModal
          registration={active.registration}
          session={active.session}
          inventories={
            inventoriesByRoom.get(active.registration.rooms?.id ?? "") ?? []
          }
          onClose={() => setActive(null)}
          onConfirmed={(confirmation) => {
            setConfirmationBySession((current) =>
              new Map(current).set(active.session.id, {
                ...confirmation,
                signer_id: viewerId,
                invalidated_at: null,
                invalidated_reason: null,
              }),
            );
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
