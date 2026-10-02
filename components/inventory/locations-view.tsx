"use client";

import React, { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, X } from "@/components/icons";
import {
  createLocationAction,
  inactivateLocationAction,
  reactivateLocationAction,
  updateLocationAction,
} from "@/app/inventory/actions";
import { ActiveBadge } from "./status-badge";
import { ConfirmActionModal } from "./confirm-action-modal";
import { PaginationControls } from "@/components/pagination-controls";
import { InventoryLookup } from "./inventory-lookup";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type { InventoryStorageLocation } from "@/lib/inventory/types";

export function LocationsView({
  initialLocations,
  total,
  currentPage = 1,
  pageSize = TABLE_PAGE_SIZE,
  currentQ = "",
  currentActive = "all",
  currentSort: _currentSort = "",
  rooms,
  isAdmin,
}: {
  initialLocations: InventoryStorageLocation[];
  total: number;
  currentPage?: number;
  pageSize?: number;
  currentQ?: string;
  currentActive?: string;
  currentSort?: string;
  rooms: Array<{ id: string; room_code: string; building_code?: string }>;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [locations, setLocations] =
    useState<InventoryStorageLocation[]>(initialLocations);
  const [search, setSearch] = useState(currentQ);
  const [activeFilter, setActiveFilter] = useState(currentActive);

  const [prevProps, setPrevProps] = useState({
    locations: initialLocations,
    q: currentQ,
    active: currentActive,
  });
  if (
    prevProps.locations !== initialLocations ||
    prevProps.q !== currentQ ||
    prevProps.active !== currentActive
  ) {
    setPrevProps({
      locations: initialLocations,
      q: currentQ,
      active: currentActive,
    });
    setLocations(initialLocations);
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
  const [editLocation, setEditLocation] =
    useState<InventoryStorageLocation | null>(null);
  const [targetStateChange, setTargetStateChange] = useState<{
    location: InventoryStorageLocation;
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
    const { location, targetActive } = targetStateChange;

    startTransition(async () => {
      const res = targetActive
        ? await reactivateLocationAction({
            id: location.id,
            expected_revision: location.revision,
            reason,
          })
        : await inactivateLocationAction({
            id: location.id,
            expected_revision: location.revision,
            reason,
          });

      if (res.ok) {
        setLocations((prev) =>
          prev.map((l) =>
            l.id === location.id
              ? {
                  ...l,
                  active: targetActive,
                  revision: res.data?.revision || Number(l.revision) + 1,
                }
              : l,
          ),
        );
        setNotice({
          ok: true,
          message: targetActive
            ? `Đã kích hoạt lại vị trí ${location.code}`
            : `Đã ngừng hoạt động vị trí ${location.code}`,
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
            <Plus size={15} /> Thêm vị trí kho mới / Add Location
          </button>
        </div>
        <span className="text-xs text-slate-500">
          Tổng cộng: <strong>{total}</strong> vị trí lưu kho
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
                id="locations-search"
                aria-label="Tìm theo mã vị trí, tên, phòng / Search Location"
                type="text"
                className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Tìm theo mã vị trí, tên, phòng..."
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
              id="locations-active-filter"
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
      {/* Locations Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Mã vị trí / Code</th>
                <th className="py-3 px-4">Tên vị trí kho / Name</th>
                <th className="py-3 px-4">Vị trí cha / Parent</th>
                <th className="py-3 px-4">Phòng thực hành / Room</th>
                <th className="py-3 px-4">Trạng thái / Status</th>
                <th className="py-3 px-4 text-center">Bản / Rev</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {locations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    Chưa có vị trí lưu kho nào phù hợp.
                  </td>
                </tr>
              ) : (
                locations.map((loc) => {
                  const parentLoc = locations.find(
                    (l) => l.id === loc.parent_location_id,
                  );
                  const room = rooms.find((r) => r.id === loc.room_id);
                  return (
                    <tr
                      key={loc.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        {loc.code}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800">
                        {loc.name}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {parentLoc
                          ? `${parentLoc.name} (${parentLoc.code})`
                          : loc.parent_location_name
                            ? loc.parent_location_name
                            : "— (Cấp gốc)"}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {room ? room.room_code : loc.room_code || "—"}
                      </td>
                      <td className="py-3 px-4">
                        <ActiveBadge active={loc.active} />
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-[11px] text-slate-400">
                        r{String(loc.revision)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            className="px-2 py-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                            onClick={() => setEditLocation(loc)}
                          >
                            Sửa
                          </button>
                          {isAdmin ? (
                            loc.active ? (
                              <button
                                type="button"
                                className="px-2 py-1 text-[11px] font-semibold text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded"
                                onClick={() =>
                                  setTargetStateChange({
                                    location: loc,
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
                                    location: loc,
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Hiển thị {locations.length} trên tổng số {total} vị trí
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
      {/* Modal 1: Create Location */}
      {/* ========================================================================= */}
      {createOpen ? (
        <CreateLocationDialog
          rooms={rooms}
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setLocations((prev) => [created, ...prev]);
            setNotice({
              ok: true,
              message: `Thêm vị trí ${created.name} thành công!`,
            });
            setCreateOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 2: Edit Location */}
      {/* ========================================================================= */}
      {editLocation ? (
        <EditLocationDialog
          location={editLocation}
          rooms={rooms}
          onClose={() => setEditLocation(null)}
          onUpdated={(updated) => {
            setLocations((prev) =>
              prev.map((l) => (l.id === updated.id ? updated : l)),
            );
            setNotice({
              ok: true,
              message: `Cập nhật vị trí ${updated.name} thành công!`,
            });
            setEditLocation(null);
            router.refresh();
          }}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 3: Inactivate / Reactivate Location */}
      {/* ========================================================================= */}
      {targetStateChange ? (
        <ConfirmActionModal
          open={Boolean(targetStateChange)}
          title={
            targetStateChange.targetActive
              ? "Kích hoạt lại vị trí lưu kho"
              : "Ngừng hoạt động vị trí lưu kho"
          }
          description={
            targetStateChange.targetActive
              ? "Vị trí sẽ có thể được chọn lại khi tiếp nhận hoặc di chuyển kho mới."
              : "Vị trí sẽ không còn được chọn cho các nghiệp vụ nhận kho mới, nhưng toàn bộ lịch sử và số dư hàng đang tồn tại vị trí này vẫn được bảo lưu nguyên vẹn."
          }
          targetName={`${targetStateChange.location.code} - ${targetStateChange.location.name}`}
          currentRevision={targetStateChange.location.revision}
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
// Sub-dialog: Create Location
// -----------------------------------------------------------------------------
function CreateLocationDialog({
  rooms,
  onClose,
  onCreated,
}: {
  rooms: Array<{ id: string; room_code: string }>;
  onClose: () => void;
  onCreated: (loc: InventoryStorageLocation) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentLocationId, setParentLocationId] = useState("");
  const [selectedParentLabel, setSelectedParentLabel] = useState("");
  const [roomId, setRoomId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      setError("Mã và tên vị trí là bắt buộc");
      return;
    }

    startTransition(async () => {
      const res = await createLocationAction({
        code: code.trim(),
        name: name.trim(),
        parent_location_id: parentLocationId || undefined,
        room_id: roomId || undefined,
      });

      if (res.ok && res.data) {
        onCreated({
          id: res.data.id,
          code: code.trim().toUpperCase(),
          name: name.trim(),
          parent_location_id: parentLocationId || null,
          room_id: roomId || null,
          active: true,
          revision: res.data.revision || 1,
        });
      } else {
        setError(res.error || "Lỗi tạo vị trí kho");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-location-dialog-title"
    >
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3
            id="create-location-dialog-title"
            className="text-sm font-bold text-slate-900 uppercase tracking-wider"
          >
            Thêm vị trí kho mới / Create Location
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="create-location-code"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Mã vị trí <span className="text-red-500">*</span>
              </label>
              <input
                id="create-location-code"
                type="text"
                className="w-full text-xs font-mono uppercase border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder="VD: KHO-CHINH-K1"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor="create-location-room"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Phòng thực hành liên kết
              </label>
              <select
                id="create-location-room"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 bg-white"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
              >
                <option value="">-- Không liên kết --</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.room_code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="create-location-name"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Tên vị trí kho <span className="text-red-500">*</span>
            </label>
            <input
              id="create-location-name"
              type="text"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              placeholder="VD: Kho chính - Kệ số 1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="create-location-parent"
                className="block text-xs font-semibold text-slate-700"
              >
                Vị trí cha (Phân cấp kho)
              </label>
              {parentLocationId ? (
                <button
                  type="button"
                  className="text-[11px] text-blue-600 hover:text-blue-800 underline"
                  onClick={() => {
                    setParentLocationId("");
                    setSelectedParentLabel("");
                  }}
                >
                  Xóa / Đặt về cấp gốc
                </button>
              ) : null}
            </div>
            <InventoryLookup<InventoryStorageLocation>
              resource="locations"
              filters={{ active: true }}
              value={parentLocationId}
              valueKey="id"
              label="Vị trí cha (Phân cấp kho)"
              id="create-location-parent"
              selectedLabel={selectedParentLabel}
              placeholder="-- Vị trí cấp gốc (Root level) hoặc tìm vị trí cha --"
              hideLabel={true}
              onSelect={(loc) => {
                setParentLocationId(loc.id);
                setSelectedParentLabel(`${loc.name} (${loc.code})`);
              }}
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
              {isPending ? "Đang lưu..." : "Lưu vị trí kho"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Edit Location
// -----------------------------------------------------------------------------
function EditLocationDialog({
  location,
  rooms,
  onClose,
  onUpdated,
}: {
  location: InventoryStorageLocation;
  rooms: Array<{ id: string; room_code: string }>;
  onClose: () => void;
  onUpdated: (loc: InventoryStorageLocation) => void;
}) {
  const [name, setName] = useState(location.name);
  const [parentLocationId, setParentLocationId] = useState(
    location.parent_location_id || "",
  );
  const [selectedParentLabel, setSelectedParentLabel] = useState(
    location.parent_location_name ? location.parent_location_name : "",
  );
  const [roomId, setRoomId] = useState(location.room_id || "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Tên vị trí không được để trống");
      return;
    }

    if (parentLocationId && parentLocationId === location.id) {
      setError("Vị trí không thể tự làm cha của chính nó (Chu kỳ phân cấp)");
      return;
    }

    startTransition(async () => {
      const res = await updateLocationAction({
        id: location.id,
        expected_revision: location.revision,
        name: name.trim(),
        parent_location_id: parentLocationId || undefined,
        room_id: roomId || undefined,
      });

      if (res.ok) {
        onUpdated({
          ...location,
          name: name.trim(),
          parent_location_id: parentLocationId || null,
          room_id: roomId || null,
          revision: res.data?.revision || Number(location.revision) + 1,
        });
      } else {
        setError(res.error || "Lỗi cập nhật vị trí");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-location-dialog-title"
    >
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3
            id="edit-location-dialog-title"
            className="text-sm font-bold text-slate-900 uppercase tracking-wider"
          >
            Sửa vị trí kho / Edit Location
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
          <div className="rounded-lg bg-slate-50 p-2.5 text-xs border border-slate-100 flex justify-between">
            <span className="text-slate-500">Mã vị trí (Bất biến):</span>
            <span className="font-mono font-bold text-slate-900">
              {location.code}
            </span>
          </div>

          <div>
            <label
              htmlFor="edit-location-name"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Tên vị trí kho <span className="text-red-500">*</span>
            </label>
            <input
              id="edit-location-name"
              type="text"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="edit-location-parent"
                className="block text-xs font-semibold text-slate-700"
              >
                Vị trí cha (Acyclic guard)
              </label>
              {parentLocationId ? (
                <button
                  type="button"
                  className="text-[11px] text-blue-600 hover:text-blue-800 underline"
                  onClick={() => {
                    setParentLocationId("");
                    setSelectedParentLabel("");
                  }}
                >
                  Xóa / Đặt về cấp gốc
                </button>
              ) : null}
            </div>
            <InventoryLookup<InventoryStorageLocation>
              resource="locations"
              filters={{ active: true }}
              value={parentLocationId}
              valueKey="id"
              label="Vị trí cha (Acyclic guard)"
              id="edit-location-parent"
              selectedLabel={selectedParentLabel}
              placeholder="-- Vị trí cấp gốc (Root level) hoặc tìm vị trí cha --"
              hideLabel={true}
              onSelect={(loc) => {
                if (loc.id === location.id) {
                  setError(
                    "Vị trí không thể tự làm cha của chính nó (Chu kỳ phân cấp)",
                  );
                  return;
                }
                setParentLocationId(loc.id);
                setSelectedParentLabel(`${loc.name} (${loc.code})`);
                setError(null);
              }}
            />
          </div>

          <div>
            <label
              htmlFor="edit-location-room"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Phòng thực hành liên kết
            </label>
            <select
              id="edit-location-room"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 bg-white"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            >
              <option value="">-- Không liên kết --</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.room_code}
                </option>
              ))}
            </select>
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
