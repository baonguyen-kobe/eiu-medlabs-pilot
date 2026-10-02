"use client";

import React, { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, X } from "@/components/icons";
import {
  createSupplierAction,
  inactivateSupplierAction,
  reactivateSupplierAction,
  updateSupplierAction,
} from "@/app/inventory/actions";
import { ActiveBadge } from "./status-badge";
import { ConfirmActionModal } from "./confirm-action-modal";
import { PaginationControls } from "@/components/pagination-controls";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type { InventorySupplier } from "@/lib/inventory/types";

export function SuppliersView({
  initialSuppliers,
  total,
  currentPage = 1,
  pageSize = TABLE_PAGE_SIZE,
  currentQ = "",
  currentActive = "all",
  currentSort: _currentSort = "",
  isAdmin,
}: {
  initialSuppliers: InventorySupplier[];
  total: number;
  currentPage?: number;
  pageSize?: number;
  currentQ?: string;
  currentActive?: string;
  currentSort?: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [suppliers, setSuppliers] =
    useState<InventorySupplier[]>(initialSuppliers);
  const [search, setSearch] = useState(currentQ);
  const [activeFilter, setActiveFilter] = useState(currentActive);

  const [prevProps, setPrevProps] = useState({
    suppliers: initialSuppliers,
    q: currentQ,
    active: currentActive,
  });
  if (
    prevProps.suppliers !== initialSuppliers ||
    prevProps.q !== currentQ ||
    prevProps.active !== currentActive
  ) {
    setPrevProps({
      suppliers: initialSuppliers,
      q: currentQ,
      active: currentActive,
    });
    setSuppliers(initialSuppliers);
    setSearch(currentQ);
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

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [editSupplier, setEditSupplier] = useState<InventorySupplier | null>(
    null,
  );
  const [targetStateChange, setTargetStateChange] = useState<{
    supplier: InventorySupplier;
    targetActive: boolean;
  } | null>(null);

  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateParams({ q: search.trim() || undefined, page: undefined });
  }

  function handleActiveChange(val: string) {
    setActiveFilter(val);
    updateParams({ active: val === "all" ? undefined : val, page: undefined });
  }
  async function handleConfirmStateChange(reason: string) {
    if (!targetStateChange) return;
    const { supplier, targetActive } = targetStateChange;

    startTransition(async () => {
      const res = targetActive
        ? await reactivateSupplierAction({
            id: supplier.id,
            expected_revision: supplier.revision,
            reason,
          })
        : await inactivateSupplierAction({
            id: supplier.id,
            expected_revision: supplier.revision,
            reason,
          });

      if (res.ok) {
        setSuppliers((prev) =>
          prev.map((s) =>
            s.id === supplier.id
              ? {
                  ...s,
                  active: targetActive,
                  revision: res.data?.revision || Number(s.revision) + 1,
                }
              : s,
          ),
        );
        setNotice({
          ok: true,
          message: targetActive
            ? `Đã kích hoạt lại nhà cung cấp ${supplier.name}`
            : `Đã ngừng hoạt động nhà cung cấp ${supplier.name}`,
        });
        router.refresh();
      } else {
        setNotice({ ok: false, message: res.error || "Thao tác thất bại" });
      }
      setTargetStateChange(null);
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

      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="button button-primary text-xs"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={15} /> Thêm nhà cung cấp mới / Add Supplier
          </button>
        </div>
        <span className="text-xs text-slate-500">
          Tổng cộng: <strong>{total}</strong> nhà cung cấp
        </span>
      </div>

      {/* Filter toolbar */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                id="suppliers-search"
                aria-label="Tìm theo tên, mã số thuế, liên hệ / Search Supplier"
                type="text"
                className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Tìm theo tên, mã số thuế, liên hệ..."
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

          <div>
            <select
              id="suppliers-active-filter"
              aria-label="Lọc theo trạng thái / Filter by Status"
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
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
      {/* Suppliers Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Tên nhà cung cấp / Name</th>
                <th className="py-3 px-4">Mã số thuế / Tax</th>
                <th className="py-3 px-4">Thông tin liên hệ / Contact</th>
                <th className="py-3 px-4">Ghi chú / Notes</th>
                <th className="py-3 px-4">Trạng thái / Status</th>
                <th className="py-3 px-4 text-center">Bản / Rev</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    Chưa có nhà cung cấp nào phù hợp.
                  </td>
                </tr>
              ) : (
                suppliers.map((s) => (
                  <tr
                    key={s.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 px-4 font-bold text-slate-900">
                      {s.name}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700">
                      {s.tax_code || "—"}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {s.contact || "—"}
                    </td>
                    <td className="py-3 px-4 text-slate-500 max-w-xs truncate">
                      {s.notes || "—"}
                    </td>
                    <td className="py-3 px-4">
                      <ActiveBadge active={s.active} />
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-[11px] text-slate-400">
                      r{String(s.revision)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          className="px-2 py-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                          onClick={() => setEditSupplier(s)}
                        >
                          Sửa
                        </button>
                        {isAdmin ? (
                          s.active ? (
                            <button
                              type="button"
                              className="px-2 py-1 text-[11px] font-semibold text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded"
                              onClick={() =>
                                setTargetStateChange({
                                  supplier: s,
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
                                setTargetStateChange({
                                  supplier: s,
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

        <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Hiển thị {suppliers.length} trên tổng số {total} nhà cung cấp
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
      {/* Modal 1: Create Supplier */}
      {/* ========================================================================= */}
      {createOpen ? (
        <CreateSupplierDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setSuppliers((prev) => [created, ...prev]);
            setNotice({
              ok: true,
              message: `Thêm nhà cung cấp ${created.name} thành công!`,
            });
            setCreateOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 2: Edit Supplier */}
      {/* ========================================================================= */}
      {editSupplier ? (
        <EditSupplierDialog
          supplier={editSupplier}
          onClose={() => setEditSupplier(null)}
          onUpdated={(updated) => {
            setSuppliers((prev) =>
              prev.map((s) => (s.id === updated.id ? updated : s)),
            );
            setNotice({
              ok: true,
              message: `Cập nhật nhà cung cấp ${updated.name} thành công!`,
            });
            setEditSupplier(null);
            router.refresh();
          }}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 3: Inactivate / Reactivate Supplier */}
      {/* ========================================================================= */}
      {targetStateChange ? (
        <ConfirmActionModal
          open={Boolean(targetStateChange)}
          title={
            targetStateChange.targetActive
              ? "Kích hoạt lại nhà cung cấp"
              : "Ngừng hoạt động nhà cung cấp"
          }
          description={
            targetStateChange.targetActive
              ? "Nhà cung cấp sẽ có thể được chọn lại khi tạo hồ sơ nguồn mới."
              : "Nhà cung cấp sẽ không còn được chọn cho các hồ sơ nguồn mới, nhưng toàn bộ lịch sử và hợp đồng cũ vẫn được bảo lưu nguyên vẹn."
          }
          targetName={targetStateChange.supplier.name}
          currentRevision={targetStateChange.supplier.revision}
          actionLabel={
            targetStateChange.targetActive
              ? "Xác nhận kích hoạt"
              : "Xác nhận ngừng hoạt động"
          }
          actionVariant={targetStateChange.targetActive ? "primary" : "danger"}
          isPending={isPending}
          onConfirm={handleConfirmStateChange}
          onClose={() => setTargetStateChange(null)}
        />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Create Supplier
// -----------------------------------------------------------------------------
function CreateSupplierDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (s: InventorySupplier) => void;
}) {
  const [name, setName] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Tên nhà cung cấp là bắt buộc");
      return;
    }

    startTransition(async () => {
      const res = await createSupplierAction({
        name: name.trim(),
        tax_code: taxCode.trim() || undefined,
        contact: contact.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      if (res.ok && res.data) {
        onCreated({
          id: res.data.id,
          name: name.trim(),
          tax_code: taxCode.trim() || null,
          contact: contact.trim() || null,
          notes: notes.trim() || null,
          active: true,
          revision: res.data.revision || 1,
        });
      } else {
        setError(res.error || "Lỗi tạo nhà cung cấp");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-supplier-dialog-title"
    >
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3
            id="create-supplier-dialog-title"
            className="text-sm font-bold text-slate-900 uppercase tracking-wider"
          >
            Thêm nhà cung cấp mới
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div>
            <label
              htmlFor="create-supplier-name"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Tên nhà cung cấp <span className="text-red-500">*</span>
            </label>
            <input
              id="create-supplier-name"
              type="text"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              placeholder="VD: Công ty TNHH Thiết bị Y tế Minh Tâm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="create-supplier-tax"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Mã số thuế
              </label>
              <input
                id="create-supplier-tax"
                type="text"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder="0312345678"
                value={taxCode}
                onChange={(e) => setTaxCode(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="create-supplier-contact"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Liên hệ / ĐT
              </label>
              <input
                id="create-supplier-contact"
                type="text"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder="0901234567"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Ghi chú
            </label>
            <textarea
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="Địa chỉ, người liên hệ chính..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
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
              Hủy bỏ
            </button>
            <button
              type="submit"
              className="button button-primary text-xs"
              disabled={isPending}
            >
              {isPending ? "Đang lưu..." : "Lưu nhà cung cấp"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Edit Supplier
// -----------------------------------------------------------------------------
function EditSupplierDialog({
  supplier,
  onClose,
  onUpdated,
}: {
  supplier: InventorySupplier;
  onClose: () => void;
  onUpdated: (s: InventorySupplier) => void;
}) {
  const [name, setName] = useState(supplier.name);
  const [taxCode, setTaxCode] = useState(supplier.tax_code || "");
  const [contact, setContact] = useState(supplier.contact || "");
  const [notes, setNotes] = useState(supplier.notes || "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Tên nhà cung cấp không được để trống");
      return;
    }

    startTransition(async () => {
      const res = await updateSupplierAction({
        id: supplier.id,
        expected_revision: supplier.revision,
        name: name.trim(),
        tax_code: taxCode.trim() || undefined,
        contact: contact.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      if (res.ok) {
        onUpdated({
          ...supplier,
          name: name.trim(),
          tax_code: taxCode.trim() || null,
          contact: contact.trim() || null,
          notes: notes.trim() || null,
          revision: res.data?.revision || Number(supplier.revision) + 1,
        });
      } else {
        setError(res.error || "Lỗi cập nhật nhà cung cấp");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-supplier-dialog-title"
    >
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3
            id="edit-supplier-dialog-title"
            className="text-sm font-bold text-slate-900 uppercase tracking-wider"
          >
            Sửa nhà cung cấp / Edit Supplier
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div>
            <label
              htmlFor="edit-supplier-name"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Tên nhà cung cấp <span className="text-red-500">*</span>
            </label>
            <input
              id="edit-supplier-name"
              type="text"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="edit-supplier-tax"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Mã số thuế
              </label>
              <input
                id="edit-supplier-tax"
                type="text"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={taxCode}
                onChange={(e) => setTaxCode(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="edit-supplier-contact"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Liên hệ / ĐT
              </label>
              <input
                id="edit-supplier-contact"
                type="text"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Ghi chú
            </label>
            <textarea
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
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
              Hủy bỏ
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
