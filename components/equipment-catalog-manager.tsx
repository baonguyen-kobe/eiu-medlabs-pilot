"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteEquipmentCatalogItems,
  disableEquipmentCatalogItems,
  applyEquipmentCatalogReconciliation,
  importEquipmentCatalog,
  previewEquipmentCatalogReconciliation,
  setEquipmentCatalogActive,
  updateEquipmentCatalogItems,
  type EquipmentCatalogInput,
} from "@/app/admin/equipment/actions";
import {
  Download,
  PackageCheck,
  Save,
  Search,
  Settings,
  Trash2,
  X,
} from "@/components/icons";
import { PaginationControls } from "@/components/pagination-controls";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CatalogReconciliationImport } from "@/components/catalog-reconciliation-import";
import { CatalogImportNew } from "@/components/catalog-import-new";
import { TABLE_PAGE_SIZE, totalPagesFor } from "@/lib/pagination";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

export type EquipmentCatalogItem = EquipmentCatalogInput & {
  id: string;
  is_active: boolean;
};

type CatalogMode = "edit" | "activate" | "disable" | "delete" | null;
type SortKey =
  | "item_name"
  | "commercial_name"
  | "item_type"
  | "country_of_origin"
  | "manufacturer"
  | "model"
  | "unit"
  | "is_active";

const catalogColumns: Array<{ key: SortKey; label: string }> = [
  { key: "item_name", label: "Tên thiết bị và vật tư" },
  { key: "commercial_name", label: "Tên thương mại" },
  { key: "item_type", label: "Loại" },
  { key: "country_of_origin", label: "Nước SX" },
  { key: "manufacturer", label: "Hãng" },
  { key: "model", label: "Model" },
  { key: "unit", label: "ĐVT" },
  { key: "is_active", label: "Trạng thái" },
];

function normalizeSearch(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .trim();
}

function uniqueValues(items: EquipmentCatalogItem[], key: SortKey) {
  return [
    ...new Set(
      items.map((item) => String(item[key] ?? "").trim()).filter(Boolean),
    ),
  ].toSorted((left, right) => left.localeCompare(right, "vi"));
}

function editableValue(value: string | null) {
  return value ?? "";
}

export function EquipmentCatalogManager({
  initialItems,
}: {
  initialItems: EquipmentCatalogItem[];
}) {
  const { text: uiText } = useLanguage();

  const router = useRouter();
  const [rows, setRows] = useState(initialItems);
  const [drafts, setDrafts] = useState<Record<string, EquipmentCatalogItem>>(
    {},
  );
  const [mode, setMode] = useState<CatalogMode>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmApply, setConfirmApply] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [manufacturerFilter, setManufacturerFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("item_name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  const types = useMemo(() => uniqueValues(rows, "item_type"), [rows]);
  const countries = useMemo(
    () => uniqueValues(rows, "country_of_origin"),
    [rows],
  );
  const manufacturers = useMemo(
    () => uniqueValues(rows, "manufacturer"),
    [rows],
  );
  const units = useMemo(() => uniqueValues(rows, "unit"), [rows]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = normalizeSearch(deferredQuery);
    return rows
      .filter((item) => {
        const matchesQuery =
          !normalizedQuery ||
          catalogColumns.some(({ key }) =>
            normalizeSearch(item[key]).includes(normalizedQuery),
          );
        return (
          matchesQuery &&
          (!statusFilter ||
            (statusFilter === "active" ? item.is_active : !item.is_active)) &&
          (!typeFilter || item.item_type === typeFilter) &&
          (!countryFilter || item.country_of_origin === countryFilter) &&
          (!manufacturerFilter || item.manufacturer === manufacturerFilter) &&
          (!unitFilter || item.unit === unitFilter)
        );
      })
      .toSorted((left, right) => {
        const leftValue =
          sortKey === "is_active"
            ? left.is_active
              ? "Đang sử dụng"
              : "Ngừng sử dụng"
            : String(left[sortKey] ?? "");
        const rightValue =
          sortKey === "is_active"
            ? right.is_active
              ? "Đang sử dụng"
              : "Ngừng sử dụng"
            : String(right[sortKey] ?? "");
        const compared = leftValue.localeCompare(rightValue, "vi", {
          numeric: true,
          sensitivity: "base",
        });
        return sortDirection === "asc" ? compared : -compared;
      });
  }, [
    countryFilter,
    deferredQuery,
    manufacturerFilter,
    rows,
    sortDirection,
    sortKey,
    statusFilter,
    typeFilter,
    unitFilter,
  ]);

  const safePage = Math.min(
    currentPage,
    totalPagesFor(visibleRows.length, TABLE_PAGE_SIZE),
  );
  const pageRows = visibleRows.slice(
    (safePage - 1) * TABLE_PAGE_SIZE,
    safePage * TABLE_PAGE_SIZE,
  );

  const allVisibleSelected =
    visibleRows.length > 0 &&
    visibleRows.every((row) => selectedIds.has(row.id));

  function switchMode(nextMode: CatalogMode) {
    setSelectedIds(new Set());
    if (nextMode === "edit") {
      setDrafts(Object.fromEntries(rows.map((row) => [row.id, { ...row }])));
    } else {
      setDrafts({});
    }
    setMode(nextMode);
  }

  function changeSort(nextKey: SortKey) {
    setCurrentPage(1);
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDirection("asc");
    }
  }

  function updateDraft(
    id: string,
    key: Exclude<SortKey, "is_active">,
    value: string,
  ) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? rows.find((row) => row.id === id)!),
        [key]: value,
      },
    }));
  }

  function saveEdits() {
    const changed = rows
      .filter((row) => {
        const draft = drafts[row.id];
        return (
          draft &&
          catalogColumns.some(
            ({ key }) =>
              key !== "is_active" &&
              String(draft[key] ?? "").trim() !== String(row[key] ?? "").trim(),
          )
        );
      })
      .map((row) => drafts[row.id]);
    if (!changed.length) {
      switchMode(null);
      setNotice({ ok: true, message: "Không có nội dung thay đổi." });
      return;
    }
    startTransition(async () => {
      const result = await updateEquipmentCatalogItems(changed);
      setNotice(result);
      if (result.ok) {
        const updatedById = new Map(changed.map((row) => [row.id, row]));
        setRows((current) =>
          current.map((row) => updatedById.get(row.id) ?? row),
        );
        switchMode(null);
        router.refresh();
      }
    });
  }

  function applySelection() {
    const ids = [...selectedIds];
    if (
      !ids.length ||
      (mode !== "activate" && mode !== "disable" && mode !== "delete")
    )
      return;
    startTransition(async () => {
      const result =
        mode === "activate"
          ? await setEquipmentCatalogActive(ids, true)
          : mode === "disable"
            ? await disableEquipmentCatalogItems(ids)
            : await deleteEquipmentCatalogItems(ids);
      setNotice(result);
      if (result.ok) {
        const idSet = new Set(ids);
        setRows((current) =>
          mode === "activate" || mode === "disable"
            ? current.map((row) =>
                idSet.has(row.id)
                  ? { ...row, is_active: mode === "activate" }
                  : row,
              )
            : current.filter((row) => !idSet.has(row.id)),
        );
        switchMode(null);
        router.refresh();
      }
    });
  }

  function clearFilters() {
    setQuery("");
    setStatusFilter("");
    setTypeFilter("");
    setCountryFilter("");
    setManufacturerFilter("");
    setUnitFilter("");
    setCurrentPage(1);
  }

  return (
    <div className="equipment-catalog-workspace">
      <section className="data-panel equipment-catalog-import">
        <div className="equipment-import-actions">
          <Link
            className="button equipment-template-download"
            download
            href="/api/admin-catalog-template/equipment"
            prefetch={false}
          >
            <Download size={17} />
            {uiText(" Tải template")}
          </Link>
          <CatalogImportNew action={importEquipmentCatalog} />
          <CatalogReconciliationImport
            preview={previewEquipmentCatalogReconciliation}
            apply={applyEquipmentCatalogReconciliation}
          />
          <a
            className="button equipment-export-all"
            href="/api/equipment-catalog/export"
          >
            <Download size={17} />
            {uiText(" Export tất cả")}
          </a>
        </div>
      </section>

      <section className="data-panel equipment-catalog-panel">
        <div className="equipment-catalog-filters">
          <label className="data-search equipment-catalog-search">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentPage(1);
              }}
              placeholder={uiText(
                "Tìm theo tên, thương mại, loại, nước SX, hãng, model, ĐVT…",
              )}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <select
            aria-label={uiText("Lọc trạng thái thiết bị")}
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">{uiText("Tất cả trạng thái")}</option>
            <option value="active">{uiText("Đang sử dụng")}</option>
            <option value="inactive">{uiText("Ngừng sử dụng")}</option>
          </select>
          <select
            aria-label={uiText("Lọc loại thiết bị")}
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">{uiText("Tất cả loại")}</option>
            {types.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            aria-label={uiText("Lọc nước sản xuất")}
            value={countryFilter}
            onChange={(event) => {
              setCountryFilter(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">{uiText("Tất cả nước SX")}</option>
            {countries.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            aria-label={uiText("Lọc hãng thiết bị")}
            value={manufacturerFilter}
            onChange={(event) => {
              setManufacturerFilter(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">{uiText("Tất cả hãng")}</option>
            {manufacturers.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            aria-label={uiText("Lọc đơn vị tính")}
            value={unitFilter}
            onChange={(event) => {
              setUnitFilter(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">{uiText("Tất cả ĐVT")}</option>
            {units.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button-secondary"
            onClick={clearFilters}
          >
            {uiText("Xóa bộ lọc")}
          </button>
          <span className="inline-toolbar-count-slot">
            <span className="equipment-catalog-count">
              {visibleRows.length}/{rows.length}
              {uiText(" thiết bị")}
            </span>
          </span>
        </div>

        <div className="equipment-catalog-toolbar">
          <div className="equipment-catalog-mode-buttons">
            <button
              type="button"
              className={`button button-primary${mode === "activate" ? " active" : ""}`}
              disabled={isPending || (mode !== null && mode !== "activate")}
              onClick={() => switchMode("activate")}
            >
              <PackageCheck size={17} />
              {uiText(" Kích hoạt")}
            </button>
            <button
              type="button"
              className={`button equipment-catalog-edit${mode === "edit" ? " active" : ""}`}
              disabled={isPending || (mode !== null && mode !== "edit")}
              onClick={() =>
                mode === "edit" ? saveEdits() : switchMode("edit")
              }
            >
              {mode === "edit" ? <Save size={17} /> : <Settings size={17} />}
              {mode === "edit" ? uiText("Lưu chỉnh sửa") : uiText("Sửa")}
            </button>
            <button
              type="button"
              className={`button equipment-catalog-disable${mode === "disable" ? " active" : ""}`}
              disabled={isPending || (mode !== null && mode !== "disable")}
              onClick={() => switchMode("disable")}
            >
              <PackageCheck size={17} />
              {uiText(" Ngừng sử dụng")}
            </button>
            <button
              type="button"
              className={`button equipment-catalog-delete${mode === "delete" ? " active" : ""}`}
              disabled={isPending || (mode !== null && mode !== "delete")}
              onClick={() => switchMode("delete")}
            >
              <Trash2 size={17} />
              {uiText(" Xóa")}
            </button>
          </div>
          {mode ? (
            <button
              type="button"
              className="button button-secondary equipment-catalog-cancel"
              onClick={() => switchMode(null)}
              disabled={isPending}
            >
              <X size={16} />
              {uiText(" Hủy thao tác")}
            </button>
          ) : null}
        </div>

        {mode === "activate" || mode === "disable" || mode === "delete" ? (
          <div className={`equipment-bulk-confirm equipment-bulk-${mode}`}>
            <span>
              {uiText("Đã chọn ")}
              {selectedIds.size}
              {uiText(" thiết bị")}
            </span>
            <button
              type="button"
              className="button"
              disabled={!selectedIds.size || isPending}
              onClick={() => setConfirmApply(true)}
            >
              {isPending
                ? uiText("Đang xử lý…")
                : mode === "activate"
                  ? uiText("Kích hoạt")
                  : mode === "disable"
                    ? uiText("Xác nhận ngừng sử dụng")
                    : uiText("Xác nhận xóa")}
            </button>
          </div>
        ) : null}

        <ConfirmDialog
          open={confirmApply}
          title={uiText("{0} {1} thiết bị?", [
            mode === "disable"
              ? uiText("Ngừng sử dụng")
              : mode === "activate"
                ? uiText("Kích hoạt")
                : uiText("Xóa"),
            selectedIds.size,
          ])}
          description={uiText(
            "Thao tác chỉ áp dụng một lần cho đúng các thiết bị đã chọn.",
          )}
          tone={mode === "activate" ? "primary" : "danger"}
          pending={isPending}
          onCancel={() => setConfirmApply(false)}
          onConfirm={() => {
            setConfirmApply(false);
            applySelection();
          }}
        />

        {notice ? (
          <p
            className={notice.ok ? "form-success" : "form-error"}
            role="status"
          >
            <LocalizedText text={notice.message ?? ""} />
          </p>
        ) : null}

        <div className="responsive-table equipment-catalog-table-wrap">
          <table className="data-table equipment-catalog-table">
            <colgroup>
              {mode === "activate" ||
              mode === "disable" ||
              mode === "delete" ? (
                <col className="equipment-catalog-col-select" />
              ) : null}
              <col className="equipment-catalog-col-name" />
              <col className="equipment-catalog-col-commercial-name" />
              <col className="equipment-catalog-col-metadata" />
              <col className="equipment-catalog-col-metadata" />
              <col className="equipment-catalog-col-metadata" />
              <col className="equipment-catalog-col-metadata" />
              <col className="equipment-catalog-col-metadata" />
              <col className="equipment-catalog-col-metadata" />
            </colgroup>
            <thead>
              <tr>
                {mode === "activate" ||
                mode === "disable" ||
                mode === "delete" ? (
                  <th className="equipment-select-column">
                    <input
                      aria-label={uiText("Chọn tất cả thiết bị đang hiển thị")}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) => {
                        const visibleIds = visibleRows.map((row) => row.id);
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          for (const id of visibleIds) {
                            if (event.target.checked) next.add(id);
                            else next.delete(id);
                          }
                          return next;
                        });
                      }}
                    />
                  </th>
                ) : null}
                {catalogColumns.map(({ key, label }) => (
                  <th
                    key={key}
                    aria-sort={
                      sortKey === key
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="equipment-sort-button"
                      onClick={() => changeSort(key)}
                    >
                      <span>{uiText(label)}</span>
                      <span aria-hidden="true">
                        {sortKey === key
                          ? sortDirection === "asc"
                            ? "↑"
                            : "↓"
                          : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((item) => {
                const draft = drafts[item.id] ?? item;
                return (
                  <tr
                    key={item.id}
                    className={
                      !item.is_active
                        ? "equipment-catalog-inactive-row"
                        : undefined
                    }
                  >
                    {mode === "activate" ||
                    mode === "disable" ||
                    mode === "delete" ? (
                      <td className="equipment-select-column">
                        <input
                          aria-label={uiText("Chọn {0}", [item.item_name])}
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={(event) =>
                            setSelectedIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              return next;
                            })
                          }
                        />
                      </td>
                    ) : null}
                    {catalogColumns.map(({ key, label }) => (
                      <td key={key}>
                        {key === "is_active" ? (
                          <span
                            className={`equipment-catalog-status ${
                              item.is_active ? "active" : "inactive"
                            }`}
                          >
                            {item.is_active
                              ? uiText("Đang sử dụng")
                              : uiText("Ngừng sử dụng")}
                          </span>
                        ) : mode === "edit" ? (
                          <input
                            aria-label={uiText("{0} của {1}", [
                              label,
                              item.item_name,
                            ])}
                            required={
                              key === "item_name" ||
                              key === "commercial_name" ||
                              key === "unit"
                            }
                            value={editableValue(draft[key])}
                            onChange={(event) =>
                              updateDraft(item.id, key, event.target.value)
                            }
                          />
                        ) : key === "item_name" ? (
                          <strong>{item.item_name}</strong>
                        ) : (
                          item[key] || "—"
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visibleRows.length ? (
            <p className="panel-empty">
              {uiText("Không có thiết bị phù hợp bộ lọc.")}
            </p>
          ) : null}
        </div>
        <PaginationControls
          currentPage={safePage}
          totalItems={visibleRows.length}
          onPageChange={setCurrentPage}
        />
      </section>
    </div>
  );
}
