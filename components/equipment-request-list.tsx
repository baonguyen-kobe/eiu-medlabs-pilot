"use client";

import Link from "next/link";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import {
  addEquipmentRequestItem,
  confirmEquipmentRequestHandoff,
  deleteEquipmentRequest,
  reviewLateEquipmentRequest,
  updateEquipmentRequestStatus,
} from "@/app/equipment/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EquipmentRequestLifecycleHistory } from "@/components/equipment-request-lifecycle-history";
import { Download, Search, Trash2 } from "@/components/icons";
import { PaginationControls } from "@/components/pagination-controls";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { formatEquipmentRequestCode } from "@/lib/equipment-request-code";
import {
  canAddEquipmentRequestItems,
  equipmentRequestStatuses,
  equipmentRequestWorkflowStatuses,
  equipmentStatusMeta,
  usesInventoryFulfillment,
  type EquipmentCatalogListItem,
  type EquipmentConfirmationState,
  type EquipmentLateApprovalStatus,
  type EquipmentRequestDomain,
  type EquipmentRequestListItem,
  type EquipmentRequestStatus,
  type EquipmentRequestWorkflowStatus,
} from "@/lib/equipment-requests";
import { equipmentRequestTargetPage } from "@/lib/equipment-calendar-request";
import { TABLE_PAGE_SIZE, totalPagesFor } from "@/lib/pagination";
import type { AppRole } from "@/lib/viewer";

const EARLY_HANDOVER_ADMIN_EMAILS = new Set([
  "admin@campus.local",
  "bao.nguyen@eiu.edu.vn",
]);

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Ho_Chi_Minh",
});

function formatScheduleDate(date?: string) {
  return date ? date.split("-").reverse().join("/") : "—";
}

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

function catalogForRequest(
  request: EquipmentRequestListItem,
  item: EquipmentRequestListItem["equipment_request_items"][number],
) {
  return request.request_domain === "basic_medical"
    ? item.basic_medical_equipment_catalog
    : item.equipment_catalog;
}

function domainLabel(request: EquipmentRequestListItem) {
  return request.request_domain === "basic_medical"
    ? "Y cơ sở"
    : "Kỹ năng Điều dưỡng";
}

function StatusBadge({ status }: { status: EquipmentRequestStatus }) {
  const meta = equipmentStatusMeta(status);
  return (
    <span className={`request-status request-status-${meta.color}`}>
      {meta.label}
    </span>
  );
}

function getWarehouseStatus(
  status: EquipmentRequestStatus,
  confirmation?: EquipmentConfirmationState,
): EquipmentRequestStatus {
  if (status === "cancelled") {
    return "cancelled";
  }

  if (
    status === "completed" ||
    (confirmation?.return_staff_confirmed_at &&
      confirmation.return_recipient_signed_at)
  ) {
    return "completed";
  }
  if (confirmation?.return_staff_confirmed_at || status === "returned") {
    return "returned";
  }
  if (confirmation?.handover_staff_confirmed_at || status === "handed_over") {
    return "handed_over";
  }
  return status;
}

type EquipmentItemDraft = {
  key: number;
  itemName: string;
  catalogId: string;
  quantity: number;
  note: string;
};

function EquipmentItemsModal({
  request,
  catalog,
  canAddItems,
  onClose,
}: {
  request: EquipmentRequestListItem;
  catalog: EquipmentCatalogListItem[];
  canAddItems: boolean;
  onClose: () => void;
}) {
  const [localItems, setLocalItems] = useState(request.equipment_request_items);
  const canAddItemsForRequest =
    canAddItems && request.request_domain === "nursing_skills";
  const nextDraftKey = useRef(1);
  const [draftsBySkill, setDraftsBySkill] = useState<
    Record<string, EquipmentItemDraft[]>
  >({});
  const [notice, setNotice] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [isAdding, startAdding] = useTransition();
  const catalogById = useMemo(
    () => new Map(catalog.map((item) => [item.id, item])),
    [catalog],
  );
  const itemNameOptions = useMemo(
    () =>
      [...new Set(catalog.map((item) => item.item_name))].map((itemName) => ({
        value: itemName,
        label: itemName,
        keywords: catalog
          .filter((item) => item.item_name === itemName)
          .map((item) => item.commercial_name ?? "")
          .join(" "),
      })),
    [catalog],
  );
  const groupedItems = useMemo(() => {
    const groups = new Map<
      string,
      EquipmentRequestListItem["equipment_request_items"]
    >();
    for (const item of localItems) {
      groups.set(item.skill_name, [
        ...(groups.get(item.skill_name) ?? []),
        item,
      ]);
    }
    return [...groups.entries()];
  }, [localItems]);

  function commercialOptionsFor(itemName: string) {
    return catalog
      .filter((item) => !itemName || item.item_name === itemName)
      .map((item) => ({
        value: item.id,
        label: item.commercial_name || item.item_name,
        keywords: [item.item_name, item.model, item.manufacturer]
          .filter(Boolean)
          .join(" "),
      }));
  }

  function addDraft(skillName: string) {
    const draft: EquipmentItemDraft = {
      key: nextDraftKey.current++,
      itemName: "",
      catalogId: "",
      quantity: 1,
      note: "",
    };
    setDraftsBySkill((current) => ({
      ...current,
      [skillName]: [...(current[skillName] ?? []), draft],
    }));
    setNotice(null);
  }

  function updateDraft(
    skillName: string,
    key: number,
    patch: Partial<EquipmentItemDraft>,
  ) {
    setDraftsBySkill((current) => ({
      ...current,
      [skillName]: (current[skillName] ?? []).map((draft) =>
        draft.key === key ? { ...draft, ...patch } : draft,
      ),
    }));
  }

  function clearDrafts(skillName: string) {
    setDraftsBySkill((current) => {
      const next = { ...current };
      delete next[skillName];
      return next;
    });
  }

  function selectDraftItemName(
    skillName: string,
    key: number,
    itemName: string,
  ) {
    const matches = catalog.filter((item) => item.item_name === itemName);
    updateDraft(skillName, key, {
      itemName,
      catalogId: matches.length === 1 ? matches[0].id : "",
    });
  }

  function selectDraftCommercial(
    skillName: string,
    key: number,
    catalogItemId: string,
  ) {
    const selected = catalogById.get(catalogItemId);
    updateDraft(skillName, key, {
      catalogId: catalogItemId,
      itemName: selected?.item_name ?? "",
    });
  }

  function saveAddedItems(skillName: string) {
    const drafts = draftsBySkill[skillName] ?? [];
    if (
      !drafts.length ||
      drafts.some(
        (draft) =>
          !draft.catalogId ||
          !Number.isInteger(draft.quantity) ||
          draft.quantity < 1,
      )
    ) {
      setNotice({
        ok: false,
        message:
          "Vui lòng chọn thiết bị và nhập số lượng hợp lệ cho tất cả các dòng.",
      });
      return;
    }
    startAdding(async () => {
      const results: Awaited<ReturnType<typeof addEquipmentRequestItem>>[] = [];
      for (const draft of drafts) {
        results.push(
          await addEquipmentRequestItem({
            requestId: request.id,
            skillName,
            catalogItemId: draft.catalogId,
            quantity: draft.quantity,
            note: draft.note,
          }),
        );
      }
      const addedItems = results.flatMap((result) =>
        result.ok && result.item ? [result.item] : [],
      );
      if (addedItems.length) {
        setLocalItems((current) => [...current, ...addedItems]);
      }
      if (addedItems.length === drafts.length) {
        clearDrafts(skillName);
        setNotice({
          ok: true,
          message: `Đã bổ sung ${addedItems.length} dòng thiết bị.`,
        });
        return;
      }
      const failedDrafts = drafts.filter((_, index) => !results[index]?.ok);
      setDraftsBySkill((current) => ({
        ...current,
        [skillName]: failedDrafts,
      }));
      setNotice({
        ok: false,
        message:
          results.find((result) => !result.ok)?.message ??
          "Có dòng thiết bị chưa thể lưu.",
      });
    });
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div className="equipment-modal-layer" role="presentation">
      <button
        type="button"
        className="equipment-modal-backdrop"
        aria-label="Đóng danh sách trang thiết bị"
        onClick={onClose}
      />
      <section
        className="equipment-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="equipment-modal-title"
      >
        <header className="equipment-modal-header">
          <div>
            <span>Danh sách trang thiết bị</span>
            <h2 id="equipment-modal-title">
              {request.class_schedules?.course_code_snapshot} ·{" "}
              {request.class_schedules?.course_name_snapshot}
            </h2>
            <p>
              {formatScheduleDate(request.class_schedules?.schedule_date)} ·{" "}
              {request.class_schedules?.rooms?.room_code}.
              {request.class_schedules?.rooms?.building_code}
            </p>
          </div>
          <button
            type="button"
            className="equipment-modal-close"
            aria-label="Đóng danh sách trang thiết bị"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="equipment-modal-body">
          {notice ? (
            <p
              className={notice.ok ? "form-success" : "form-error"}
              role="status"
            >
              {notice.message}
            </p>
          ) : null}
          {request.note ? (
            <div className="equipment-general-note">
              <strong>Ghi chú chung</strong>
              <p>{request.note}</p>
            </div>
          ) : null}
          {groupedItems.map(([skillName, items], skillIndex) => {
            const drafts = draftsBySkill[skillName] ?? [];
            return (
              <article className="equipment-modal-skill" key={skillName}>
                <h3>
                  {request.request_domain === "basic_medical"
                    ? `Bài TN-TH #${skillIndex + 1}: ${skillName}`
                    : `Kỹ năng/Bài thực hành #${skillIndex + 1}: ${skillName}`}
                </h3>
                <div className="responsive-table">
                  <table className="data-table equipment-detail-table">
                    <thead>
                      <tr>
                        <th>STT</th>
                        <th>Tên thiết bị và vật tư</th>
                        <th>Tên thương mại</th>
                        <th>Loại</th>
                        <th>Nước SX</th>
                        <th>Hãng</th>
                        <th>Model</th>
                        <th>ĐVT</th>
                        <th>Số lượng</th>
                        <th>Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, index) => (
                        <tr key={item.id}>
                          <td>{index + 1}</td>
                          <td>
                            <strong>
                              {catalogForRequest(request, item)?.item_name ||
                                "Danh mục thiết bị không còn khả dụng"}
                            </strong>
                          </td>
                          <td>
                            {catalogForRequest(request, item)
                              ?.commercial_name || "—"}
                          </td>
                          <td>
                            {catalogForRequest(request, item)?.item_type || "—"}
                          </td>
                          <td>
                            {catalogForRequest(request, item)
                              ?.country_of_origin || "—"}
                          </td>
                          <td>
                            {catalogForRequest(request, item)?.manufacturer ||
                              "—"}
                          </td>
                          <td>
                            {catalogForRequest(request, item)?.model || "—"}
                          </td>
                          <td>
                            {catalogForRequest(request, item)?.unit || "—"}
                          </td>
                          <td>{item.quantity}</td>
                          <td>{item.note || "—"}</td>
                        </tr>
                      ))}
                      {canAddItemsForRequest
                        ? drafts.map((draft, draftIndex) => {
                            const selectedDraftCatalog = catalogById.get(
                              draft.catalogId,
                            );
                            return (
                              <tr
                                className="equipment-modal-add-row"
                                key={draft.key}
                              >
                                <td>{items.length + draftIndex + 1}</td>
                                <td>
                                  <SearchableCombobox
                                    value={draft.itemName}
                                    options={itemNameOptions}
                                    onChange={(itemName) =>
                                      selectDraftItemName(
                                        skillName,
                                        draft.key,
                                        itemName,
                                      )
                                    }
                                    required
                                    ariaLabel={`Tên thiết bị bổ sung dòng ${draftIndex + 1} cho ${skillName}`}
                                    placeholder="Gõ hoặc chọn tên thiết bị…"
                                  />
                                </td>
                                <td>
                                  <SearchableCombobox
                                    value={draft.catalogId}
                                    options={commercialOptionsFor(
                                      draft.itemName,
                                    )}
                                    onChange={(catalogItemId) =>
                                      selectDraftCommercial(
                                        skillName,
                                        draft.key,
                                        catalogItemId,
                                      )
                                    }
                                    required
                                    ariaLabel={`Tên thương mại bổ sung dòng ${draftIndex + 1} cho ${skillName}`}
                                    placeholder="Gõ hoặc chọn tên thương mại…"
                                  />
                                </td>
                                <td>
                                  {selectedDraftCatalog?.item_type || "—"}
                                </td>
                                <td>
                                  {selectedDraftCatalog?.country_of_origin ||
                                    "—"}
                                </td>
                                <td>
                                  {selectedDraftCatalog?.manufacturer || "—"}
                                </td>
                                <td>{selectedDraftCatalog?.model || "—"}</td>
                                <td>{selectedDraftCatalog?.unit || "—"}</td>
                                <td>
                                  <input
                                    aria-label={`Số lượng bổ sung dòng ${draftIndex + 1} cho ${skillName}`}
                                    type="number"
                                    min="1"
                                    value={draft.quantity}
                                    onChange={(event) =>
                                      updateDraft(skillName, draft.key, {
                                        quantity: Number(event.target.value),
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    aria-label={`Ghi chú thiết bị bổ sung dòng ${draftIndex + 1} cho ${skillName}`}
                                    value={draft.note}
                                    onChange={(event) =>
                                      updateDraft(skillName, draft.key, {
                                        note: event.target.value,
                                      })
                                    }
                                    placeholder="Nếu có"
                                  />
                                </td>
                              </tr>
                            );
                          })
                        : null}
                    </tbody>
                  </table>
                </div>
                {canAddItemsForRequest ? (
                  <div className="equipment-modal-add-actions equipment-modal-add-actions-persistent">
                    <button
                      type="button"
                      className="button button-secondary equipment-modal-add-button"
                      disabled={isAdding}
                      onClick={() => addDraft(skillName)}
                    >
                      + Thêm dòng
                    </button>
                    {drafts.length ? (
                      <div className="equipment-modal-add-save-actions">
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={isAdding}
                          onClick={() => clearDrafts(skillName)}
                        >
                          Hủy
                        </button>
                        <button
                          type="button"
                          className="button button-primary"
                          disabled={
                            isAdding ||
                            drafts.some(
                              (draft) =>
                                !draft.catalogId ||
                                !Number.isInteger(draft.quantity) ||
                                draft.quantity < 1,
                            )
                          }
                          onClick={() => saveAddedItems(skillName)}
                        >
                          {isAdding
                            ? "Đang lưu…"
                            : `Lưu ${drafts.length} dòng thiết bị`}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
          {!groupedItems.length ? (
            <p className="panel-empty">Phiếu chưa có dòng thiết bị.</p>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function SignatureModal({
  request,
  phase,
  pending,
  onClose,
  onConfirm,
}: {
  request: EquipmentRequestListItem;
  phase: "handover" | "return";
  pending: boolean;
  onClose: () => void;
  onConfirm: (signature: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const isHandover = phase === "handover";

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    const canvas = canvasRef.current;
    if (canvas) {
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
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, pending]);

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

  return createPortal(
    <div
      className="equipment-modal-layer signature-modal-layer"
      role="presentation"
    >
      <button
        type="button"
        className="equipment-modal-backdrop"
        aria-label="Đóng cửa sổ ký xác nhận"
        onClick={() => !pending && onClose()}
      />
      <section
        className="equipment-modal signature-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-modal-title"
      >
        <header className="equipment-modal-header">
          <div>
            <span>Chữ ký xác nhận điện tử</span>
            <h2 id="signature-modal-title">
              {isHandover
                ? "Xác nhận đã nhận dụng cụ"
                : "Xác nhận đã trả dụng cụ"}
            </h2>
            <p>
              Phiếu {formatEquipmentRequestCode(request.created_at)} ·{" "}
              {request.profiles?.full_name}
            </p>
          </div>
          <button
            type="button"
            className="equipment-modal-close"
            disabled={pending}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="signature-modal-body">
          <p>
            Ký trong khung bên dưới để xác nhận{" "}
            {isHandover ? "đã nhận" : "đã bàn giao trả"} đầy đủ dụng cụ của
            phiếu này.
          </p>
          <canvas
            ref={canvasRef}
            className="signature-canvas"
            aria-label="Khung vẽ chữ ký"
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
              disabled={pending || !hasInk}
              onClick={clearSignature}
            >
              Ký lại
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={pending || !hasInk}
              onClick={() => {
                const signature = canvasRef.current?.toDataURL("image/png");
                if (signature) onConfirm(signature);
              }}
            >
              {pending ? "Đang lưu…" : "Ký và xác nhận"}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function EquipmentRequestList({
  requests,
  emptyMessage,
  canManageStatus = false,
  canAddItems = false,
  catalog = [],
  viewerId,
  viewerEmail = "",
  viewerRoles = [],
  manageableDomains = [],
  initialRequestId,
}: {
  requests: unknown[];
  emptyMessage: string;
  canManageStatus?: boolean;
  canAddItems?: boolean;
  catalog?: EquipmentCatalogListItem[];
  viewerId?: string;
  viewerEmail?: string;
  viewerRoles?: AppRole[];
  manageableDomains?: EquipmentRequestDomain[];
  initialRequestId?: string;
}) {
  const items = requests as EquipmentRequestListItem[];
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () =>
      new Set(
        initialRequestId && items.some((item) => item.id === initialRequestId)
          ? [initialRequestId]
          : [],
      ),
  );
  const [modalRequest, setModalRequest] =
    useState<EquipmentRequestListItem | null>(null);
  const [query, setQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(() =>
    equipmentRequestTargetPage(
      items.map((item) => item.id),
      initialRequestId,
      TABLE_PAGE_SIZE,
    ),
  );
  const [statusNotice, setStatusNotice] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [updatingId, setUpdatingId] = useState("");
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [requestToDelete, setRequestToDelete] =
    useState<EquipmentRequestListItem | null>(null);
  const [signatureTarget, setSignatureTarget] = useState<{
    request: EquipmentRequestListItem;
    phase: "handover" | "return";
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const canConfirmHandoverEarly =
    viewerRoles.includes("admin") &&
    EARLY_HANDOVER_ADMIN_EMAILS.has(viewerEmail.trim().toLowerCase());
  const [currentStatuses, setCurrentStatuses] = useState<
    Record<string, EquipmentRequestStatus>
  >(() => Object.fromEntries(items.map((item) => [item.id, item.status])));
  const [confirmationStates, setConfirmationStates] = useState<
    Record<string, EquipmentConfirmationState>
  >(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        {
          status: item.status,
          late_approval_status: item.late_approval_status,
          late_registration_reason: item.late_registration_reason,
          late_requested_at: item.late_requested_at,
          late_reviewed_at: item.late_reviewed_at,
          late_review_note: item.late_review_note,
          handover_staff_confirmed_at: item.handover_staff_confirmed_at,
          handover_recipient_signed_at: item.handover_recipient_signed_at,
          handover_effective_at: item.handover_effective_at,
          return_staff_confirmed_at: item.return_staff_confirmed_at,
          return_recipient_signed_at: item.return_recipient_signed_at,
          return_effective_at: item.return_effective_at,
        },
      ]),
    ),
  );

  const visibleItems = useMemo(
    () => items.filter(({ id }) => !deletedIds.has(id)),
    [deletedIds, items],
  );

  const filteredItems = useMemo(
    () =>
      visibleItems.filter((request) => {
        const scheduleDate = request.class_schedules?.schedule_date ?? "";
        const status = getWarehouseStatus(
          currentStatuses[request.id] ?? request.status,
          confirmationStates[request.id],
        );
        const normalizedQuery = query.trim().toLocaleLowerCase("vi");
        const schedule = request.class_schedules;
        const room = schedule?.rooms;
        const matchesQuery =
          !normalizedQuery ||
          [
            request.id,
            schedule?.course_code_snapshot,
            schedule?.course_name_snapshot,
            room?.room_code,
            room?.building_code,
            request.profiles?.full_name,
            request.responsible?.full_name,
            domainLabel(request),
          ].some((value) =>
            String(value ?? "")
              .toLocaleLowerCase("vi")
              .includes(normalizedQuery),
          );
        return (
          matchesQuery &&
          (!domainFilter || request.request_domain === domainFilter) &&
          (!statusFilter || status === statusFilter) &&
          (!dateFrom || scheduleDate >= dateFrom) &&
          (!dateTo || scheduleDate <= dateTo)
        );
      }),
    [
      confirmationStates,
      currentStatuses,
      dateFrom,
      dateTo,
      domainFilter,
      query,
      statusFilter,
      visibleItems,
    ],
  );
  const safePage = Math.min(
    currentPage,
    totalPagesFor(filteredItems.length, TABLE_PAGE_SIZE),
  );
  const pageItems = filteredItems.slice(
    (safePage - 1) * TABLE_PAGE_SIZE,
    safePage * TABLE_PAGE_SIZE,
  );

  function toggleExpanded(requestId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(requestId)) next.delete(requestId);
      else next.add(requestId);
      return next;
    });
  }

  function changeStatus(
    requestId: string,
    status: EquipmentRequestWorkflowStatus,
  ) {
    const request = items.find((item) => item.id === requestId);
    if (!request || usesInventoryFulfillment(request)) return;
    if (
      !canManageStatus ||
      !manageableDomains.includes(
        items.find((request) => request.id === requestId)?.request_domain ??
          "nursing_skills",
      ) ||
      (status === currentStatuses[requestId] &&
        !["handed_over", "returned"].includes(status))
    )
      return;
    if (
      status === "handed_over" &&
      currentStatuses[requestId] === "new" &&
      canConfirmHandoverEarly &&
      !window.confirm(
        "Phiếu chưa chuyển sang Đã soạn. Tài khoản quản trị này được phép xác nhận giao trước. Bạn có chắc muốn tiếp tục?",
      )
    )
      return;
    setUpdatingId(requestId);
    setStatusNotice(null);
    startTransition(async () => {
      const result = await updateEquipmentRequestStatus(requestId, status);
      if (result.ok && result.data) {
        setCurrentStatuses((current) => ({
          ...current,
          [requestId]: result.data!.status,
        }));
        setConfirmationStates((current) => ({
          ...current,
          [requestId]: result.data!,
        }));
      }
      setStatusNotice(result.ok ? null : result);
      setUpdatingId("");
    });
  }

  function reviewLateRegistration(
    requestId: string,
    decision: Extract<EquipmentLateApprovalStatus, "approved" | "rejected">,
  ) {
    if (
      !canManageStatus ||
      !manageableDomains.includes(
        items.find((request) => request.id === requestId)?.request_domain ??
          "nursing_skills",
      )
    )
      return;
    const note =
      decision === "rejected"
        ? window.prompt("Ghi chú lý do từ chối (không bắt buộc):", "")
        : "";
    if (note === null) return;

    setUpdatingId(requestId);
    setStatusNotice(null);
    startTransition(async () => {
      const result = await reviewLateEquipmentRequest(
        requestId,
        decision,
        note,
      );
      if (result.ok && result.data) {
        setCurrentStatuses((current) => ({
          ...current,
          [requestId]: result.data!.status,
        }));
        setConfirmationStates((current) => ({
          ...current,
          [requestId]: result.data!,
        }));
      }
      setStatusNotice(result.ok ? null : result);
      setUpdatingId("");
    });
  }

  function confirmSignature(signature: string) {
    const target = signatureTarget;
    if (!target || usesInventoryFulfillment(target.request)) return;
    setUpdatingId(target.request.id);
    setStatusNotice(null);
    startTransition(async () => {
      const result = await confirmEquipmentRequestHandoff(
        target.request.id,
        target.phase,
        signature,
      );
      if (result.ok && result.data) {
        setCurrentStatuses((current) => ({
          ...current,
          [target.request.id]: result.data!.status,
        }));
        setConfirmationStates((current) => ({
          ...current,
          [target.request.id]: result.data!,
        }));
        setSignatureTarget(null);
      }
      setStatusNotice(result.ok ? null : result);
      setUpdatingId("");
    });
  }

  function confirmDeleteRequest() {
    const request = requestToDelete;
    if (
      !request ||
      !canManageStatus ||
      !manageableDomains.includes(request.request_domain)
    )
      return;
    setUpdatingId(request.id);
    setStatusNotice(null);
    startTransition(async () => {
      const result = await deleteEquipmentRequest(request.id);
      if (result.ok) {
        if (request.request_domain === "basic_medical") {
          setCurrentStatuses((current) => ({
            ...current,
            [request.id]: "cancelled",
          }));
        } else {
          setDeletedIds((current) => new Set(current).add(request.id));
          setExpandedIds((current) => {
            const next = new Set(current);
            next.delete(request.id);
            return next;
          });
        }
        if (modalRequest?.id === request.id) setModalRequest(null);
      }
      setStatusNotice(result);
      setUpdatingId("");
      setRequestToDelete(null);
    });
  }

  return (
    <div className="equipment-request-list-view">
      <div className="class-filter-panel equipment-request-filters">
        <label className="data-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCurrentPage(1);
            }}
            placeholder="Tìm mã phiếu, môn học, phòng, giảng viên…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="class-range-mode">
          <span className="sr-only">Phạm vi</span>
          <select
            value={domainFilter}
            onChange={(event) => {
              setDomainFilter(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">Tất cả phạm vi</option>
            <option value="nursing_skills">Kỹ năng Điều dưỡng</option>
            <option value="basic_medical">Y cơ sở</option>
          </select>
        </label>
        <label className="class-range-mode">
          <span className="sr-only">Trạng thái</span>
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">Tất cả trạng thái</option>
            {equipmentRequestStatuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="equipment-date-filter">
          <span>Từ ngày</span>
          <input
            aria-label="Từ ngày"
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setDateFrom(event.target.value);
              setCurrentPage(1);
            }}
          />
        </label>
        <label className="equipment-date-filter">
          <span>Đến ngày</span>
          <input
            aria-label="Đến ngày"
            type="date"
            value={dateTo}
            onChange={(event) => {
              setDateTo(event.target.value);
              setCurrentPage(1);
            }}
          />
        </label>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setQuery("");
            setDomainFilter("");
            setStatusFilter("");
            setDateFrom("");
            setDateTo("");
            setCurrentPage(1);
          }}
        >
          Xóa bộ lọc
        </button>
        <span className="inline-toolbar-count-slot equipment-filter-count-slot">
          <span className="equipment-filter-count">
            {filteredItems.length}/{visibleItems.length} phiếu
          </span>
        </span>
      </div>

      {statusNotice ? (
        <p
          className={statusNotice.ok ? "form-success" : "form-error"}
          role="status"
        >
          {statusNotice.message}
        </p>
      ) : null}

      <section className="data-panel equipment-request-list-panel">
        <div
          className="responsive-table"
          role="region"
          aria-label="Danh sách phiếu thiết bị; vuốt ngang để xem đầy đủ"
          tabIndex={0}
        >
          <table className="data-table equipment-request-table">
            <colgroup>
              <col className="equipment-col-domain" />
              <col className="equipment-col-course" />
              <col className="equipment-col-date" />
              <col className="equipment-col-time" />
              <col className="equipment-col-room" />
              <col className="equipment-col-count" />
              <col className="equipment-col-status" />
              <col className="equipment-col-toggle" />
            </colgroup>
            <thead>
              <tr>
                <th>Phạm vi</th>
                <th>Môn học</th>
                <th>Ngày</th>
                <th>Thời gian</th>
                <th>Phòng/Lab</th>
                <th>Thiết bị</th>
                <th>
                  <span className="equipment-status-heading">Trạng thái</span>
                </th>
                <th>
                  <span className="sr-only">Chi tiết</span>
                </th>
              </tr>
            </thead>
            {pageItems.map((request) => {
              const schedule = request.class_schedules;
              const room = schedule?.rooms;
              const status = currentStatuses[request.id] ?? request.status;
              const confirmation = confirmationStates[request.id];
              const lateApprovalStatus =
                confirmation?.late_approval_status ??
                request.late_approval_status;
              const lateRegistrationReason =
                confirmation?.late_registration_reason ??
                request.late_registration_reason;
              const inventoryManaged = usesInventoryFulfillment(request);
              const warehouseStatus = getWarehouseStatus(status, confirmation);
              const isCancelled = warehouseStatus === "cancelled";
              const expanded = expandedIds.has(request.id);
              const isRegistrant = request.registrant_id === viewerId;
              const isResponsibleLecturer =
                request.responsible_lecturer_id === viewerId;
              const canSignForRequest = isRegistrant || isResponsibleLecturer;
              const canManageRequest =
                canManageStatus &&
                manageableDomains.includes(request.request_domain);
              const recipientRoleLabel =
                request.request_domain === "basic_medical"
                  ? "Người đăng ký/GV giảng dạy-hướng dẫn"
                  : "Người đăng ký/GV phụ trách";
              const handoverSigned = Boolean(
                confirmation?.handover_recipient_signed_at,
              );
              const returnSigned = Boolean(
                confirmation?.return_recipient_signed_at,
              );
              const warehouseHasHandedOver = [
                "handed_over",
                "returned",
                "completed",
              ].includes(warehouseStatus);
              const warehouseHasReturned = ["returned", "completed"].includes(
                warehouseStatus,
              );
              const isCompleted = warehouseStatus === "completed";
              const canSignHandover =
                !inventoryManaged &&
                canSignForRequest &&
                warehouseHasHandedOver &&
                !handoverSigned &&
                !warehouseHasReturned &&
                !isCompleted;
              const canSignReturn =
                canSignForRequest &&
                !inventoryManaged &&
                warehouseHasHandedOver &&
                (handoverSigned || warehouseHasReturned) &&
                !returnSigned &&
                !isCompleted;

              return (
                <tbody className="equipment-request-list-item" key={request.id}>
                  <tr
                    className="equipment-request-table-row"
                    onClick={() => toggleExpanded(request.id)}
                  >
                    <td className="equipment-request-domain-cell">
                      <span className="equipment-request-domain">
                        {domainLabel(request)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="equipment-request-summary equipment-request-course-button"
                        aria-expanded={expanded}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleExpanded(request.id);
                        }}
                      >
                        <strong>{schedule?.course_code_snapshot}</strong>
                        <span>{schedule?.course_name_snapshot}</span>
                      </button>
                    </td>
                    <td className="equipment-request-date-cell">
                      <strong>
                        {formatScheduleDate(schedule?.schedule_date)}
                      </strong>
                    </td>
                    <td className="mono">
                      {schedule?.start_time.slice(0, 5)}–
                      {schedule?.end_time.slice(0, 5)}
                    </td>
                    <td className="equipment-request-room-cell">
                      <strong>
                        {room?.room_code}.{room?.building_code}
                      </strong>
                    </td>
                    <td>{request.equipment_request_items.length}</td>
                    <td className="equipment-request-status-cell">
                      <div className="equipment-request-status-stack">
                        {!isCancelled && lateApprovalStatus === "pending" ? (
                          <span className="request-late-approval request-late-approval-pending">
                            Chờ duyệt đăng ký trễ
                          </span>
                        ) : !isCancelled &&
                          lateApprovalStatus === "rejected" ? (
                          <span className="request-late-approval request-late-approval-rejected">
                            Đã từ chối đăng ký trễ
                          </span>
                        ) : inventoryManaged ? (
                          <>
                            <StatusBadge status={warehouseStatus} />
                            {canManageRequest || canSignForRequest ? (
                              <Link
                                className="text-link"
                                href={`/equipment/fulfillment/${request.id}`}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {canManageRequest
                                  ? "Bàn giao / thu hồi"
                                  : "Xem và ký xác nhận"}
                              </Link>
                            ) : null}
                          </>
                        ) : isCompleted ? (
                          <StatusBadge status="completed" />
                        ) : warehouseHasReturned && !returnSigned ? (
                          canSignReturn ? (
                            <button
                              type="button"
                              className="equipment-sign-status-button equipment-sign-return"
                              disabled={isPending && updatingId === request.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSignatureTarget({
                                  request,
                                  phase: "return",
                                });
                              }}
                            >
                              Ký xác nhận Đã trả
                            </button>
                          ) : (
                            <>
                              <StatusBadge status="returned" />
                              <small className="equipment-confirmation-waiting">
                                Chờ ký xác nhận Đã trả
                              </small>
                            </>
                          )
                        ) : warehouseHasHandedOver && !handoverSigned ? (
                          canSignHandover ? (
                            <button
                              type="button"
                              className="equipment-sign-status-button equipment-sign-handover"
                              disabled={isPending && updatingId === request.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSignatureTarget({
                                  request,
                                  phase: "handover",
                                });
                              }}
                            >
                              Ký xác nhận Đã giao
                            </button>
                          ) : (
                            <>
                              <StatusBadge status="handed_over" />
                              <small className="equipment-confirmation-waiting">
                                Chờ ký xác nhận Đã giao
                              </small>
                            </>
                          )
                        ) : warehouseHasHandedOver && returnSigned ? (
                          <>
                            <StatusBadge status="returned" />
                            <small className="equipment-confirmation-waiting">
                              Chờ kho xác nhận
                            </small>
                          </>
                        ) : warehouseHasHandedOver && handoverSigned ? (
                          <>
                            <StatusBadge status="handed_over" />
                            {canSignReturn ? (
                              <button
                                type="button"
                                className="equipment-sign-status-button equipment-sign-return"
                                disabled={
                                  isPending && updatingId === request.id
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSignatureTarget({
                                    request,
                                    phase: "return",
                                  });
                                }}
                              >
                                Ký xác nhận Đã trả
                              </button>
                            ) : (
                              <small className="equipment-confirmation-waiting">
                                Chờ ký xác nhận Đã trả
                              </small>
                            )}
                          </>
                        ) : (
                          <StatusBadge status={warehouseStatus} />
                        )}
                        {lateApprovalStatus === "approved" ? (
                          <small className="request-late-approval-approved">
                            Đã duyệt đăng ký trễ
                          </small>
                        ) : null}
                      </div>
                    </td>
                    <td className="equipment-request-toggle-cell">
                      <button
                        type="button"
                        className="equipment-request-chevron"
                        aria-label={
                          expanded ? "Thu gọn phiếu" : "Mở chi tiết phiếu"
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleExpanded(request.id);
                        }}
                      >
                        {expanded ? "⌃" : "⌄"}
                      </button>
                    </td>
                  </tr>

                  {expanded ? (
                    <tr className="equipment-request-detail-row">
                      <td colSpan={8}>
                        <div className="equipment-request-details">
                          {canManageRequest ? (
                            <div className="equipment-status-section equipment-status-section-top">
                              {!isCancelled &&
                              lateApprovalStatus === "pending" ? (
                                <div className="equipment-late-review-panel">
                                  <div>
                                    <strong>Chờ duyệt đăng ký trễ</strong>
                                    <p>
                                      <b>Lý do đăng ký trễ:</b>{" "}
                                      {lateRegistrationReason}
                                    </p>
                                  </div>
                                  <div className="equipment-late-review-actions">
                                    <button
                                      type="button"
                                      className="button button-primary"
                                      disabled={
                                        isPending && updatingId === request.id
                                      }
                                      onClick={() =>
                                        reviewLateRegistration(
                                          request.id,
                                          "approved",
                                        )
                                      }
                                    >
                                      Duyệt đăng ký trễ
                                    </button>
                                    <button
                                      type="button"
                                      className="button button-danger"
                                      disabled={
                                        isPending && updatingId === request.id
                                      }
                                      onClick={() =>
                                        reviewLateRegistration(
                                          request.id,
                                          "rejected",
                                        )
                                      }
                                    >
                                      Từ chối đăng ký trễ
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                              <strong>Trạng thái phiếu</strong>
                              <div className="equipment-status-toolbar">
                                <div
                                  className="equipment-status-actions"
                                  aria-busy={
                                    isPending && updatingId === request.id
                                  }
                                >
                                  {inventoryManaged ? (
                                    <Link
                                      className="button button-primary"
                                      href={`/equipment/fulfillment/${request.id}`}
                                    >
                                      Bàn giao, thu hồi và ký xác nhận
                                    </Link>
                                  ) : (
                                    equipmentRequestWorkflowStatuses.map(
                                      (option) => (
                                        <button
                                          type="button"
                                          key={option.value}
                                          className={`request-status-button request-status-${option.color}${warehouseStatus === option.value ? " active" : ""}`}
                                          disabled={
                                            isCancelled ||
                                            (isPending &&
                                              updatingId === request.id) ||
                                            (option.value === "handed_over" &&
                                              status === "new" &&
                                              !canConfirmHandoverEarly) ||
                                            (option.value === "completed" &&
                                              status !== "completed") ||
                                            (
                                              [
                                                "pending",
                                                "rejected",
                                              ] as EquipmentLateApprovalStatus[]
                                            ).includes(lateApprovalStatus)
                                          }
                                          onClick={() =>
                                            changeStatus(
                                              request.id,
                                              option.value,
                                            )
                                          }
                                        >
                                          {option.value === "handed_over"
                                            ? "Đã giao"
                                            : option.value === "returned"
                                              ? "Đã trả"
                                              : option.label}
                                        </button>
                                      ),
                                    )
                                  )}
                                </div>
                                <a
                                  className="button button-secondary equipment-handover-export"
                                  href={`/api/equipment-requests/${request.id}/handover`}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <Download size={17} aria-hidden="true" />
                                  Xuất phiếu PDF
                                </a>
                                {!isCancelled ? (
                                  <button
                                    type="button"
                                    className="button button-danger equipment-request-delete"
                                    disabled={isPending}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setRequestToDelete(request);
                                    }}
                                  >
                                    <Trash2 size={17} aria-hidden="true" />
                                    {request.request_domain === "basic_medical"
                                      ? "Hủy phiếu"
                                      : "Xóa phiếu"}
                                  </button>
                                ) : null}
                              </div>
                              {inventoryManaged ? (
                                <p>
                                  Thực giao/thực nhận được ghi kho ngay. Xem số
                                  lượng và ký xác nhận theo từng lần trong không
                                  gian bàn giao/thu hồi.
                                </p>
                              ) : (
                                <div className="equipment-confirmation-progress">
                                  <span>
                                    Giao — Kho:{" "}
                                    {confirmation?.handover_staff_confirmed_at
                                      ? "Đã xác nhận"
                                      : "Chưa"}
                                  </span>
                                  <span>
                                    {recipientRoleLabel}:{" "}
                                    {confirmation?.handover_recipient_signed_at
                                      ? "Đã ký"
                                      : "Chưa"}
                                  </span>
                                  <span>
                                    Trả — Kho:{" "}
                                    {confirmation?.return_staff_confirmed_at
                                      ? "Đã xác nhận"
                                      : "Chưa"}
                                  </span>
                                  <span>
                                    {recipientRoleLabel}:{" "}
                                    {confirmation?.return_recipient_signed_at
                                      ? "Đã ký"
                                      : "Chưa"}
                                  </span>
                                </div>
                              )}
                              <EquipmentRequestLifecycleHistory
                                requestId={request.id}
                              />
                            </div>
                          ) : null}
                          {inventoryManaged &&
                          !canManageRequest &&
                          canSignForRequest ? (
                            <div className="equipment-status-section equipment-status-section-top">
                              <strong>
                                Ký xác nhận từng lần bàn giao/thu hồi
                              </strong>
                              <p>
                                Xem số lượng thực giao/thực nhận trước khi ký
                                xác nhận. Chữ ký gắn với từng lần, không xác
                                nhận chung cho cả phiếu.
                              </p>
                              <Link
                                className="button button-primary"
                                href={`/equipment/fulfillment/${request.id}`}
                              >
                                Xem và ký xác nhận bàn giao/thu hồi
                              </Link>
                            </div>
                          ) : null}
                          <dl className="detail-list equipment-request-detail-grid">
                            <div className="equipment-request-code-detail">
                              <dt>Mã phiếu</dt>
                              <dd className="mono">
                                {formatEquipmentRequestCode(request.created_at)}
                              </dd>
                            </div>
                            <div className="equipment-note-detail-row">
                              <dt>Ghi chú chung</dt>
                              <dd>{request.note || "Không có ghi chú"}</dd>
                            </div>
                            {lateApprovalStatus !== "not_required" ? (
                              <div className="equipment-note-detail-row">
                                <dt>Đăng ký trễ</dt>
                                <dd>
                                  <strong>
                                    {lateApprovalStatus === "pending"
                                      ? "Chờ duyệt đăng ký trễ"
                                      : lateApprovalStatus === "approved"
                                        ? "Đã duyệt đăng ký trễ"
                                        : "Đã từ chối đăng ký trễ"}
                                  </strong>
                                  {lateRegistrationReason
                                    ? ` — ${lateRegistrationReason}`
                                    : ""}
                                  {confirmation?.late_review_note
                                    ? ` — Ghi chú: ${confirmation.late_review_note}`
                                    : request.late_review_note
                                      ? ` — Ghi chú: ${request.late_review_note}`
                                      : ""}
                                </dd>
                              </div>
                            ) : null}
                            <div>
                              <dt>Người đăng ký</dt>
                              <dd>{request.profiles?.full_name}</dd>
                            </div>
                            <div>
                              <dt>Email</dt>
                              <dd>{request.email_snapshot}</dd>
                            </div>
                            <div>
                              <dt>Số điện thoại</dt>
                              <dd>{request.phone_snapshot}</dd>
                            </div>
                            <div>
                              <dt>
                                {request.request_domain === "basic_medical"
                                  ? "Giảng viên giảng dạy/hướng dẫn"
                                  : "Giảng viên phụ trách"}
                              </dt>
                              <dd>{request.responsible?.full_name}</dd>
                            </div>
                            <div>
                              <dt>Số sinh viên</dt>
                              <dd>{schedule?.student_count}</dd>
                            </div>
                            <div>
                              <dt>Phòng/Lab</dt>
                              <dd>
                                {room?.room_code}.{room?.building_code}
                                {room?.room_name ? ` — ${room.room_name}` : ""}
                              </dd>
                            </div>
                            <div>
                              <dt>Thời gian nhận</dt>
                              <dd>{formatDateTime(request.receive_at)}</dd>
                            </div>
                            <div>
                              <dt>Thời gian trả</dt>
                              <dd>{formatDateTime(request.return_at)}</dd>
                            </div>
                            <div>
                              <dt>Ngày tạo phiếu</dt>
                              <dd>{formatDateTime(request.created_at)}</dd>
                            </div>
                            <div className="equipment-list-detail-row">
                              <dt>Danh sách trang thiết bị</dt>
                              <dd>
                                <button
                                  type="button"
                                  className="button button-secondary"
                                  onClick={() => setModalRequest(request)}
                                >
                                  Xem toàn bộ danh sách (
                                  {request.equipment_request_items.length})
                                </button>
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
          </table>
        </div>
        {!filteredItems.length ? (
          <p className="panel-empty">
            {visibleItems.length
              ? "Không có phiếu phù hợp bộ lọc."
              : emptyMessage}
          </p>
        ) : null}
        <PaginationControls
          currentPage={safePage}
          totalItems={filteredItems.length}
          onPageChange={setCurrentPage}
        />
      </section>

      {modalRequest ? (
        <EquipmentItemsModal
          key={modalRequest.id}
          request={modalRequest}
          catalog={catalog}
          canAddItems={
            canAddItems &&
            canAddEquipmentRequestItems(
              viewerRoles,
              getWarehouseStatus(
                currentStatuses[modalRequest.id] ?? modalRequest.status,
                confirmationStates[modalRequest.id],
              ),
            )
          }
          onClose={() => setModalRequest(null)}
        />
      ) : null}
      {signatureTarget && !usesInventoryFulfillment(signatureTarget.request) ? (
        <SignatureModal
          request={signatureTarget.request}
          phase={signatureTarget.phase}
          pending={isPending && updatingId === signatureTarget.request.id}
          onClose={() => {
            if (!isPending) setSignatureTarget(null);
          }}
          onConfirm={confirmSignature}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(requestToDelete)}
        title={
          requestToDelete?.request_domain === "basic_medical"
            ? "Hủy phiếu thiết bị?"
            : "Xóa phiếu thiết bị?"
        }
        description={
          requestToDelete
            ? requestToDelete.request_domain === "basic_medical"
              ? `Phiếu ${formatEquipmentRequestCode(requestToDelete.created_at)} sẽ chuyển sang trạng thái Đã hủy. Lịch sử phiếu vẫn được giữ và buổi học Y cơ sở gốc không bị xóa bởi thao tác này.`
              : `Phiếu ${formatEquipmentRequestCode(requestToDelete.created_at)} và toàn bộ danh sách thiết bị trong phiếu sẽ bị xóa. Lớp Skills lab gốc vẫn được giữ lại.`
            : ""
        }
        confirmLabel={
          requestToDelete?.request_domain === "basic_medical"
            ? "Hủy phiếu"
            : "Xóa phiếu"
        }
        pending={isPending && updatingId === requestToDelete?.id}
        onConfirm={confirmDeleteRequest}
        onCancel={() => {
          if (!isPending) setRequestToDelete(null);
        }}
      />
    </div>
  );
}
