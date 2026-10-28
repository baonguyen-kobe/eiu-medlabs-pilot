"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adjustBasicMedicalInventoryCondition,
  deleteBasicMedicalCatalogItems,
  saveBasicMedicalRoomInventory,
  searchBasicMedicalCatalogCandidates,
  setBasicMedicalCatalogActive,
  updateBasicMedicalCatalogItems,
  type BasicMedicalCatalogInput,
} from "@/app/basic-medical/equipment/actions";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type {
  BasicMedicalConditionLogItem,
  BasicMedicalEquipmentCatalogItem,
  BasicMedicalRoomInventoryItem,
} from "@/lib/basic-medical-equipment";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

type Tab = "inventory" | "rooms" | "damaged" | "logs";
type Room = {
  id: string;
  room_code: string;
  building_code: string;
  room_name: string | null;
};
type Notice = { ok: boolean; message: string } | null;

const logDateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

const conditionEventLabels = {
  damage_report: "Báo Hư",
  condition_adjustment: "Điều chỉnh Tốt/Hư",
  stock_adjustment: "Điều chỉnh tồn kho",
} as const;

function roomLabel(
  room?: Pick<Room, "room_code" | "building_code" | "room_name"> | null,
) {
  return room
    ? `${room.room_code}.${room.building_code}${room.room_name ? ` · ${room.room_name}` : ""}`
    : "—";
}

export function BasicMedicalEquipmentManager({
  activeTab,
  catalog,
  inventories,
  rooms,
  logs,
  canManage,
}: {
  activeTab: Tab;
  catalog: BasicMedicalEquipmentCatalogItem[];
  inventories: BasicMedicalRoomInventoryItem[];
  rooms: Room[];
  logs: BasicMedicalConditionLogItem[];
  canManage: boolean;
}) {
  return (
    <>
      {activeTab === "inventory" ? (
        <InventoryTab catalog={catalog} canManage={canManage} />
      ) : null}
      {activeTab === "rooms" ? (
        <RoomInventoryTab
          catalog={catalog}
          inventories={inventories}
          rooms={rooms}
          canManage={canManage}
        />
      ) : null}
      {activeTab === "damaged" ? (
        <DamagedTab
          inventories={inventories.filter((item) => item.damaged_quantity > 0)}
          canManage={canManage}
        />
      ) : null}
      {activeTab === "logs" ? <LogsTab logs={logs} /> : null}
    </>
  );
}

function InventoryTab({
  catalog: initialCatalog,
  canManage,
}: {
  catalog: BasicMedicalEquipmentCatalogItem[];
  canManage: boolean;
}) {
  const { text: uiText } = useLanguage();

  const router = useRouter();
  const [catalog, setCatalog] = useState(initialCatalog);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<
    Record<string, BasicMedicalEquipmentCatalogItem>
  >({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice>(null);
  const [isPending, startTransition] = useTransition();
  const [bulkAction, setBulkAction] = useState<
    "activate" | "deactivate" | "delete" | null
  >(null);

  function run(
    action: () => Promise<{ ok: boolean; message: string }>,
    after?: () => void,
  ) {
    startTransition(async () => {
      const result = await action();
      setNotice(result);
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  function applyBulkAction() {
    const selectedIds = [...selected];
    if (!bulkAction || !selectedIds.length) return;
    const action = bulkAction;
    run(
      () =>
        action === "delete"
          ? deleteBasicMedicalCatalogItems(selectedIds)
          : setBasicMedicalCatalogActive(selectedIds, action === "activate"),
      () => {
        setCatalog((rows) =>
          action === "delete"
            ? rows.filter((row) => !selectedIds.includes(row.id))
            : rows.map((row) =>
                selectedIds.includes(row.id)
                  ? { ...row, is_active: action === "activate" }
                  : row,
              ),
        );
        setSelected(new Set());
        setBulkAction(null);
      },
    );
  }

  return (
    <div className="basic-medical-equipment-content">
      {notice ? (
        <p
          className={
            notice.ok ? "action-feedback success" : "action-feedback error"
          }
        >
          <LocalizedText text={notice.message ?? ""} />
        </p>
      ) : null}
      <section className="data-panel equipment-catalog-panel basic-medical-catalog-panel">
        <div className="equipment-catalog-filters basic-medical-catalog-filters">
          <span className="equipment-catalog-count">
            {catalog.length}
            {uiText(" thiết bị")}
          </span>
        </div>
        {canManage ? (
          <div className="equipment-catalog-toolbar">
            <div className="equipment-catalog-mode-buttons">
              <button
                className={`button equipment-catalog-edit${editing ? " active" : ""}`}
                type="button"
                disabled={isPending}
                onClick={() => {
                  setEditing((value) => !value);
                  setDrafts(
                    Object.fromEntries(
                      catalog.map((item) => [item.id, { ...item }]),
                    ),
                  );
                  setSelected(new Set());
                }}
              >
                {uiText("Sửa")}
              </button>
              <button
                className="button equipment-catalog-disable"
                type="button"
                disabled={!selected.size || isPending}
                onClick={() => setBulkAction("deactivate")}
              >
                {uiText("Ngừng sử dụng")}
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={!selected.size || isPending}
                onClick={() => setBulkAction("activate")}
              >
                {uiText("Kích hoạt")}
              </button>
              <button
                className="button equipment-catalog-delete"
                type="button"
                disabled={!selected.size || isPending}
                onClick={() => setBulkAction("delete")}
              >
                {uiText("Xóa")}
              </button>
            </div>
          </div>
        ) : null}
        <ConfirmDialog
          open={bulkAction !== null}
          title={
            bulkAction === "deactivate"
              ? uiText("Ngừng sử dụng {0} thiết bị?", [selected.size])
              : bulkAction === "activate"
                ? uiText("Kích hoạt {0} thiết bị?", [selected.size])
                : uiText("Xóa {0} thiết bị?", [selected.size])
          }
          description={uiText(
            "Thao tác chỉ áp dụng đúng các thiết bị đã chọn.",
          )}
          confirmLabel={uiText("Xác nhận")}
          pending={isPending}
          onCancel={() => setBulkAction(null)}
          onConfirm={applyBulkAction}
        />
        <div className="responsive-table equipment-catalog-table-wrap">
          <table className="data-table basic-medical-catalog-table">
            <thead>
              <tr>
                {canManage ? (
                  <th aria-label={uiText("Chọn")}>
                    <input
                      aria-label={uiText("Chọn tất cả thiết bị trên trang")}
                      type="checkbox"
                      checked={
                        catalog.length > 0 &&
                        catalog.every((row) => selected.has(row.id))
                      }
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          catalog.forEach((row) =>
                            event.target.checked
                              ? next.add(row.id)
                              : next.delete(row.id),
                          );
                          return next;
                        })
                      }
                    />
                  </th>
                ) : null}
                <th>{uiText("Tên thiết bị và vật tư")}</th>
                <th>{uiText("Tên thương mại")}</th>
                <th>{uiText("Loại")}</th>
                <th>{uiText("Nước SX")}</th>
                <th>{uiText("Hãng")}</th>
                <th>{uiText("Model")}</th>
                <th>{uiText("ĐVT")}</th>
                <th>{uiText("Trạng thái")}</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((item) => {
                const draft = drafts[item.id] ?? item;
                return (
                  <tr key={item.id}>
                    {canManage ? (
                      <td>
                        <input
                          aria-label={uiText("Chọn {0}", [item.item_name])}
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              return next;
                            })
                          }
                        />
                      </td>
                    ) : null}
                    {(
                      [
                        "item_name",
                        "commercial_name",
                        "item_type",
                        "country_of_origin",
                        "manufacturer",
                        "model",
                        "unit",
                      ] as const
                    ).map((key) => (
                      <td key={key}>
                        {editing ? (
                          <input
                            aria-label={uiText("{0} của {1}", [
                              key,
                              item.item_name,
                            ])}
                            value={draft[key] ?? ""}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...draft,
                                  [key]: event.target.value,
                                },
                              }))
                            }
                          />
                        ) : (
                          item[key] || "—"
                        )}
                      </td>
                    ))}
                    <td>
                      <span
                        className={`request-status request-status-${item.is_active ? "green" : "gray"}`}
                      >
                        {item.is_active
                          ? uiText("Đang sử dụng")
                          : uiText("Ngừng sử dụng")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!catalog.length ? (
          <p className="panel-empty">
            {uiText("Không có thiết bị phù hợp với bộ lọc hiện tại.")}
          </p>
        ) : null}
        {editing ? (
          <div className="form-actions">
            <button
              className="button button-primary"
              disabled={isPending}
              type="button"
              onClick={() => {
                const changed = catalog
                  .filter(
                    (item) =>
                      JSON.stringify(item) !== JSON.stringify(drafts[item.id]),
                  )
                  .map((item) => drafts[item.id] as BasicMedicalCatalogInput);
                run(
                  () => updateBasicMedicalCatalogItems(changed),
                  () => {
                    setCatalog(Object.values(drafts));
                    setEditing(false);
                  },
                );
              }}
            >
              {uiText("Lưu chỉnh sửa")}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function RoomInventoryTab({
  catalog,
  inventories,
  rooms,
  canManage,
}: {
  catalog: BasicMedicalEquipmentCatalogItem[];
  inventories: BasicMedicalRoomInventoryItem[];
  rooms: Room[];
  canManage: boolean;
}) {
  const { text: uiText } = useLanguage();

  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [isPending, startTransition] = useTransition();
  const [stockAdjustment, setStockAdjustment] =
    useState<BasicMedicalRoomInventoryItem | null>(null);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setNotice(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="basic-medical-equipment-content">
      {notice ? (
        <p
          className={
            notice.ok ? "action-feedback success" : "action-feedback error"
          }
          role="status"
        >
          <LocalizedText text={notice.message ?? ""} />
        </p>
      ) : null}
      <section className="data-panel basic-medical-room-inventory-section">
        <header className="panel-heading">
          <div>
            <h2>{uiText("Thiết bị theo phòng")}</h2>
            <p>
              {uiText(
                "Phân bổ số lượng Tổng, Tốt và Hư riêng cho từng phòng Y cơ sở.",
              )}
            </p>
          </div>
        </header>
        <div className="basic-medical-section-filters">
          <span className="equipment-catalog-count">
            {inventories.length}
            {uiText(" thiết bị trong phòng")}
          </span>
        </div>
        {canManage ? (
          <RoomInventoryForm
            rooms={rooms}
            catalog={catalog.filter((item) => item.is_active)}
            onSave={(input) => run(() => saveBasicMedicalRoomInventory(input))}
            pending={isPending}
          />
        ) : null}
        <div className="responsive-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>{uiText("Phòng")}</th>
                <th>{uiText("Tên thiết bị")}</th>
                <th>{uiText("Tên thương mại")}</th>
                <th>{uiText("ĐVT")}</th>
                <th>{uiText("Tổng")}</th>
                <th>{uiText("Tốt")}</th>
                <th>{uiText("Hư")}</th>
                {canManage ? <th>{uiText("Thao tác")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {inventories.map((item) => (
                <tr key={item.id}>
                  <td>{roomLabel(item.room)}</td>
                  <td>
                    <strong>{item.catalog?.item_name}</strong>
                  </td>
                  <td>{item.catalog?.commercial_name || "—"}</td>
                  <td>{item.catalog?.unit}</td>
                  <td>{item.total_quantity}</td>
                  <td>{item.good_quantity}</td>
                  <td>{item.damaged_quantity}</td>
                  {canManage ? (
                    <td>
                      <button
                        type="button"
                        className="text-action"
                        onClick={() => setStockAdjustment(item)}
                      >
                        {uiText("Sửa số lượng")}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!inventories.length ? (
          <p className="panel-empty">
            {uiText("Chưa có thiết bị được phân bổ cho phòng phù hợp.")}
          </p>
        ) : null}
      </section>
      {stockAdjustment ? (
        <InventoryAdjustmentDialog
          item={stockAdjustment}
          mode="stock"
          pending={isPending}
          onCancel={() => setStockAdjustment(null)}
          onSave={(totalQuantity, damagedQuantity, note) =>
            run(async () => {
              const result = await saveBasicMedicalRoomInventory({
                inventoryId: stockAdjustment.id,
                roomId: stockAdjustment.room_id,
                catalogItemId: stockAdjustment.catalog_item_id,
                totalQuantity,
                damagedQuantity,
                note,
              });
              if (result.ok) setStockAdjustment(null);
              return result;
            })
          }
        />
      ) : null}
    </div>
  );
}

function RoomInventoryForm({
  rooms,
  catalog,
  onSave,
  pending,
}: {
  rooms: Room[];
  catalog: BasicMedicalEquipmentCatalogItem[];
  onSave: (input: {
    roomId: string;
    catalogItemId: string;
    totalQuantity: number;
    damagedQuantity: number;
    note?: string;
  }) => void;
  pending: boolean;
}) {
  const { text: uiText } = useLanguage();

  const [roomId, setRoomId] = useState("");
  const [catalogItemId, setCatalogItemId] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidates, setCandidates] = useState(catalog.slice(0, 30));
  const [total, setTotal] = useState(0);
  const [damaged, setDamaged] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const rows = await searchBasicMedicalCatalogCandidates(candidateQuery);
        setCandidates(rows as BasicMedicalEquipmentCatalogItem[]);
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [candidateQuery]);
  return (
    <div className="basic-medical-inventory-form">
      <div className="basic-medical-inventory-form-heading">
        <strong>{uiText("Phân bổ thiết bị vào phòng")}</strong>
        <span>{uiText("Nhập tổng số lượng và số lượng đang hư.")}</span>
      </div>
      <label>
        <span>{uiText("Phòng *")}</span>
        <select
          aria-label={uiText("Chọn phòng phân bổ thiết bị")}
          value={roomId}
          onChange={(event) => setRoomId(event.target.value)}
        >
          <option value="">{uiText("Chọn phòng")}</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {roomLabel(room)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{uiText("Thiết bị *")}</span>
        <SearchableCombobox
          ariaLabel={uiText("Chọn thiết bị phân bổ vào phòng")}
          value={catalogItemId}
          onChange={setCatalogItemId}
          onQueryChange={setCandidateQuery}
          placeholder={uiText("Gõ để tìm trong toàn bộ danh mục…")}
          emptyLabel={uiText("Chọn thiết bị")}
          options={candidates.map((item) => ({
            value: item.id,
            label: `${item.item_name}${item.commercial_name ? ` · ${item.commercial_name}` : ""}`,
            keywords: [item.item_type, item.manufacturer, item.model]
              .filter(Boolean)
              .join(" "),
          }))}
        />
      </label>
      <label>
        <span>{uiText("Tổng số lượng *")}</span>
        <input
          aria-label={uiText("Tổng số lượng")}
          type="number"
          min="0"
          value={total}
          onChange={(event) => {
            const value = event.target.value;
            setTotal(value ? Number(value) : 0);
          }}
        />
      </label>
      <label>
        <span>{uiText("Số lượng hư *")}</span>
        <input
          aria-label={uiText("Số lượng Hư")}
          type="number"
          min="0"
          max={total}
          value={damaged}
          onChange={(event) => {
            const value = event.target.value;
            setDamaged(value ? Number(value) : 0);
          }}
        />
      </label>
      <button
        className="button button-primary"
        type="button"
        disabled={pending || !roomId || !catalogItemId || damaged > total}
        onClick={() =>
          onSave({
            roomId,
            catalogItemId,
            totalQuantity: total,
            damagedQuantity: damaged,
            note: "Phân bổ thiết bị vào phòng",
          })
        }
      >
        {uiText("Thêm vào phòng")}
      </button>
    </div>
  );
}

function DamagedTab({
  inventories,
  canManage,
}: {
  inventories: BasicMedicalRoomInventoryItem[];
  canManage: boolean;
}) {
  const { text: uiText } = useLanguage();

  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [isPending, startTransition] = useTransition();
  const [conditionAdjustment, setConditionAdjustment] =
    useState<BasicMedicalRoomInventoryItem | null>(null);
  return (
    <section className="data-panel basic-medical-list-panel">
      {notice ? (
        <p
          className={
            notice.ok ? "action-feedback success" : "action-feedback error"
          }
        >
          <LocalizedText text={notice.message ?? ""} />
        </p>
      ) : null}
      <div className="basic-medical-list-filters">
        <span className="equipment-catalog-count">
          {inventories.length}
          {uiText(" thiết bị hư")}
        </span>
      </div>
      <div className="responsive-table">
        <table className="data-table">
          <thead>
            <tr>
              <th>{uiText("Tên thiết bị")}</th>
              <th>{uiText("Phòng")}</th>
              <th>{uiText("ĐVT")}</th>
              <th>{uiText("Số lượng Tốt")}</th>
              <th>{uiText("Số lượng Hư")}</th>
              <th>{uiText("Người báo hư")}</th>
              <th>{uiText("Ngày báo hư gần nhất")}</th>
              {canManage ? <th>{uiText("Điều chỉnh")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {inventories.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.catalog?.item_name}</strong>
                  <br />
                  <small>{item.catalog?.commercial_name}</small>
                </td>
                <td>{roomLabel(item.room)}</td>
                <td>{item.catalog?.unit}</td>
                <td>{item.good_quantity}</td>
                <td>
                  <strong>{item.damaged_quantity}</strong>
                </td>
                <td>{item.last_damage_reporter?.full_name || "—"}</td>
                <td>
                  {item.last_damage_reported_at
                    ? logDateTimeFormatter.format(
                        new Date(item.last_damage_reported_at),
                      )
                    : "—"}
                </td>
                {canManage ? (
                  <td>
                    <button
                      className="button button-warning"
                      type="button"
                      disabled={isPending}
                      onClick={() => setConditionAdjustment(item)}
                    >
                      {uiText("Sửa Tốt/Hư")}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!inventories.length ? (
        <p className="panel-empty">
          {uiText("Không có thiết bị đang được báo Hư.")}
        </p>
      ) : null}
      {conditionAdjustment ? (
        <InventoryAdjustmentDialog
          item={conditionAdjustment}
          mode="condition"
          pending={isPending}
          onCancel={() => setConditionAdjustment(null)}
          onSave={(_total, damagedQuantity, note) => {
            startTransition(async () => {
              const result = await adjustBasicMedicalInventoryCondition({
                inventoryId: conditionAdjustment.id,
                goodQuantity:
                  conditionAdjustment.total_quantity - damagedQuantity,
                damagedQuantity,
                note,
              });
              setNotice(result);
              if (result.ok) {
                setConditionAdjustment(null);
                router.refresh();
              }
            });
          }}
        />
      ) : null}
    </section>
  );
}

function InventoryAdjustmentDialog({
  item,
  mode,
  pending,
  onCancel,
  onSave,
}: {
  item: BasicMedicalRoomInventoryItem;
  mode: "stock" | "condition";
  pending: boolean;
  onCancel: () => void;
  onSave: (
    totalQuantity: number,
    damagedQuantity: number,
    note: string,
  ) => void;
}) {
  const { text: uiText } = useLanguage();

  const [total, setTotal] = useState(String(item.total_quantity));
  const [damaged, setDamaged] = useState(String(item.damaged_quantity));
  const [note, setNote] = useState("");
  const totalValue = Number(total);
  const damagedValue = Number(damaged);
  const valid =
    Number.isInteger(totalValue) &&
    Number.isInteger(damagedValue) &&
    totalValue >= 0 &&
    damagedValue >= 0 &&
    damagedValue <= totalValue &&
    Boolean(note.trim());
  return (
    <ConfirmDialog
      open
      title={
        mode === "stock"
          ? uiText("Điều chỉnh Tổng")
          : uiText("Điều chỉnh Tốt/Hư")
      }
      description={uiText(
        "Hiện tại: Tổng {0} · Tốt {1} · Hư {2}. Mới: Tổng {3} · Tốt {4} · Hư {5}.",
        [
          item.total_quantity,
          item.good_quantity,
          item.damaged_quantity,
          totalValue || 0,
          Math.max(0, totalValue - damagedValue) || 0,
          damagedValue || 0,
        ],
      )}
      confirmLabel={uiText("Lưu")}
      tone="primary"
      pending={pending}
      onCancel={onCancel}
      onConfirm={() => valid && onSave(totalValue, damagedValue, note.trim())}
    >
      <div className="basic-medical-inventory-form">
        {mode === "stock" ? (
          <label>
            <span>{uiText("Tổng mới *")}</span>
            <input
              type="number"
              min="0"
              step="1"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
            />
          </label>
        ) : (
          <p>
            {uiText("Tổng hiện tại: ")}
            <strong>{item.total_quantity}</strong>
          </p>
        )}
        <label>
          <span>{uiText("Hư *")}</span>
          <input
            type="number"
            min="0"
            max={mode === "stock" ? totalValue : item.total_quantity}
            step="1"
            value={damaged}
            onChange={(event) => setDamaged(event.target.value)}
          />
        </label>
        <label>
          <span>{uiText("Ghi chú / Lý do *")}</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            required
          />
        </label>
      </div>
    </ConfirmDialog>
  );
}

function LogsTab({ logs }: { logs: BasicMedicalConditionLogItem[] }) {
  const { text: uiText } = useLanguage();

  return (
    <section className="data-panel basic-medical-list-panel">
      <div className="basic-medical-list-filters">
        <span className="equipment-catalog-count">
          {logs.length}
          {uiText(" thay đổi")}
        </span>
      </div>
      <div className="responsive-table">
        <table className="data-table">
          <thead>
            <tr>
              <th>{uiText("Thời gian")}</th>
              <th>{uiText("Loại thay đổi")}</th>
              <th>{uiText("Thiết bị")}</th>
              <th>{uiText("Phòng")}</th>
              <th>{uiText("Trước thay đổi")}</th>
              <th>{uiText("Sau thay đổi")}</th>
              <th>{uiText("Người thực hiện")}</th>
              <th>{uiText("Ghi chú")}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((item) => (
              <tr key={item.id}>
                <td>
                  {logDateTimeFormatter.format(new Date(item.created_at))}
                </td>
                <td>{uiText(conditionEventLabels[item.event_type])}</td>
                <td>{item.inventory?.catalog?.item_name}</td>
                <td>{roomLabel(item.inventory?.room)}</td>
                <td>
                  {item.good_before}
                  {uiText(" Tốt · ")}
                  {item.damaged_before}
                  {uiText(" Hư")}
                </td>
                <td>
                  {item.good_after}
                  {uiText(" Tốt · ")}
                  {item.damaged_after}
                  {uiText(" Hư")}
                </td>
                <td>{item.actor?.full_name}</td>
                <td>{item.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!logs.length ? (
        <p className="panel-empty">
          {uiText("Chưa có lịch sử thay đổi phù hợp.")}
        </p>
      ) : null}
    </section>
  );
}
