"use client";

import { useMemo, useState, useTransition } from "react";
import {
  deleteCourse,
  deleteRoom,
  setCoursesActive,
  setRoomsActive,
  updateCatalogCourse,
  updateCatalogCoursesBatch,
  updateCatalogRoom,
  updateCatalogRoomsBatch,
} from "@/app/admin/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

type RoomType = { id: string; name: string; is_active: boolean };
type CatalogItem = {
  id: string;
  room_code?: string;
  building_code?: string;
  room_name?: string | null;
  course_code?: string;
  course_name?: string;
  room_type_id: string;
  capacity?: number | null;
  is_active: boolean;
  room_types: { name: string } | null;
};

type Draft = {
  code: string;
  building: string;
  name: string;
  capacity: string;
  roomTypeId: string;
};

function toDraft(kind: "rooms" | "courses", item: CatalogItem): Draft {
  return {
    code: kind === "rooms" ? (item.room_code ?? "") : (item.course_code ?? ""),
    building: item.building_code ?? "",
    name: kind === "rooms" ? (item.room_name ?? "") : (item.course_name ?? ""),
    capacity: item.capacity == null ? "" : String(item.capacity),
    roomTypeId: item.room_type_id,
  };
}

export function CatalogBatchManager({
  kind,
  initialItems,
  roomTypes,
}: {
  kind: "rooms" | "courses";
  initialItems: CatalogItem[];
  roomTypes: RoomType[];
}) {
  const { text: uiText } = useLanguage();

  const [items, setItems] = useState(initialItems);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [activeConfirmation, setActiveConfirmation] = useState<boolean | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<CatalogItem | null>(null);
  const allSelected = items.length > 0 && selected.length === items.length;
  const editingItems = useMemo(
    () => items.filter((item) => editing.includes(item.id)),
    [editing, items],
  );

  function beginEdit(ids: string[]) {
    const nextItems = items.filter((item) => ids.includes(item.id));
    if (!nextItems.length || pending) return;
    setEditing(nextItems.map((item) => item.id));
    setSelected(nextItems.map((item) => item.id));
    setDrafts(
      Object.fromEntries(
        nextItems.map((item) => [item.id, toDraft(kind, item)]),
      ),
    );
    setNotice(null);
  }

  function cancelEdit() {
    if (pending) return;
    setEditing([]);
    setDrafts({});
    setNotice("Đã hủy chỉnh sửa. Dữ liệu chưa được thay đổi.");
  }

  function updateDraft(id: string, field: keyof Draft, value: string) {
    setDrafts((valueById) => ({
      ...valueById,
      [id]: { ...valueById[id], [field]: value },
    }));
  }

  function toggle(id: string) {
    setSelected((value) =>
      value.includes(id) ? value.filter((item) => item !== id) : [...value, id],
    );
  }

  function applyActive(active: boolean) {
    if (!selected.length || pending) return;
    startTransition(async () => {
      try {
        if (kind === "rooms") await setRoomsActive(selected, active);
        else await setCoursesActive(selected, active);
        setItems((value) =>
          value.map((item) =>
            selected.includes(item.id) ? { ...item, is_active: active } : item,
          ),
        );
        setNotice(
          active
            ? "Đã kích hoạt các mục đã chọn."
            : "Đã ngừng dùng các mục đã chọn.",
        );
        setSelected([]);
      } catch {
        setNotice("Không thể cập nhật danh mục. Dữ liệu không thay đổi.");
      }
    });
  }

  const itemLabel = kind === "rooms" ? uiText("phòng") : uiText("môn học");

  function save() {
    if (!editingItems.length || pending) return;
    const changedItems = editingItems.filter((item) => {
      const draft = drafts[item.id];
      if (!draft) return false;
      return (
        draft.code.trim() !==
          (kind === "rooms" ? item.room_code : (item.course_code ?? "")) ||
        draft.building.trim() !== (item.building_code ?? "") ||
        draft.name.trim() !==
          (kind === "rooms" ? item.room_name : (item.course_name ?? "")) ||
        draft.capacity !==
          (item.capacity == null ? "" : String(item.capacity)) ||
        draft.roomTypeId !== item.room_type_id
      );
    });
    if (!changedItems.length) {
      cancelEdit();
      return;
    }
    startTransition(async () => {
      try {
        if (kind === "rooms") {
          const input = changedItems.map((item) => {
            const draft = drafts[item.id];
            return {
              id: item.id,
              roomCode: draft.code,
              buildingCode: draft.building,
              roomName: draft.name,
              capacity: draft.capacity ? Number(draft.capacity) : null,
              roomTypeId: draft.roomTypeId,
            };
          });
          if (
            input.some(
              (room) =>
                room.capacity !== null &&
                (!Number.isInteger(room.capacity) || room.capacity < 1),
            )
          ) {
            setNotice("Sức chứa phải là số nguyên từ 1 trở lên hoặc để trống.");
            return;
          }
          if (input.length === 1) await updateCatalogRoom(input[0]);
          else await updateCatalogRoomsBatch(input);
        } else {
          const input = changedItems.map((item) => {
            const draft = drafts[item.id];
            return {
              id: item.id,
              courseCode: draft.code,
              courseName: draft.name,
              roomTypeId: draft.roomTypeId,
            };
          });
          if (input.length === 1) await updateCatalogCourse(input[0]);
          else await updateCatalogCoursesBatch(input);
        }
        const changedIds = new Set(changedItems.map((item) => item.id));
        setItems((value) =>
          value.map((item) => {
            const draft = drafts[item.id];
            if (!draft || !changedIds.has(item.id)) return item;
            return {
              ...item,
              room_code: kind === "rooms" ? draft.code : item.room_code,
              building_code:
                kind === "rooms" ? draft.building : item.building_code,
              room_name: kind === "rooms" ? draft.name || null : item.room_name,
              course_code: kind === "courses" ? draft.code : item.course_code,
              course_name: kind === "courses" ? draft.name : item.course_name,
              capacity:
                kind === "rooms"
                  ? draft.capacity
                    ? Number(draft.capacity)
                    : null
                  : item.capacity,
              room_type_id: draft.roomTypeId,
              room_types: {
                name:
                  roomTypes.find((type) => type.id === draft.roomTypeId)
                    ?.name ?? "",
              },
            };
          }),
        );
        setEditing([]);
        setDrafts({});
        setSelected([]);
        setNotice("Đã lưu thay đổi.");
      } catch (error) {
        setNotice(
          error instanceof Error &&
            error.message.includes("INVALID_ROOM_CAPACITY")
            ? "Sức chứa phải là số nguyên từ 1 trở lên hoặc để trống."
            : "Không thể lưu. Mọi thay đổi trong lô đã được từ chối an toàn.",
        );
      }
    });
  }

  function remove() {
    const item = deleteTarget;
    if (!item || pending) return;
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("id", item.id);
        if (kind === "rooms") await deleteRoom(formData);
        else await deleteCourse(formData);
        setItems((value) =>
          value.filter((candidate) => candidate.id !== item.id),
        );
        setSelected((value) => value.filter((id) => id !== item.id));
        setDeleteTarget(null);
        setNotice("Đã xóa mục.");
      } catch {
        setNotice("Không thể xóa mục có dữ liệu liên quan.");
      }
    });
  }

  return (
    <div className="data-panel catalog-data-panel">
      <div
        className="equipment-catalog-toolbar"
        aria-label={
          editing.length
            ? uiText("Chỉnh sửa nội tuyến")
            : uiText("Thao tác danh mục")
        }
      >
        <span>
          {editing.length || selected.length}
          {uiText(" mục được chọn")}
        </span>
        <div className="catalog-master-action-group">
          <button
            className="button button-primary"
            type="button"
            disabled={Boolean(editing.length) || !selected.length || pending}
            onClick={() => setActiveConfirmation(true)}
          >
            {uiText("Kích hoạt")}
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={pending || (!editing.length && !selected.length)}
            onClick={() => (editing.length ? save() : beginEdit(selected))}
          >
            {editing.length ? uiText("Lưu chỉnh sửa") : uiText("Sửa")}
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={Boolean(editing.length) || !selected.length || pending}
            onClick={() => setActiveConfirmation(false)}
          >
            {uiText("Ngừng sử dụng")}
          </button>
          <button
            className="button button-danger"
            type="button"
            disabled={
              Boolean(editing.length) || selected.length !== 1 || pending
            }
            onClick={() =>
              setDeleteTarget(
                items.find((item) => item.id === selected[0]) ?? null,
              )
            }
          >
            {uiText("Xóa")}
          </button>
        </div>
        {editing.length ? (
          <button
            className="button button-secondary"
            type="button"
            disabled={pending}
            onClick={cancelEdit}
          >
            {uiText("Hủy")}
          </button>
        ) : null}
      </div>
      {notice ? (
        <p className="action-feedback" role="status">
          <LocalizedText text={notice ?? ""} />
        </p>
      ) : null}
      <ConfirmDialog
        open={activeConfirmation !== null}
        title={`${activeConfirmation ? uiText("Kích hoạt") : uiText("Ngừng sử dụng")} ${selected.length} ${itemLabel}?`}
        description={uiText(
          "Thao tác chỉ áp dụng một lần cho đúng các mục đang chọn.",
        )}
        tone={activeConfirmation ? "primary" : "danger"}
        pending={pending}
        onCancel={() => setActiveConfirmation(null)}
        onConfirm={() => {
          if (activeConfirmation === null) return;
          applyActive(activeConfirmation);
          setActiveConfirmation(null);
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={uiText("Xóa {0} này?", [itemLabel])}
        description={uiText(
          "Thao tác chỉ thành công khi không có dữ liệu liên quan.",
        )}
        tone="danger"
        pending={pending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
      <div
        className="responsive-table"
        role="region"
        aria-label={
          kind === "rooms"
            ? uiText("Danh mục phòng; vuốt ngang để xem đầy đủ")
            : uiText("Danh mục môn học; vuốt ngang để xem đầy đủ")
        }
        tabIndex={0}
      >
        <table className="data-table catalog-data-table">
          <thead>
            <tr>
              <th>
                <input
                  aria-label={uiText("Chọn tất cả mục đang xem")}
                  type="checkbox"
                  checked={allSelected}
                  disabled={editing.length > 0 || pending}
                  onChange={() =>
                    setSelected(allSelected ? [] : items.map((item) => item.id))
                  }
                />
              </th>
              <th>{uiText("Mã")}</th>
              <th>{uiText("Tên")}</th>
              <th>{uiText("Loại")}</th>
              {kind === "rooms" ? <th>{uiText("Sức chứa")}</th> : null}
              <th>{uiText("Trạng thái")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isEditing = editing.includes(item.id);
              const draft = drafts[item.id] ?? toDraft(kind, item);
              return (
                <tr
                  key={item.id}
                  className={isEditing ? "is-editing" : undefined}
                >
                  <td>
                    <input
                      aria-label={uiText("Chọn {0}", [
                        kind === "rooms" ? item.room_code : item.course_code,
                      ])}
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      disabled={isEditing || editing.length > 0 || pending}
                      onChange={() => toggle(item.id)}
                    />
                  </td>
                  <td className="mono">
                    {isEditing ? (
                      kind === "rooms" ? (
                        <div className="catalog-inline-fields">
                          <input
                            aria-label={uiText("Mã phòng")}
                            required
                            value={draft.code}
                            onChange={(event) =>
                              updateDraft(item.id, "code", event.target.value)
                            }
                          />
                          <input
                            aria-label={uiText("Tòa nhà")}
                            required
                            value={draft.building}
                            onChange={(event) =>
                              updateDraft(
                                item.id,
                                "building",
                                event.target.value,
                              )
                            }
                          />
                        </div>
                      ) : (
                        <input
                          aria-label={uiText("Mã môn học")}
                          required
                          value={draft.code}
                          onChange={(event) =>
                            updateDraft(item.id, "code", event.target.value)
                          }
                        />
                      )
                    ) : kind === "rooms" ? (
                      `${item.room_code}.${item.building_code}`
                    ) : (
                      item.course_code
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        aria-label={
                          kind === "rooms"
                            ? uiText("Tên phòng")
                            : uiText("Tên môn học")
                        }
                        required={kind === "courses"}
                        value={draft.name}
                        onChange={(event) =>
                          updateDraft(item.id, "name", event.target.value)
                        }
                      />
                    ) : kind === "rooms" ? (
                      (item.room_name ?? "—")
                    ) : (
                      item.course_name
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <select
                        aria-label={uiText("Loại phòng")}
                        value={draft.roomTypeId}
                        onChange={(event) =>
                          updateDraft(item.id, "roomTypeId", event.target.value)
                        }
                      >
                        {roomTypes
                          .filter((type) => type.is_active)
                          .map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      (item.room_types?.name ?? "—")
                    )}
                  </td>
                  {kind === "rooms" ? (
                    <td>
                      {isEditing ? (
                        <input
                          aria-label={uiText("Sức chứa")}
                          type="number"
                          min="1"
                          step="1"
                          value={draft.capacity}
                          onChange={(event) =>
                            updateDraft(item.id, "capacity", event.target.value)
                          }
                        />
                      ) : (
                        (item.capacity ?? "—")
                      )}
                    </td>
                  ) : null}
                  <td>
                    <span
                      className={`status-pill ${item.is_active ? "is-active" : ""}`}
                    >
                      {item.is_active
                        ? uiText("Đang dùng")
                        : uiText("Ngừng dùng")}
                    </span>
                  </td>
                  <td className="catalog-row-actions">
                    {isEditing ? (
                      <span className="field-note">{uiText("Đang sửa")}</span>
                    ) : (
                      <>
                        <button
                          className="table-action"
                          type="button"
                          disabled={pending}
                          onClick={() => beginEdit([item.id])}
                        >
                          {uiText("Sửa")}
                        </button>
                        <button
                          className="table-action delete-action"
                          type="button"
                          disabled={pending}
                          onClick={() => setDeleteTarget(item)}
                        >
                          {uiText("Xóa")}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
