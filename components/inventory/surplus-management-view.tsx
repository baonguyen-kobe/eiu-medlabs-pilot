"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  History,
  LockKeyhole,
  Search,
  ShieldCheck,
  X,
} from "@/components/icons";
import {
  appendStocktakeEvidenceAction,
  verifyStocktakeSurplusAction,
} from "@/app/inventory/actions";
import { readInventoryOptions } from "@/app/inventory/read-actions";
import { formatDisplayQuantity } from "@/lib/inventory/decimal";
import { normalizeExpiryInput } from "@/lib/inventory/dates";
import {
  ConditionBadge,
  HoldStatusBadge,
  ProvenanceBadge,
} from "@/components/inventory/status-badge";
import { InventoryLookup } from "@/components/inventory/inventory-lookup";
import { PaginationControls } from "@/components/pagination-controls";
import { StockEvidenceModal } from "./stock-evidence-modal";
import type {
  InventoryOperationStock,
  InventoryStorageLocation,
  VerifyStocktakeSurplusPayload,
} from "@/lib/inventory/types";

const SURPLUS_PAGE_SIZE = 20;

export function SurplusManagementView({
  isAdmin = false,
}: {
  isAdmin?: boolean;
}) {
  const [items, setItems] = useState<InventoryOperationStock[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [filterHeldOnly, setFilterHeldOnly] = useState(true);

  // Active modal state (only release or append - reject removed per Owner policy)
  const [selectedOrigin, setSelectedOrigin] =
    useState<InventoryOperationStock | null>(null);
  const [modalMode, setModalMode] = useState<"release" | "append" | null>(null);

  // Evidence review modal state
  const [evidenceModalOrigin, setEvidenceModalOrigin] =
    useState<InventoryOperationStock | null>(null);

  // Modal form fields
  const [modalReason, setModalReason] = useState("");
  const [modalEvidence, setModalEvidence] = useState("");
  const [modalExpiryPrecision, setModalExpiryPrecision] = useState<
    "day" | "month"
  >("day");
  const [modalExpiryInput, setModalExpiryInput] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);

  const [notice, setNotice] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const [isPending, startTransition] = useTransition();

  // Out-of-order fetch guard
  const fetchIdRef = useRef(0);

  const loadSurplusStock = useCallback(
    async (locId: string, pageNum: number, q: string, heldOnly: boolean) => {
      const currentFetchId = ++fetchIdRef.current;
      try {
        const res = await readInventoryOptions<InventoryOperationStock>(
          "operation_stock",
          {
            location_id: locId || undefined,
            is_held: heldOnly ? true : undefined,
            include_held: true,
            provenance_group: "STOCKTAKE_SURPLUS",
            q: q.trim() || undefined,
            page: pageNum,
            page_size: SURPLUS_PAGE_SIZE,
          },
        );

        if (currentFetchId !== fetchIdRef.current) return;

        setItems(res.rows);
        setTotalItems(res.total);
      } catch (err: unknown) {
        if (currentFetchId !== fetchIdRef.current) return;
        setNotice({
          ok: false,
          message: `Lỗi tải danh sách hàng tạm giữ: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        if (currentFetchId === fetchIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const res = await readInventoryOptions<InventoryOperationStock>(
          "operation_stock",
          {
            location_id: selectedLocation || undefined,
            is_held: filterHeldOnly ? true : undefined,
            include_held: true,
            provenance_group: "STOCKTAKE_SURPLUS",
            q: search.trim() || undefined,
            page,
            page_size: SURPLUS_PAGE_SIZE,
          },
        );

        if (!isMounted) return;

        setItems(res.rows);
        setTotalItems(res.total);
      } catch (err: unknown) {
        if (!isMounted) return;
        setNotice({
          ok: false,
          message: `Lỗi tải danh sách hàng tạm giữ: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [selectedLocation, page, search, filterHeldOnly]);

  function handleLocationFilterChange(newLocId: string) {
    setSelectedLocation(newLocId);
    setPage(1);
    setIsLoading(true);
  }

  function handleHeldOnlyChange(checked: boolean) {
    setFilterHeldOnly(checked);
    setPage(1);
    setIsLoading(true);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setIsLoading(true);
    loadSurplusStock(selectedLocation, 1, search, filterHeldOnly);
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
    setIsLoading(true);
  }

  function openActionModal(
    origin: InventoryOperationStock,
    mode: "release" | "append",
  ) {
    setSelectedOrigin(origin);
    setModalMode(mode);
    setModalReason("");
    setModalEvidence("");
    setModalError(null);
    setModalExpiryPrecision("day");
    setModalExpiryInput(origin.expiry_date || "");
  }

  function closeModal() {
    setSelectedOrigin(null);
    setModalMode(null);
    setModalError(null);
  }

  async function handleModalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOrigin || !modalMode) return;
    setModalError(null);

    if (!modalReason.trim()) {
      setModalError("Lý do thực hiện là bắt buộc.");
      return;
    }
    if (!modalEvidence.trim()) {
      setModalError("Ghi chú bằng chứng (Số biên bản/quyết định) là bắt buộc.");
      return;
    }

    // Chemical expiry validation when releasing
    const isChemical = selectedOrigin.material_kind === "chemical";
    const needsExpiryVerification =
      modalMode === "release" &&
      (isChemical ||
        selectedOrigin.expiry_required ||
        selectedOrigin.expiry_precision === "unknown");

    if (needsExpiryVerification && isChemical) {
      const norm = normalizeExpiryInput(modalExpiryPrecision, modalExpiryInput);
      if (!norm.valid) {
        setModalError(
          `Vật tư hóa chất bắt buộc phải xác minh Hạn dùng cụ thể (ngày hoặc tháng) trước khi giải tỏa: ${norm.error}`,
        );
        return;
      }
    }

    startTransition(async () => {
      try {
        if (modalMode === "append") {
          const res = await appendStocktakeEvidenceAction({
            origin_id: selectedOrigin.origin_id,
            evidence_note: modalEvidence.trim(),
            reason: modalReason.trim(),
          });
          if (res.ok) {
            setNotice({
              ok: true,
              message: `Bổ sung bằng chứng thành công cho lô ${selectedOrigin.item_code}!`,
            });
            closeModal();
            loadSurplusStock(selectedLocation, page, search, filterHeldOnly);
          } else {
            setModalError(res.error || "Thao tác thất bại");
          }
        } else {
          // Release hold (Admin only)
          const payload: VerifyStocktakeSurplusPayload = {
            origin_id: selectedOrigin.origin_id,
            expected_version: selectedOrigin.current_version,
            expected_stock_revision: selectedOrigin.stock_revision,
            action: "release",
            reason: modalReason.trim(),
            evidence_note: modalEvidence.trim(),
            expiry_precision: needsExpiryVerification
              ? modalExpiryPrecision
              : undefined,
            expiry_input: needsExpiryVerification
              ? modalExpiryInput.trim()
              : undefined,
          };

          const res = await verifyStocktakeSurplusAction(payload);
          if (res.ok) {
            setNotice({
              ok: true,
              message: `Đã thẩm định và giải tỏa thành công lô hàng ${selectedOrigin.item_code}! Đã gỡ tạm giữ; khả dụng theo tình trạng, hạn dùng và trạng thái hoạt động.`,
            });
            closeModal();
            loadSurplusStock(selectedLocation, page, search, filterHeldOnly);
          } else {
            setModalError(res.error || "Thao tác thẩm định thất bại");
          }
        }
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Alert banner */}
      {notice ? (
        <div
          role="status"
          className={`p-4 rounded-xl border flex items-start gap-3 ${
            notice.ok
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-rose-50 border-rose-200 text-rose-900"
          }`}
        >
          {notice.ok ? (
            <Check className="text-emerald-600 mt-0.5 shrink-0" size={20} />
          ) : (
            <AlertTriangle
              className="text-rose-600 mt-0.5 shrink-0"
              size={20}
            />
          )}
          <div className="space-y-1">
            <p className="font-semibold text-sm">{notice.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="ml-auto text-slate-400 hover:text-slate-600"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {/* Rules Banner for Owner Surplus B */}
      <div className="p-4 bg-purple-50 border border-purple-200 rounded-2xl text-purple-950 text-xs space-y-2">
        <div className="font-bold flex items-center gap-1.5 text-sm">
          <ShieldCheck size={18} className="text-purple-600 shrink-0" />
          <span>
            Quy chế Thẩm định Hàng Thừa Kiểm kê (Owner Surplus B Policy)
          </span>
        </div>
        <p className="text-slate-700 leading-relaxed">
          • <strong>Không tạo chứng từ nhận giả:</strong> Hàng thừa kiểm kê được
          quản lý tách bạch dưới nguồn gốc <code>STOCKTAKE_SURPLUS</code>, vào
          tồn thực tế (on-hand) ngay lập tức nhưng{" "}
          <strong>TẠM GIỮ (HOLD)</strong> cho đến khi Quản trị viên thẩm định.
          <br />• <strong>Giải tỏa hàng không yêu cầu HSD:</strong> Quản trị
          viên có quyền giải tỏa dựa trên bằng chứng kiểm kê thực tế mà{" "}
          <em>không cần chứng từ nhận hàng trong quá khứ</em>.
          <br />• <strong>Vật tư Hóa chất bắt buộc xác minh HSD:</strong> Hóa
          chất có hạn dùng chưa rõ (unknown) bắt buộc phải được Quản trị viên
          thẩm định ngày/tháng hết hạn cụ thể trước khi giải tỏa. Không thể giải
          tỏa hóa chất ở trạng thái chưa rõ HSD.
          <br />• <strong>Bằng chứng bất biến (Append-only):</strong> Mọi ghi
          chú thẩm định hoặc bằng chứng bổ sung chỉ được ghi thêm theo chuỗi
          thời gian, không sửa đổi hay xóa bỏ dữ liệu trước đây.
        </p>
      </div>

      {/* Toolbar & Filters with Search & Pagination */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span>Vị trí kho:</span>
          </div>
          <div className="relative min-w-56">
            <InventoryLookup<InventoryStorageLocation>
              resource="locations"
              filters={{ active: true }}
              value={selectedLocation}
              label="Vị trí kho"
              id="surplus-filter-location"
              placeholder="Tất cả vị trí / All Locations"
              hideLabel={true}
              onSelect={(loc) => handleLocationFilterChange(loc.id)}
            />
            {selectedLocation ? (
              <button
                type="button"
                aria-label="Xóa chọn vị trí / Clear location"
                title="Xóa chọn vị trí / Clear location"
                onClick={() => handleLocationFilterChange("")}
                className="absolute right-8 top-2 text-slate-400 hover:text-slate-600 z-10 p-0.5"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer ml-2">
            <input
              type="checkbox"
              checked={filterHeldOnly}
              onChange={(e) => handleHeldOnlyChange(e.target.checked)}
              className="rounded text-purple-600 focus:ring-purple-500"
            />
            <span>Chỉ hiển thị lô đang TẠM GIỮ (Held Only)</span>
          </label>
        </div>

        {/* Search form */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-2.5 text-slate-400"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm SKU, tên vật tư..."
              className="text-xs pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 w-52"
            />
          </div>
          <button
            type="submit"
            className="button button-secondary text-xs py-1.5 px-3"
          >
            Tìm
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() =>
              loadSurplusStock(selectedLocation, page, search, filterHeldOnly)
            }
            className="button button-secondary text-xs flex items-center gap-1.5"
            title="Làm mới"
          >
            <History size={13} className={isLoading ? "animate-spin" : ""} />
            <span>Làm mới</span>
          </button>
        </form>
      </div>

      {/* Table of held / surplus items */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Danh sách Vật tư Thừa {"&"} Lô Tạm giữ / Surplus {"&"} Held Items
              ({totalItems} lô)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Các lô vật tư cần Quản trị viên thẩm định giải tỏa hoặc bổ sung
              bằng chứng chứng minh
            </p>
          </div>
          {!isAdmin ? (
            <span className="text-[11px] bg-slate-100 text-slate-600 py-1 px-2.5 rounded-full font-medium flex items-center gap-1">
              <LockKeyhole size={12} />
              <span>Chế độ Nhân viên: Bổ sung bằng chứng</span>
            </span>
          ) : (
            <span className="text-[11px] bg-purple-100 text-purple-800 py-1 px-2.5 rounded-full font-semibold flex items-center gap-1">
              <ShieldCheck size={12} />
              <span>
                Quyền Quản trị viên: Toàn quyền Thẩm định {"&"} Giải tỏa
              </span>
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            {isLoading
              ? "Đang tải dữ liệu..."
              : "Hiện không có lô vật tư nào đang bị tạm giữ hoặc phù hợp bộ lọc."}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[11px]">
                    <th className="py-2.5 px-3">Mã SKU {"&"} Tên vật tư</th>
                    <th className="py-2.5 px-3">Kho lưu trữ</th>
                    <th className="py-2.5 px-3">Nguồn gốc</th>
                    <th className="py-2.5 px-3">Trạng thái giữ</th>
                    <th className="py-2.5 px-3 text-right">Tổng tồn</th>
                    <th className="py-2.5 px-3">Hạn dùng</th>
                    <th className="py-2.5 px-3 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((row) => (
                    <tr
                      key={`${row.origin_id}-${row.location_id}-${row.condition}`}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900">
                          {row.item_code} - {row.item_name}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <ConditionBadge condition={row.condition} />
                          <span className="text-[11px] text-slate-400 font-mono">
                            Lô: {row.origin_id.slice(0, 8)}... | Phiên bản kho:
                            r{row.stock_revision}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        {row.location_code} - {row.location_name}
                      </td>
                      <td className="py-3 px-3">
                        <ProvenanceBadge provenance={row.provenance_group} />
                      </td>
                      <td className="py-3 px-3">
                        <HoldStatusBadge
                          isHeld={row.is_held}
                          holdReason={row.hold_reason}
                        />
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        {formatDisplayQuantity(row.quantity)}{" "}
                        {row.base_uom_code || ""}
                      </td>
                      <td className="py-3 px-3 text-slate-600">
                        {row.expiry_date ||
                          (row.expiry_precision === "unknown"
                            ? "Chưa rõ HSD"
                            : row.expiry_precision === "not_required"
                              ? "Không yêu cầu"
                              : "—")}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="inline-flex items-center gap-1.5 justify-center">
                          {isAdmin && row.is_held ? (
                            <button
                              type="button"
                              onClick={() => openActionModal(row, "release")}
                              className="button button-primary bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] py-1 px-2.5 flex items-center gap-1"
                              title="Thẩm định & Giải tỏa cấp phát"
                            >
                              <Check size={12} />
                              <span>Giải tỏa</span>
                            </button>
                          ) : null}

                          <button
                            type="button"
                            onClick={() => openActionModal(row, "append")}
                            className="button button-secondary text-[11px] py-1 px-2 flex items-center gap-1"
                            title="Ghi thêm bằng chứng lưu trữ"
                          >
                            <ClipboardList size={12} />
                            <span>Ghi bằng chứng</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setEvidenceModalOrigin(row)}
                            className="button button-secondary text-[11px] py-1 px-2 flex items-center gap-1 text-purple-700 hover:bg-purple-50"
                            title="Xem lịch sử bằng chứng kiểm kê / thẩm định"
                          >
                            <span>Lịch sử</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {/* Pagination Controls */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Hiển thị trang {page} trên tổng số {totalItems} lô
          </span>
          <PaginationControls
            currentPage={page}
            totalItems={totalItems}
            pageSize={SURPLUS_PAGE_SIZE}
            onPageChange={handlePageChange}
          />
        </div>
      </div>

      {/* Action Modal (Release or Append Evidence) */}
      {modalMode && selectedOrigin ? (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                {modalMode === "release" ? (
                  <>
                    <Check className="text-emerald-600" size={18} />
                    <span>
                      Thẩm định {"&"} Giải tỏa Hàng thừa (Release Hold)
                    </span>
                  </>
                ) : (
                  <>
                    <ClipboardList className="text-blue-600" size={18} />
                    <span>Bổ sung Bằng chứng Thẩm định (Append Evidence)</span>
                  </>
                )}
              </h3>
              <button
                type="button"
                aria-label="Đóng hộp thoại"
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            {/* Target Item summary */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Vật tư:</span>
                <span className="font-semibold text-slate-900">
                  {selectedOrigin.item_code} - {selectedOrigin.item_name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Loại vật tư:</span>
                <span className="font-semibold text-slate-800">
                  {selectedOrigin.material_kind === "chemical"
                    ? "Hóa chất (Chemical)"
                    : "Vật tư thông thường"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Vị trí kho:</span>
                <span className="font-semibold text-slate-800">
                  {selectedOrigin.location_code} -{" "}
                  {selectedOrigin.location_name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Số lượng:</span>
                <span className="font-bold text-slate-900">
                  {formatDisplayQuantity(selectedOrigin.quantity)}{" "}
                  {selectedOrigin.base_uom_code}
                </span>
              </div>
              {selectedOrigin.hold_reason ? (
                <div className="flex justify-between">
                  <span className="text-slate-500">Lý do giữ:</span>
                  <span className="text-rose-700 font-medium">
                    {selectedOrigin.hold_reason}
                  </span>
                </div>
              ) : null}
            </div>

            {modalMode === "release" && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setEvidenceModalOrigin(selectedOrigin)}
                  className="text-xs text-purple-700 hover:text-purple-900 underline font-medium flex items-center gap-1"
                >
                  <ClipboardList size={13} />
                  <span>
                    Xem lịch sử bằng chứng trước đây ({selectedOrigin.item_code}
                    ) &rarr;
                  </span>
                </button>
              </div>
            )}

            {modalError ? (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl">
                {modalError}
              </div>
            ) : null}

            <form onSubmit={handleModalSubmit} className="space-y-4">
              {/* If chemical and release: Expiry precision & date input */}
              {modalMode === "release" &&
              selectedOrigin.material_kind === "chemical" ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs">
                  <span className="font-bold text-amber-900 block">
                    Xác minh Hạn sử dụng bắt buộc cho Hóa chất (O01 / INV-042)
                  </span>
                  <p className="text-slate-600">
                    Hóa chất không thể giải tỏa ở trạng thái chưa rõ hạn sử
                    dụng. Vui lòng thẩm định ngày hoặc tháng hết hạn cụ thể:
                  </p>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label
                        htmlFor="surplus-release-exp-prec"
                        className="block font-semibold text-slate-700 mb-1"
                      >
                        Độ chính xác HSD *
                      </label>
                      <select
                        id="surplus-release-exp-prec"
                        value={modalExpiryPrecision}
                        onChange={(e) =>
                          setModalExpiryPrecision(
                            e.target.value as "day" | "month",
                          )
                        }
                        className="w-full text-xs py-1.5 px-2 border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="day">Theo ngày (YYYY-MM-DD)</option>
                        <option value="month">Theo tháng (YYYY-MM)</option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="surplus-release-exp-val"
                        className="block font-semibold text-slate-700 mb-1"
                      >
                        Ngày/Tháng hết hạn *
                      </label>
                      <input
                        id="surplus-release-exp-val"
                        type={modalExpiryPrecision === "day" ? "date" : "month"}
                        value={modalExpiryInput}
                        onChange={(e) => setModalExpiryInput(e.target.value)}
                        className="w-full text-xs py-1.5 px-2 border border-slate-300 rounded-lg bg-white"
                        required
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Reason */}
              <div>
                <label
                  htmlFor="surplus-release-reason"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Lý do thẩm định / giải quyết *
                </label>
                <input
                  id="surplus-release-reason"
                  type="text"
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  placeholder="VD: Đã đối chiếu tem mác và kiểm định chất lượng đạt chuẩn..."
                  className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
                  required
                />
              </div>

              {/* Evidence note */}
              <div>
                <label
                  htmlFor="surplus-release-evidence"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Ghi chú Bằng chứng / Số quyết định phê duyệt *
                </label>
                <textarea
                  id="surplus-release-evidence"
                  value={modalEvidence}
                  onChange={(e) => setModalEvidence(e.target.value)}
                  placeholder="VD: Biên bản thẩm định số 15/BB-TĐCL ngày 03/10/2026 của Hội đồng Kho..."
                  rows={3}
                  className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
                  required
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Bằng chứng này sẽ được lưu trữ bất biến (append-only) trong Sổ
                  cái.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeModal}
                  className="button button-secondary text-xs"
                >
                  Đóng / Close
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className={`button text-xs font-semibold py-2 px-4 rounded-lg text-white ${
                    modalMode === "release"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {isPending ? "Đang xử lý..." : "Xác nhận & Ghi sổ"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Immutable Stock Evidence History Modal */}
      <StockEvidenceModal
        open={Boolean(evidenceModalOrigin)}
        originId={evidenceModalOrigin?.origin_id || ""}
        itemCode={evidenceModalOrigin?.item_code}
        itemName={evidenceModalOrigin?.item_name}
        onClose={() => setEvidenceModalOrigin(null)}
      />
    </div>
  );
}
