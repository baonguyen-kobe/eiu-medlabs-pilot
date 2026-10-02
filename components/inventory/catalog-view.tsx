"use client";

import React, { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, Settings, X } from "@/components/icons";
import {
  createCategoryAction,
  createItemAction,
  createUomAction,
  inactivateCategoryAction,
  inactivateItemAction,
  inactivateUomAction,
  reactivateCategoryAction,
  reactivateItemAction,
  reactivateUomAction,
  updateCategoryAction,
  updateItemAction,
  updateUomAction,
} from "@/app/inventory/actions";
import {
  ActiveBadge,
  MaterialKindBadge,
  ReturnSemanticsBadge,
} from "./status-badge";
import { ConfirmActionModal } from "./confirm-action-modal";
import { PaginationControls } from "@/components/pagination-controls";
import { InventoryLookup } from "./inventory-lookup";
import { readInventoryOptions } from "@/app/inventory/read-actions";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type {
  InventoryCatalogItem,
  InventoryCategory,
  InventoryUom,
  MaterialKind,
  ReturnSemantics,
  TrackingStrategy,
  UomDimension,
} from "@/lib/inventory/types";
function extractRevision(data: unknown): string | number | undefined {
  if (!data || typeof data !== "object") return undefined;
  if (
    "revision" in data &&
    (typeof data.revision === "number" || typeof data.revision === "string")
  ) {
    return data.revision;
  }
  if ("payload" in data && data.payload && typeof data.payload === "object") {
    const payload = data.payload;
    if (
      "revision" in payload &&
      (typeof payload.revision === "number" ||
        typeof payload.revision === "string")
    ) {
      return payload.revision;
    }
  }
  return undefined;
}

export function CatalogView({
  initialItems,
  total,
  currentPage = 1,
  pageSize = TABLE_PAGE_SIZE,
  currentQ = "",
  currentCategoryId = "",
  currentActive = "all",
  currentSort: _currentSort = "",
  isAdmin,
}: {
  initialItems: InventoryCatalogItem[];
  total: number;
  currentPage?: number;
  pageSize?: number;
  currentQ?: string;
  currentCategoryId?: string;
  currentActive?: string;
  currentSort?: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [items, setItems] = useState<InventoryCatalogItem[]>(initialItems);
  const [search, setSearch] = useState(currentQ);
  const [categoryFilter, setCategoryFilter] = useState(currentCategoryId);
  const [selectedCategoryFilterLabel, setSelectedCategoryFilterLabel] =
    useState("");
  const [activeFilter, setActiveFilter] = useState<string>(currentActive);

  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const [createItemOpen, setCreateItemOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryCatalogItem | null>(null);
  const [targetItemForState, setTargetItemForState] = useState<{
    item: InventoryCatalogItem;
    targetActive: boolean;
  } | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [uomModalOpen, setUomModalOpen] = useState(false);
  const [prevProps, setPrevProps] = useState({
    items: initialItems,
    q: currentQ,
    catId: currentCategoryId,
    active: currentActive,
  });
  if (
    prevProps.items !== initialItems ||
    prevProps.q !== currentQ ||
    prevProps.catId !== currentCategoryId ||
    prevProps.active !== currentActive
  ) {
    setPrevProps({
      items: initialItems,
      q: currentQ,
      catId: currentCategoryId,
      active: currentActive,
    });
    setItems(initialItems);
    setSearch(currentQ);
    setCategoryFilter(currentCategoryId);
    setActiveFilter(currentActive);
  }

  const updateParams = useCallback(
    (updates: Record<string, string | number | undefined | null>) => {
      const params = new URLSearchParams(
        searchParams ? searchParams.toString() : "",
      );
      for (const [key, val] of Object.entries(updates)) {
        if (
          val === undefined ||
          val === null ||
          val === "" ||
          (key === "page" && Number(val) <= 1) ||
          (key === "active" && val === "all")
        ) {
          params.delete(key);
        } else {
          params.set(key, String(val));
        }
      }
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateParams({ q: search.trim() || undefined, page: undefined });
  }

  function handleActiveChange(val: string) {
    setActiveFilter(val);
    updateParams({ active: val === "all" ? undefined : val, page: undefined });
  }

  // Handle active/inactive state change for item
  async function handleConfirmItemStateChange(reason: string) {
    if (!targetItemForState) return;
    const { item, targetActive } = targetItemForState;

    startTransition(async () => {
      const res = targetActive
        ? await reactivateItemAction({
            id: item.id,
            expected_revision: item.revision,
            reason,
          })
        : await inactivateItemAction({
            id: item.id,
            expected_revision: item.revision,
            reason,
          });

      if (res.ok) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  active: targetActive,
                  revision: extractRevision(res.data) ?? i.revision,
                }
              : i,
          ),
        );
        setNotice({
          ok: true,
          message: targetActive
            ? `Đã kích hoạt lại vật tư ${item.code}`
            : `Đã ngừng hoạt động vật tư ${item.code}`,
        });
        router.refresh();
      } else {
        setNotice({ ok: false, message: res.error || "Thao tác thất bại" });
      }
      setTargetItemForState(null);
    });
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <div
          className={`p-3 text-xs rounded-xl flex items-center justify-between border ${
            notice.ok
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          <span>{notice.message}</span>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 p-1"
            onClick={() => setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {/* Top action toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="button button-primary text-xs"
            onClick={() => setCreateItemOpen(true)}
          >
            <Plus size={15} /> Thêm vật tư mới / Add Item
          </button>
          <button
            type="button"
            className="button button-secondary text-xs"
            onClick={() => setCategoryModalOpen(true)}
          >
            <Settings size={15} /> Quản lý nhóm / Categories
          </button>
          <button
            type="button"
            className="button button-secondary text-xs"
            onClick={() => setUomModalOpen(true)}
          >
            <Settings size={15} /> Đơn vị tính / UOMs
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            Tổng cộng: <strong>{total}</strong> vật tư
          </span>
        </div>
      </div>
      {/* Filter toolbar */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <form
            onSubmit={handleSearchSubmit}
            className="relative flex items-center gap-2"
          >
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-2.5 text-slate-400"
                size={16}
              />
              <input
                id="catalog-search"
                aria-label="Tìm theo mã SKU, tên vật tư / Search SKU or Name"
                type="text"
                className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Tìm theo mã SKU, tên vật tư..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="button button-secondary text-xs px-3 py-2"
            >
              Tìm kiếm
            </button>
          </form>

          <div className="flex items-center gap-1">
            <div className="flex-1">
              <InventoryLookup<InventoryCategory>
                resource="categories"
                filters={{ active: true }}
                value={categoryFilter}
                valueKey="id"
                label="Lọc theo nhóm vật tư"
                id="catalog-category-filter"
                selectedLabel={selectedCategoryFilterLabel}
                placeholder="Tất cả nhóm vật tư / All Categories"
                hideLabel={true}
                onSelect={(cat) => {
                  setCategoryFilter(cat.id);
                  setSelectedCategoryFilterLabel(`${cat.name} (${cat.code})`);
                  updateParams({ category_id: cat.id, page: undefined });
                }}
              />
            </div>
            {categoryFilter ? (
              <button
                type="button"
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                onClick={() => {
                  setCategoryFilter("");
                  setSelectedCategoryFilterLabel("");
                  updateParams({ category_id: undefined, page: undefined });
                }}
                title="Bỏ lọc nhóm"
                aria-label="Bỏ lọc nhóm"
              >
                <X size={15} />
              </button>
            ) : null}
          </div>

          <div>
            <select
              id="catalog-status-filter"
              aria-label="Lọc theo trạng thái / Filter by Status"
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              value={activeFilter}
              onChange={(e) => handleActiveChange(e.target.value)}
            >
              <option value="all">Tất cả trạng thái / All Statuses</option>
              <option value="active">Đang hoạt động / Active</option>
              <option value="inactive">Đã ngừng hoạt động / Inactive</option>
            </select>
          </div>
        </div>
      </div>

      {/* Items Data Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Mã SKU / Code</th>
                <th className="py-3 px-4">Tên vật tư / Name</th>
                <th className="py-3 px-4">Nhóm / Category</th>
                <th className="py-3 px-4">ĐVT cơ sở / Unit</th>
                <th className="py-3 px-4">Phân loại / Kind</th>
                <th className="py-3 px-4">Cơ chế trả / Return</th>
                <th className="py-3 px-4">Bắt buộc HSD / Expiry</th>
                <th className="py-3 px-4">Trạng thái / Status</th>
                <th className="py-3 px-4 text-center">Bản / Rev</th>
                <th className="py-3 px-4 text-right">Thao tác / Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    Chưa có vật tư nào phù hợp với bộ lọc tìm kiếm.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      {item.code}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800">
                      {item.name}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {item.category_name || item.category_id}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-700">
                      {item.base_uom_code}
                    </td>
                    <td className="py-3 px-4">
                      <MaterialKindBadge kind={item.material_kind} />
                    </td>
                    <td className="py-3 px-4">
                      <ReturnSemanticsBadge semantics={item.return_semantics} />
                    </td>
                    <td className="py-3 px-4">
                      {item.expiry_required ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          Bắt buộc / Required
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-500">
                          Không / No
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <ActiveBadge active={item.active} />
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-[11px] text-slate-500">
                      r{String(item.revision)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          className="px-2 py-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                          onClick={() => setEditItem(item)}
                        >
                          Sửa / Edit
                        </button>
                        {isAdmin ? (
                          item.active ? (
                            <button
                              type="button"
                              className="px-2 py-1 text-[11px] font-semibold text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded"
                              onClick={() =>
                                setTargetItemForState({
                                  item,
                                  targetActive: false,
                                })
                              }
                            >
                              Ngừng HĐ
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="px-2 py-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded"
                              onClick={() =>
                                setTargetItemForState({
                                  item,
                                  targetActive: true,
                                })
                              }
                            >
                              Kích hoạt
                            </button>
                          )
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Hiển thị {items.length} trên tổng số {total} dòng
          </span>
          <PaginationControls
            currentPage={currentPage}
            totalItems={total}
            onPageChange={(page) =>
              updateParams({ page: page > 1 ? page : undefined })
            }
            pageSize={pageSize}
          />
        </div>
      </div>
      {/* ========================================================================= */}
      {/* Modal 1: Create Item */}
      {/* ========================================================================= */}
      {createItemOpen ? (
        <CreateItemDialog
          onClose={() => setCreateItemOpen(false)}
          onCreated={(newItem) => {
            setItems((prev) => [newItem, ...prev]);
            setNotice({
              ok: true,
              message: `Tạo vật tư ${newItem.code} thành công!`,
            });
            setCreateItemOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 2: Edit Item Name */}
      {/* ========================================================================= */}
      {editItem ? (
        <EditItemDialog
          item={editItem}
          onClose={() => setEditItem(null)}
          onUpdated={(updated) => {
            setItems((prev) =>
              prev.map((i) => (i.id === updated.id ? updated : i)),
            );
            setNotice({
              ok: true,
              message: `Cập nhật vật tư ${updated.code} thành công!`,
            });
            setEditItem(null);
            router.refresh();
          }}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 3: Inactivate / Reactivate Item */}
      {/* ========================================================================= */}
      {targetItemForState ? (
        <ConfirmActionModal
          open={Boolean(targetItemForState)}
          title={
            targetItemForState.targetActive
              ? "Kích hoạt lại vật tư / Reactivate Item"
              : "Ngừng hoạt động vật tư / Inactivate Item"
          }
          description={
            targetItemForState.targetActive
              ? "Vật tư sẽ có thể được chọn lại khi tạo hồ sơ hoặc nhận kho mới."
              : "Vật tư sẽ không còn được chọn cho các nghiệp vụ nhận kho mới, nhưng toàn bộ lịch sử và tồn kho hiện tại được bảo lưu nguyên vẹn."
          }
          targetName={`${targetItemForState.item.code} - ${targetItemForState.item.name}`}
          currentRevision={targetItemForState.item.revision}
          actionLabel={
            targetItemForState.targetActive
              ? "Xác nhận kích hoạt lại"
              : "Xác nhận ngừng hoạt động"
          }
          actionVariant={targetItemForState.targetActive ? "primary" : "danger"}
          isPending={isPending}
          onConfirm={handleConfirmItemStateChange}
          onClose={() => setTargetItemForState(null)}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 4: Categories Manager */}
      {/* ========================================================================= */}
      {categoryModalOpen ? (
        <CategoryManagerDialog
          isAdmin={isAdmin}
          onClose={() => setCategoryModalOpen(false)}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 5: UOMs Manager */}
      {/* ========================================================================= */}
      {uomModalOpen ? (
        <UomManagerDialog
          isAdmin={isAdmin}
          onClose={() => setUomModalOpen(false)}
        />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Create Item
// -----------------------------------------------------------------------------
function CreateItemDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (item: InventoryCatalogItem) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [selectedCategoryLabel, setSelectedCategoryLabel] = useState("");
  const [baseUomCode, setBaseUomCode] = useState("");
  const [selectedUomLabel, setSelectedUomLabel] = useState("");
  const [materialKind, setMaterialKind] = useState<MaterialKind>("other");
  const [trackingStrategy, setTrackingStrategy] =
    useState<TrackingStrategy>("quantity");
  const [returnSemantics, setReturnSemantics] =
    useState<ReturnSemantics>("nonreturnable");
  const [expiryRequired, setExpiryRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // If chemical selected, automatically lock and enforce expiryRequired = true
  const effectiveExpiryRequired =
    materialKind === "chemical" ? true : expiryRequired;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await createItemAction({
        code,
        name,
        category_id: categoryId,
        base_uom_code: baseUomCode,
        material_kind: materialKind,
        tracking_strategy: trackingStrategy,
        return_semantics: returnSemantics,
        expiry_required: effectiveExpiryRequired,
      });

      if (res.ok && res.data) {
        onCreated({
          id: res.data.id,
          code: code.trim().toUpperCase(),
          name: name.trim(),
          category_id: categoryId,
          base_uom_code: baseUomCode,
          material_kind: materialKind,
          tracking_strategy: trackingStrategy,
          return_semantics: returnSemantics,
          expiry_required: effectiveExpiryRequired,
          active: true,
          revision: extractRevision(res.data) ?? 1,
        });
      } else {
        setError(res.error || "Lỗi tạo vật tư mới");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-item-dialog-title"
    >
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3
            id="create-item-dialog-title"
            className="text-sm font-bold text-slate-900 uppercase tracking-wider"
          >
            Thêm vật tư mới / Create Item
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
            onClick={onClose}
            aria-label="Đóng / Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="create-item-code"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Mã SKU <span className="text-red-500">*</span>
              </label>
              <input
                id="create-item-code"
                type="text"
                className="w-full text-xs font-mono uppercase border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder="VD: MED-GLV-01"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor="create-item-category"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Nhóm vật tư <span className="text-red-500">*</span>
              </label>
              <InventoryLookup<InventoryCategory>
                resource="categories"
                filters={{ active: true }}
                value={categoryId}
                valueKey="id"
                label="Nhóm vật tư"
                id="create-item-category"
                selectedLabel={selectedCategoryLabel}
                placeholder="Chọn hoặc tìm nhóm vật tư…"
                hideLabel={true}
                required={true}
                onSelect={(cat) => {
                  setCategoryId(cat.id);
                  setSelectedCategoryLabel(`${cat.name} (${cat.code})`);
                }}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="create-item-name"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Tên vật tư <span className="text-red-500">*</span>
            </label>
            <input
              id="create-item-name"
              type="text"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              placeholder="VD: Găng tay y tế có bột cỡ M"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="create-item-base-uom"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                ĐVT cơ sở <span className="text-red-500">*</span>
              </label>
              <InventoryLookup<InventoryUom>
                resource="uoms"
                filters={{ active: true }}
                value={baseUomCode}
                valueKey="code"
                label="ĐVT cơ sở"
                id="create-item-base-uom"
                selectedLabel={selectedUomLabel}
                placeholder="Chọn hoặc tìm ĐVT cơ sở…"
                hideLabel={true}
                required={true}
                onSelect={(uom) => {
                  setBaseUomCode(uom.code);
                  setSelectedUomLabel(`${uom.name} (${uom.code})`);
                }}
              />
            </div>
            <div>
              <label
                htmlFor="create-item-material-kind"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Phân loại vật chất <span className="text-red-500">*</span>
              </label>
              <select
                id="create-item-material-kind"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 bg-white"
                value={materialKind}
                onChange={(e) =>
                  setMaterialKind(e.target.value as MaterialKind)
                }
                required
              >
                <option value="other">Thông thường / Other</option>
                <option value="chemical">Hóa chất / Chemical</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="create-item-tracking"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Chiến lược theo dõi
              </label>
              <select
                id="create-item-tracking"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 bg-white"
                value={trackingStrategy}
                onChange={(e) =>
                  setTrackingStrategy(e.target.value as TrackingStrategy)
                }
              >
                <option value="quantity">Theo số lượng / Quantity</option>
                <option value="serialized">Theo số sê-ri / Serialized</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="create-item-return"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Cơ chế hoàn trả
              </label>
              <select
                id="create-item-return"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 bg-white"
                value={returnSemantics}
                onChange={(e) =>
                  setReturnSemantics(e.target.value as ReturnSemantics)
                }
              >
                <option value="nonreturnable">
                  Không hoàn trả / Consumable
                </option>
                <option value="returnable">Có thể hoàn trả / Returnable</option>
                <option value="in_place">Sử dụng tại chỗ / In-place</option>
              </select>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <label
              htmlFor="create-item-expiry"
              className="flex items-start gap-2.5 cursor-pointer"
            >
              <input
                id="create-item-expiry"
                type="checkbox"
                className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                checked={effectiveExpiryRequired}
                disabled={materialKind === "chemical"}
                onChange={(e) => setExpiryRequired(e.target.checked)}
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-800 block">
                  Bắt buộc có Hạn sử dụng (Expiry Date)
                </span>
                <span className="text-slate-500 text-[11px]">
                  {materialKind === "chemical"
                    ? "Vật tư hóa chất bắt buộc phải có HSD theo chính sách an toàn O01."
                    : "Nếu bật, khi nhận kho bắt buộc phải nhập ngày hoặc tháng hết hạn."}
                </span>
              </div>
            </label>
          </div>

          {error ? (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={onClose}
              disabled={isPending}
            >
              Hủy bỏ / Cancel
            </button>
            <button
              type="submit"
              className="button button-primary text-xs"
              disabled={isPending}
            >
              {isPending ? "Đang tạo..." : "Lưu vật tư mới"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Edit Item
// -----------------------------------------------------------------------------
function EditItemDialog({
  item,
  onClose,
  onUpdated,
}: {
  item: InventoryCatalogItem;
  onClose: () => void;
  onUpdated: (item: InventoryCatalogItem) => void;
}) {
  const [name, setName] = useState(item.name);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Tên vật tư không được để trống / Name is required");
      return;
    }

    startTransition(async () => {
      const res = await updateItemAction({
        id: item.id,
        expected_revision: item.revision,
        name: name.trim(),
      });

      if (res.ok && res.data) {
        onUpdated({
          ...item,
          name: name.trim(),
          revision: extractRevision(res.data) ?? item.revision,
        });
      } else {
        setError(res.error || "Lỗi cập nhật tên vật tư");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-item-dialog-title"
    >
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3
            id="edit-item-dialog-title"
            className="text-sm font-bold text-slate-900 uppercase tracking-wider"
          >
            Chỉnh sửa vật tư / Edit Item
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
            onClick={onClose}
            aria-label="Đóng / Close"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 space-y-1 text-xs border border-slate-100">
            <div className="flex justify-between">
              <span className="text-slate-500">Mã SKU:</span>
              <span className="font-mono font-bold text-slate-900">
                {item.code}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">ĐVT cơ sở:</span>
              <span className="font-medium text-slate-800">
                {item.base_uom_code}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Phiên bản:</span>
              <span className="font-mono text-slate-700">
                r{String(item.revision)}
              </span>
            </div>
          </div>

          <div>
            <label
              htmlFor="edit-item-name"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Tên vật tư <span className="text-red-500">*</span>
            </label>
            <input
              id="edit-item-name"
              type="text"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="p-2.5 bg-blue-50/60 border border-blue-200 rounded-lg text-[11px] text-blue-800 leading-relaxed">
            Ghi chú: Theo bất biến D01, Mã SKU, ĐVT cơ sở, Phân loại hóa chất và
            Cơ chế hoàn trả bị khóa bất biến sau khi phát sinh giao dịch nhận
            kho đầu tiên để đảm bảo toàn vẹn dữ liệu sổ cái.
          </div>

          {error ? (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={onClose}
              disabled={isPending}
            >
              Hủy bỏ / Cancel
            </button>
            <button
              type="submit"
              className="button button-primary text-xs"
              disabled={isPending}
            >
              {isPending ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Category Manager (Inline)
// -----------------------------------------------------------------------------
function CategoryManagerDialog({
  isAdmin,
  onClose,
}: {
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [cats, setCats] = useState<InventoryCategory[]>([]);
  const [catTotal, setCatTotal] = useState(0);
  const [catPage, setCatPage] = useState(1);
  const [catSearch, setCatSearch] = useState("");
  const [query, setQuery] = useState("");
  const catPageSize = 10;

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [targetCatForState, setTargetCatForState] = useState<{
    cat: InventoryCategory;
    targetActive: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadCategories = useCallback(async (p: number, q: string) => {
    try {
      const res = await readInventoryOptions<InventoryCategory>("categories", {
        q: q.trim() || undefined,
        page: p,
        page_size: catPageSize,
      });
      setCats(res.rows);
      setCatTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi tải nhóm vật tư");
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await readInventoryOptions<InventoryCategory>(
          "categories",
          {
            q: query.trim() || undefined,
            page: catPage,
            page_size: catPageSize,
          },
        );
        if (active) {
          setCats(res.rows);
          setCatTotal(res.total);
        }
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : "Lỗi tải nhóm vật tư");
      }
    })();
    return () => {
      active = false;
    };
  }, [catPage, query, catPageSize]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) {
      setError("Vui lòng nhập mã và tên nhóm / Code and name are required");
      return;
    }

    startTransition(async () => {
      const res = await createCategoryAction({
        code: newCode.trim(),
        name: newName.trim(),
      });

      if (res.ok && res.data) {
        setNewCode("");
        setNewName("");
        setError(null);
        await loadCategories(1, query);
        setCatPage(1);
      } else {
        setError(res.error || "Lỗi tạo nhóm");
      }
    });
  }

  async function handleUpdateCategory(c: InventoryCategory) {
    if (!editName.trim()) {
      setError("Tên nhóm không được để trống / Name is required");
      return;
    }

    startTransition(async () => {
      const res = await updateCategoryAction({
        id: c.id,
        expected_revision: c.revision,
        name: editName.trim(),
      });

      if (res.ok && res.data) {
        setEditingCatId(null);
        setEditName("");
        setError(null);
        await loadCategories(catPage, query);
      } else {
        setError(res.error || "Lỗi cập nhật tên nhóm");
      }
    });
  }

  async function handleConfirmCategoryState(reason: string) {
    if (!targetCatForState) return;
    const { cat, targetActive } = targetCatForState;

    startTransition(async () => {
      const res = targetActive
        ? await reactivateCategoryAction({
            id: cat.id,
            expected_revision: cat.revision,
            reason,
          })
        : await inactivateCategoryAction({
            id: cat.id,
            expected_revision: cat.revision,
            reason,
          });

      if (res.ok && res.data) {
        setTargetCatForState(null);
        setError(null);
        await loadCategories(catPage, query);
      } else {
        setError(res.error || "Lỗi thay đổi trạng thái nhóm");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-manager-dialog-title"
    >
      <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3
            id="category-manager-dialog-title"
            className="text-sm font-bold text-slate-900 uppercase tracking-wider"
          >
            Quản lý nhóm vật tư / Categories
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
            onClick={onClose}
            aria-label="Đóng / Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Create new category */}
          <form
            onSubmit={handleCreate}
            className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3"
          >
            <span className="text-xs font-bold text-slate-800 block">
              Thêm nhóm mới / Add Category
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                id="create-category-code"
                aria-label="Mã nhóm / Category code"
                type="text"
                placeholder="Mã nhóm (VD: HOA_CHAT)"
                className="text-xs font-mono uppercase border border-slate-300 rounded p-2 focus:ring-1 focus:ring-blue-500"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                required
              />
              <input
                id="create-category-name"
                aria-label="Tên nhóm / Category name"
                type="text"
                placeholder="Tên nhóm (VD: Hóa chất & Thuốc thử)"
                className="text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-blue-500 sm:col-span-2"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="button button-primary text-xs"
                disabled={isPending}
              >
                {isPending ? "Đang thêm..." : "+ Thêm nhóm"}
              </button>
            </div>
          </form>
          {/* Search categories */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCatPage(1);
              setQuery(catSearch.trim());
            }}
            className="flex items-center gap-2"
          >
            <div className="relative flex-1">
              <Search
                className="absolute left-2.5 top-2 text-slate-400"
                size={14}
              />
              <input
                id="search-category"
                aria-label="Tìm kiếm nhóm vật tư"
                type="text"
                placeholder="Tìm mã hoặc tên nhóm…"
                className="w-full text-xs pl-8 pr-2.5 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500"
                value={catSearch}
                onChange={(e) => setCatSearch(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="button button-secondary text-xs px-3 py-1.5"
            >
              Tìm kiếm
            </button>
          </form>

          {error ? (
            <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          ) : null}

          {/* List of categories */}
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase text-[11px]">
                <th className="py-2 px-3">Mã</th>
                <th className="py-2 px-3">Tên nhóm</th>
                <th className="py-2 px-3">Trạng thái</th>
                <th className="py-2 px-3 text-center">Rev</th>
                <th className="py-2 px-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cats.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 px-3 font-mono font-bold text-slate-900">
                    {c.code}
                  </td>
                  <td className="py-2 px-3 font-medium text-slate-800">
                    {editingCatId === c.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          className="text-xs border border-blue-400 rounded px-2 py-1 w-full"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          aria-label={`Tên nhóm mới cho mã ${c.code}`}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded"
                          onClick={() => handleUpdateCategory(c)}
                          disabled={isPending}
                        >
                          Lưu
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 rounded"
                          onClick={() => {
                            setEditingCatId(null);
                            setEditName("");
                          }}
                          disabled={isPending}
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      c.name
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <ActiveBadge active={c.active} />
                  </td>
                  <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-400">
                    r{String(c.revision)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      {editingCatId !== c.id ? (
                        <button
                          type="button"
                          className="px-2 py-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                          onClick={() => {
                            setEditingCatId(c.id);
                            setEditName(c.name);
                            setError(null);
                          }}
                          disabled={isPending}
                          aria-label={`Sửa tên nhóm ${c.code}`}
                        >
                          Sửa
                        </button>
                      ) : null}
                      {isAdmin ? (
                        <button
                          type="button"
                          className={`px-2 py-1 text-[11px] font-semibold rounded ${
                            c.active
                              ? "text-red-600 hover:text-red-800 hover:bg-red-50"
                              : "text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50"
                          }`}
                          onClick={() => {
                            setTargetCatForState({
                              cat: c,
                              targetActive: !c.active,
                            });
                            setError(null);
                          }}
                          disabled={isPending}
                          aria-label={
                            c.active
                              ? `Vô hiệu hóa nhóm ${c.code}`
                              : `Kích hoạt lại nhóm ${c.code}`
                          }
                        >
                          {c.active ? "Vô hiệu hóa" : "Kích hoạt"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-slate-500">
              Tổng cộng: {catTotal} nhóm
            </span>
            <PaginationControls
              currentPage={catPage}
              totalItems={catTotal}
              pageSize={catPageSize}
              onPageChange={(p) => setCatPage(p)}
            />
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            className="button button-secondary text-xs"
            onClick={onClose}
          >
            Đóng / Close
          </button>
        </div>
      </div>

      {targetCatForState ? (
        <ConfirmActionModal
          open={Boolean(targetCatForState)}
          title={
            targetCatForState.targetActive
              ? "Kích hoạt lại nhóm vật tư / Reactivate Category"
              : "Vô hiệu hóa nhóm vật tư / Inactivate Category"
          }
          description={
            targetCatForState.targetActive
              ? "Nhóm vật tư sẽ được kích hoạt lại và có thể chọn cho vật tư mới."
              : "Nhóm vật tư này sẽ bị vô hiệu hóa và không thể chọn cho vật tư mới. Các vật tư hiện có thuộc nhóm này vẫn được bảo lưu đầy đủ."
          }
          targetName={`${targetCatForState.cat.code} - ${targetCatForState.cat.name}`}
          currentRevision={targetCatForState.cat.revision}
          actionLabel={
            targetCatForState.targetActive
              ? "Kích hoạt lại / Reactivate"
              : "Vô hiệu hóa / Inactivate"
          }
          actionVariant={targetCatForState.targetActive ? "primary" : "danger"}
          isPending={isPending}
          onConfirm={handleConfirmCategoryState}
          onClose={() => setTargetCatForState(null)}
        />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: UOM Manager (Inline)
// -----------------------------------------------------------------------------
function UomManagerDialog({
  isAdmin,
  onClose,
}: {
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [uomList, setUomList] = useState<InventoryUom[]>([]);
  const [uomTotal, setUomTotal] = useState(0);
  const [uomPage, setUomPage] = useState(1);
  const [uomSearch, setUomSearch] = useState("");
  const [query, setQuery] = useState("");
  const uomPageSize = 10;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [dimension, setDimension] = useState<UomDimension>("count");
  const [allowedScale, setAllowedScale] = useState(0);
  const [editingUomCode, setEditingUomCode] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [targetUomForState, setTargetUomForState] = useState<{
    uom: InventoryUom;
    targetActive: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadUoms = useCallback(async (p: number, q: string) => {
    try {
      const res = await readInventoryOptions<InventoryUom>("uoms", {
        q: q.trim() || undefined,
        page: p,
        page_size: uomPageSize,
      });
      setUomList(res.rows);
      setUomTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi tải đơn vị tính");
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await readInventoryOptions<InventoryUom>("uoms", {
          q: query.trim() || undefined,
          page: uomPage,
          page_size: uomPageSize,
        });
        if (active) {
          setUomList(res.rows);
          setUomTotal(res.total);
        }
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : "Lỗi tải đơn vị tính");
      }
    })();
    return () => {
      active = false;
    };
  }, [uomPage, query, uomPageSize]);

  async function handleCreateUom(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin) {
      setError(
        "Chỉ Quản trị viên (Admin) mới có quyền tạo đơn vị tính / Admin only",
      );
      return;
    }
    if (!code.trim() || !name.trim()) {
      setError("Vui lòng nhập mã và tên ĐVT / Code and name are required");
      return;
    }

    startTransition(async () => {
      const res = await createUomAction({
        code: code.trim(),
        name: name.trim(),
        dimension,
        allowed_scale: allowedScale,
      });

      if (res.ok && res.data) {
        setCode("");
        setName("");
        setError(null);
        await loadUoms(1, query);
        setUomPage(1);
      } else {
        setError(res.error || "Lỗi tạo ĐVT mới");
      }
    });
  }

  async function handleUpdateUom(u: InventoryUom) {
    if (!isAdmin) {
      setError("Chỉ Quản trị viên mới có quyền cập nhật ĐVT / Admin only");
      return;
    }
    if (!editName.trim()) {
      setError("Tên ĐVT không được để trống / Name is required");
      return;
    }

    startTransition(async () => {
      const res = await updateUomAction({
        code: u.code,
        expected_revision: u.revision,
        name: editName.trim(),
      });

      if (res.ok && res.data) {
        setEditingUomCode(null);
        setEditName("");
        setError(null);
        await loadUoms(uomPage, query);
      } else {
        setError(res.error || "Lỗi cập nhật ĐVT");
      }
    });
  }

  async function handleConfirmUomState(reason: string) {
    if (!targetUomForState) return;
    const { uom, targetActive } = targetUomForState;

    startTransition(async () => {
      const res = targetActive
        ? await reactivateUomAction({
            code: uom.code,
            expected_revision: uom.revision,
            reason,
          })
        : await inactivateUomAction({
            code: uom.code,
            expected_revision: uom.revision,
            reason,
          });

      if (res.ok && res.data) {
        setTargetUomForState(null);
        setError(null);
        await loadUoms(uomPage, query);
      } else {
        setError(res.error || "Lỗi thay đổi trạng thái ĐVT");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="uom-manager-dialog-title"
    >
      <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3
            id="uom-manager-dialog-title"
            className="text-sm font-bold text-slate-900 uppercase tracking-wider"
          >
            Đơn vị tính / Units of Measure (UOM)
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
            onClick={onClose}
            aria-label="Đóng / Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          {isAdmin ? (
            <form
              onSubmit={handleCreateUom}
              className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3"
            >
              <span className="text-xs font-bold text-slate-800 block">
                Thêm ĐVT mới (Admin Only)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input
                  id="create-uom-code"
                  aria-label="Mã ĐVT / UOM Code"
                  type="text"
                  placeholder="Mã (VD: mL, g, box)"
                  className="text-xs font-mono border border-slate-300 rounded p-2 focus:ring-1 focus:ring-blue-500"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
                <input
                  id="create-uom-name"
                  aria-label="Tên ĐVT / UOM Name"
                  type="text"
                  placeholder="Tên (VD: Mililit, Hộp)"
                  className="text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-blue-500"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <select
                  id="create-uom-dimension"
                  aria-label="Thứ nguyên ĐVT / Dimension"
                  className="text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-blue-500 bg-white"
                  value={dimension}
                  onChange={(e) => {
                    const dim = e.target.value as UomDimension;
                    setDimension(dim);
                    if (dim === "count" || dim === "package")
                      setAllowedScale(0);
                  }}
                >
                  <option value="count">Đếm / Count (scale 0)</option>
                  <option value="volume">Thể tích / Volume</option>
                  <option value="mass">Khối lượng / Mass</option>
                  <option value="package">Đóng gói / Package</option>
                </select>
                <input
                  id="create-uom-scale"
                  aria-label="Độ chính xác thập phân / Allowed scale"
                  type="number"
                  min={0}
                  max={6}
                  placeholder="Độ chính xác (0-6)"
                  className="text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-blue-500"
                  value={allowedScale}
                  disabled={dimension === "count" || dimension === "package"}
                  onChange={(e) => setAllowedScale(Number(e.target.value))}
                  required
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="button button-primary text-xs"
                  disabled={isPending}
                >
                  {isPending ? "Đang thêm..." : "+ Thêm ĐVT"}
                </button>
              </div>
            </form>
          ) : (
            <div className="p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs">
              Cấu hình và thêm mới Đơn vị tính là chức năng dành riêng cho Quản
              trị viên (Admin).
            </div>
          )}
          {/* Search UOMs */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setUomPage(1);
              setQuery(uomSearch.trim());
            }}
            className="flex items-center gap-2"
          >
            <div className="relative flex-1">
              <Search
                className="absolute left-2.5 top-2 text-slate-400"
                size={14}
              />
              <input
                id="search-uom"
                aria-label="Tìm kiếm đơn vị tính"
                type="text"
                placeholder="Tìm mã hoặc tên ĐVT…"
                className="w-full text-xs pl-8 pr-2.5 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500"
                value={uomSearch}
                onChange={(e) => setUomSearch(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="button button-secondary text-xs px-3 py-1.5"
            >
              Tìm kiếm
            </button>
          </form>

          {error ? (
            <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          ) : null}

          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase text-[11px]">
                <th className="py-2 px-3">Mã ĐVT</th>
                <th className="py-2 px-3">Tên</th>
                <th className="py-2 px-3">Thứ nguyên / Dimension</th>
                <th className="py-2 px-3 text-center">Thập phân (Scale)</th>
                <th className="py-2 px-3">Trạng thái</th>
                <th className="py-2 px-3 text-center">Rev</th>
                <th className="py-2 px-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {uomList.map((u) => (
                <tr key={u.code}>
                  <td className="py-2 px-3 font-mono font-bold text-slate-900">
                    {u.code}
                  </td>
                  <td className="py-2 px-3 font-medium text-slate-800">
                    {editingUomCode === u.code ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          className="text-xs border border-blue-400 rounded px-2 py-1 w-full"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          aria-label={`Tên ĐVT mới cho mã ${u.code}`}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded"
                          onClick={() => handleUpdateUom(u)}
                          disabled={isPending}
                        >
                          Lưu
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 rounded"
                          onClick={() => {
                            setEditingUomCode(null);
                            setEditName("");
                          }}
                          disabled={isPending}
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      u.name
                    )}
                  </td>
                  <td className="py-2 px-3 text-slate-600 capitalize">
                    {u.dimension}
                  </td>
                  <td className="py-2 px-3 text-center font-mono font-semibold">
                    {u.allowed_scale}
                  </td>
                  <td className="py-2 px-3">
                    <ActiveBadge active={u.active} />
                  </td>
                  <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-400">
                    r{String(u.revision)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {isAdmin ? (
                      <div className="flex items-center justify-end gap-1.5">
                        {editingUomCode !== u.code ? (
                          <button
                            type="button"
                            className="px-2 py-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                            onClick={() => {
                              setEditingUomCode(u.code);
                              setEditName(u.name);
                              setError(null);
                            }}
                            disabled={isPending}
                            aria-label={`Sửa tên ĐVT ${u.code}`}
                          >
                            Sửa
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={`px-2 py-1 text-[11px] font-semibold rounded ${
                            u.active
                              ? "text-red-600 hover:text-red-800 hover:bg-red-50"
                              : "text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50"
                          }`}
                          onClick={() => {
                            setTargetUomForState({
                              uom: u,
                              targetActive: !u.active,
                            });
                            setError(null);
                          }}
                          disabled={isPending}
                          aria-label={
                            u.active
                              ? `Vô hiệu hóa ĐVT ${u.code}`
                              : `Kích hoạt lại ĐVT ${u.code}`
                          }
                        >
                          {u.active ? "Vô hiệu hóa" : "Kích hoạt"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-slate-500">
              Tổng cộng: {uomTotal} đơn vị tính
            </span>
            <PaginationControls
              currentPage={uomPage}
              totalItems={uomTotal}
              pageSize={uomPageSize}
              onPageChange={(p) => setUomPage(p)}
            />
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            className="button button-secondary text-xs"
            onClick={onClose}
          >
            Đóng / Close
          </button>
        </div>
      </div>

      {targetUomForState ? (
        <ConfirmActionModal
          open={Boolean(targetUomForState)}
          title={
            targetUomForState.targetActive
              ? "Kích hoạt lại đơn vị tính / Reactivate UOM"
              : "Vô hiệu hóa đơn vị tính / Inactivate UOM"
          }
          description={
            targetUomForState.targetActive
              ? "Đơn vị tính sẽ được kích hoạt lại và có thể chọn cho vật tư mới."
              : "Đơn vị tính này sẽ bị vô hiệu hóa và không thể chọn cho vật tư mới. Dữ liệu lịch sử và tồn kho hiện hành vẫn được bảo lưu đầy đủ."
          }
          targetName={`${targetUomForState.uom.code} - ${targetUomForState.uom.name}`}
          currentRevision={targetUomForState.uom.revision}
          actionLabel={
            targetUomForState.targetActive
              ? "Kích hoạt lại / Reactivate"
              : "Vô hiệu hóa / Inactivate"
          }
          actionVariant={targetUomForState.targetActive ? "primary" : "danger"}
          isPending={isPending}
          onConfirm={handleConfirmUomState}
          onClose={() => setTargetUomForState(null)}
        />
      ) : null}
    </div>
  );
}
