"use client";

import { useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  formatDisplayQuantity,
  isPositive,
  uomLabel,
} from "@/lib/inventory/decimal";
import { formatInventoryDate } from "@/lib/inventory/dates";
import { InventoryLookup } from "./inventory-lookup";
import { RecordDrawer } from "./record-drawer";
import { PaginationControls } from "@/components/pagination-controls";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type {
  InventoryCohortDetail,
  InventoryStockBalance,
  InventoryStorageLocation,
} from "@/lib/inventory/types";
import { useLanguage } from "@/components/i18n/language-provider";

type Filters = {
  q: string;
  location_id: string;
  condition: string;
  expiry_state: string;
  active: string;
  sort: string;
};

type Counts = {
  all: number;
  eligible: number;
  expired: number;
  unknown: number;
  damaged: number;
};

type Selection = {
  item_id: string;
  location_id?: string;
  condition?: string;
} | null;

const quickFilters = [
  { key: "all", label: "Tất cả", tone: "kpi-navy", query: {} },
  {
    key: "eligible",
    label: "Cấp phát được",
    tone: "kpi-teal",
    query: { expiry_state: "eligible" },
  },
  {
    key: "expired",
    label: "Hết hạn",
    tone: "kpi-danger",
    query: { expiry_state: "expired" },
  },
  {
    key: "unknown",
    label: "Chưa rõ hạn dùng",
    tone: "kpi-gold",
    query: { expiry_state: "unknown" },
  },
  {
    key: "damaged",
    label: "Hàng hỏng",
    tone: "kpi-neutral",
    query: { condition: "damaged" },
  },
] as const;

function activeQuickFilter(filters: Filters) {
  const other =
    filters.q ||
    filters.location_id ||
    (filters.active !== "all" && filters.active);
  if (other) return null;
  if (filters.condition === "damaged" && filters.expiry_state === "all")
    return "damaged";
  if (filters.condition !== "all") return null;
  if (filters.expiry_state === "all") return "all";
  return filters.expiry_state;
}

function sameRow(row: InventoryStockBalance, selected: Selection) {
  return (
    !!selected &&
    row.item_id === selected.item_id &&
    row.location_id === selected.location_id &&
    row.condition === selected.condition
  );
}

export function StockView({
  balances,
  totalBalances,
  currentPage,
  pageSize = TABLE_PAGE_SIZE,
  filters,
  counts,
  selectedLocationLabel,
  selectedDimensions,
  cohorts,
  totalCohorts,
  cohortPage,
}: {
  balances: InventoryStockBalance[];
  totalBalances: number;
  currentPage: number;
  pageSize?: number;
  filters: Filters;
  counts: Counts;
  selectedLocationLabel?: string;
  selectedDimensions: Selection;
  cohorts: InventoryCohortDetail[];
  totalCohorts: number;
  cohortPage: number;
}) {
  const { text } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [locationId, setLocationId] = useState(filters.location_id);
  const [locationLabel, setLocationLabel] = useState(selectedLocationLabel);

  const push = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "" || value === "all") {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      }
      if (Number(params.get("page")) <= 1) params.delete("page");
      if (Number(params.get("cohort_page")) <= 1) params.delete("cohort_page");
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const closeDrawer = useCallback(
    () =>
      push({
        selected_item: undefined,
        selected_location: undefined,
        selected_condition: undefined,
        cohort_page: undefined,
      }),
    [push],
  );

  function openRow(row: InventoryStockBalance) {
    push({
      selected_item: row.item_id,
      selected_location: row.location_id,
      selected_condition: row.condition,
      cohort_page: undefined,
    });
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    push({
      q: String(form.get("q") ?? "").trim(),
      location_id: locationId,
      condition: String(form.get("condition")),
      expiry_state: String(form.get("expiry_state")),
      active: String(form.get("active")),
      sort: String(form.get("sort")),
      status: undefined,
      page: undefined,
    });
  }

  const filtered = activeQuickFilter(filters) !== "all";
  const current = activeQuickFilter(filters);
  const selectedRow = balances.find((row) => sameRow(row, selectedDimensions));
  const drawerTitle =
    selectedRow?.item_name ?? cohorts[0]?.item_name ?? text("Chi tiết tồn kho");
  const drawerSubtitle = selectedRow
    ? `${selectedRow.item_code} · ${selectedRow.location_name}`
    : cohorts[0]?.item_code;

  return (
    <>
      <section className="kpi-grid" aria-label={text("Tổng quan tồn kho")}>
        {quickFilters.map((card) => (
          <Link
            key={card.key}
            href={
              Object.keys(card.query).length
                ? `${pathname}?${new URLSearchParams(card.query).toString()}`
                : pathname
            }
            scroll={false}
            className={`kpi-card kpi-filter ${card.tone}`}
            aria-current={current === card.key ? "true" : undefined}
          >
            <span>{text(card.label)}</span>
            <strong>{counts[card.key]}</strong>
            <small>{text("dòng tồn")}</small>
          </Link>
        ))}
      </section>

      <form
        className="list-filters"
        onSubmit={submitFilters}
        key={searchParams?.toString()}
      >
        <label>
          {text("Tìm kiếm")}
          <input
            name="q"
            defaultValue={filters.q}
            placeholder={text("Mã hoặc tên vật tư")}
          />
        </label>
        <div className="list-filters-field">
          <span>{text("Vị trí")}</span>
          <InventoryLookup<InventoryStorageLocation>
            resource="locations"
            filters={{ active: true }}
            value={locationId}
            valueKey="id"
            label={text("Vị trí")}
            id="stock-location-filter"
            hideLabel
            selectedLabel={locationLabel}
            placeholder={text("Tất cả vị trí")}
            onSelect={(location) => {
              setLocationId(location.id);
              setLocationLabel(`${location.code} - ${location.name}`);
            }}
          />
        </div>
        <label>
          {text("Tình trạng")}
          <select name="condition" defaultValue={filters.condition}>
            <option value="all">{text("Tất cả")}</option>
            <option value="good">{text("Tốt")}</option>
            <option value="damaged">{text("Hỏng")}</option>
          </select>
        </label>
        <label>
          {text("Hạn dùng")}
          <select name="expiry_state" defaultValue={filters.expiry_state}>
            <option value="all">{text("Tất cả")}</option>
            <option value="eligible">{text("Cấp phát được")}</option>
            <option value="expired">{text("Hết hạn")}</option>
            <option value="unknown">{text("Chưa rõ hạn dùng")}</option>
          </select>
        </label>
        <label>
          {text("Vật tư")}
          <select name="active" defaultValue={filters.active}>
            <option value="all">{text("Tất cả")}</option>
            <option value="true">{text("Đang dùng")}</option>
            <option value="false">{text("Ngừng dùng")}</option>
          </select>
        </label>
        <label>
          {text("Sắp xếp")}
          <select name="sort" defaultValue={filters.sort || "code_asc"}>
            <option value="code_asc">{text("Mã A → Z")}</option>
            <option value="code_desc">{text("Mã Z → A")}</option>
            <option value="name_asc">{text("Tên A → Z")}</option>
            <option value="name_desc">{text("Tên Z → A")}</option>
          </select>
        </label>
        <div className="list-filters-actions">
          <button type="submit" className="button button-primary">
            {text("Lọc")}
          </button>
          {filtered ? (
            <Link href={pathname} className="button button-secondary">
              {text("Xóa bộ lọc")}
            </Link>
          ) : null}
          <span className="inline-toolbar-count">
            {text("{0} dòng tồn", [totalBalances])}
          </span>
        </div>
      </form>

      {balances.length === 0 ? (
        <p className="panel-empty">
          {filtered
            ? text("Không có dòng tồn nào khớp bộ lọc.")
            : text("Kho chưa có số dư nào.")}
        </p>
      ) : (
        <div className="data-panel">
          <div className="responsive-table">
            <table className="data-table records-on-phone">
              <thead>
                <tr>
                  <th>{text("Vật tư")}</th>
                  <th>{text("Vị trí")}</th>
                  <th>{text("Tình trạng")}</th>
                  <th className="num">{text("Tồn thực tế")}</th>
                  <th className="num">{text("Cấp phát được")}</th>
                  <th>{text("Cần chú ý")}</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((row) => (
                  <tr
                    key={`${row.item_id}-${row.location_id}-${row.condition}`}
                    className="row-link"
                    aria-selected={sameRow(row, selectedDimensions)}
                    onClick={() => openRow(row)}
                  >
                    <td data-label={text("Vật tư")}>
                      <span className="cell-stack">
                        <button
                          type="button"
                          className="link-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openRow(row);
                          }}
                        >
                          {row.item_name}
                        </button>
                        <small>{row.item_code}</small>
                      </span>
                    </td>
                    <td data-label={text("Vị trí")}>{row.location_name}</td>
                    <td data-label={text("Tình trạng")}>
                      <ConditionTone condition={row.condition} />
                    </td>
                    <td className="num" data-label={text("Tồn thực tế")}>
                      {formatDisplayQuantity(row.quantity)} {uomLabel(row)}
                    </td>
                    <td className="num" data-label={text("Cấp phát được")}>
                      {row.available_quantity == null
                        ? text("Chưa xác định")
                        : formatDisplayQuantity(row.available_quantity)}
                    </td>
                    <td data-label={text("Cần chú ý")}>
                      <Attention row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PaginationControls
        currentPage={currentPage}
        totalItems={totalBalances}
        pageSize={pageSize}
        onPageChange={(page) => push({ page })}
      />

      {selectedDimensions ? (
        <RecordDrawer
          title={drawerTitle}
          subtitle={drawerSubtitle}
          onClose={closeDrawer}
          actions={
            <>
              <Link
                className="button button-primary"
                href={`/inventory/operations?tab=transfer${selectedDimensions.location_id ? `&location_id=${selectedDimensions.location_id}` : ""}`}
              >
                {text("Điều chuyển")}
              </Link>
              {selectedDimensions.condition === "good" ? (
                <Link
                  className="button button-secondary"
                  href={`/inventory/operations?tab=condition${selectedDimensions.location_id ? `&location_id=${selectedDimensions.location_id}` : ""}`}
                >
                  {text("Báo hỏng")}
                </Link>
              ) : null}
            </>
          }
        >
          {selectedRow ? <BalanceFacts row={selectedRow} /> : null}
          <h3>{text("Các lô ({0})", [totalCohorts])}</h3>
          {cohorts.length === 0 ? (
            <p className="panel-empty">{text("Không có lô nào.")}</p>
          ) : (
            cohorts.map((cohort) => (
              <CohortFacts
                key={cohort.origin_id}
                cohort={cohort}
                unit={selectedRow ? uomLabel(selectedRow) : uomLabel(cohort)}
              />
            ))
          )}
          {totalCohorts > 20 ? (
            <PaginationControls
              currentPage={cohortPage}
              totalItems={totalCohorts}
              pageSize={20}
              onPageChange={(page) => push({ cohort_page: page })}
            />
          ) : null}
        </RecordDrawer>
      ) : null}
    </>
  );
}

function ConditionTone({ condition }: { condition: string }) {
  const { text } = useLanguage();
  return condition === "good" ? (
    <span className="badge" data-tone="success">
      {text("Tốt")}
    </span>
  ) : (
    <span className="badge" data-tone="danger">
      {text("Hỏng")}
    </span>
  );
}

/** Only non-zero warnings are shown; zero is not a warning. */
function Attention({ row }: { row: InventoryStockBalance }) {
  const { text } = useLanguage();
  const expired = isPositive(row.expired_quantity ?? "0");
  const unknown = isPositive(row.unknown_expiry_quantity ?? "0");
  if (!expired && !unknown) return null;
  return (
    <span className="cell-stack">
      {expired ? (
        <span className="badge" data-tone="danger">
          {text("Hết hạn {0}", [formatDisplayQuantity(row.expired_quantity)])}
        </span>
      ) : null}
      {unknown ? (
        <span className="badge" data-tone="warning">
          {text("Chưa rõ hạn {0}", [
            formatDisplayQuantity(row.unknown_expiry_quantity),
          ])}
        </span>
      ) : null}
    </span>
  );
}

function BalanceFacts({ row }: { row: InventoryStockBalance }) {
  const { text } = useLanguage();
  const unit = uomLabel(row);
  const facts: Array<[string, string]> = [
    ["Tình trạng", row.condition === "good" ? text("Tốt") : text("Hỏng")],
    ["Tồn thực tế", `${formatDisplayQuantity(row.quantity)} ${unit}`],
    [
      "Đủ điều kiện cấp",
      `${formatDisplayQuantity(row.eligible_quantity ?? "0")} ${unit}`,
    ],
    [
      "Cấp phát được",
      row.available_quantity == null
        ? text("Chưa xác định")
        : `${formatDisplayQuantity(row.available_quantity)} ${unit}`,
    ],
    [
      "Hết hạn",
      `${formatDisplayQuantity(row.expired_quantity ?? "0")} ${unit}`,
    ],
    [
      "Chưa rõ hạn dùng",
      `${formatDisplayQuantity(row.unknown_expiry_quantity ?? "0")} ${unit}`,
    ],
  ];
  return (
    <dl className="detail-list">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{text(label)}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CohortFacts({
  cohort,
  unit,
}: {
  cohort: InventoryCohortDetail;
  unit: string;
}) {
  const { text } = useLanguage();
  const where =
    cohort.location_state === "depleted"
      ? text("Đã xuất hết")
      : cohort.location_state === "split"
        ? cohort.locations
            .map(
              (loc) =>
                `${loc.location_name}: ${formatDisplayQuantity(loc.physical_balance)}`,
            )
            .join(" · ")
        : (cohort.current_location_name ?? "—");
  const expiry = cohort.current_expiry_date
    ? formatInventoryDate(cohort.current_expiry_date)
    : cohort.current_expiry_precision === "not_required"
      ? text("Không yêu cầu")
      : cohort.current_expiry_precision === "unknown"
        ? text("Chưa rõ")
        : "—";
  return (
    <dl className="detail-list">
      <div>
        <dt>{text("Lô")}</dt>
        <dd>
          <Link
            href={`/inventory/transactions/${cohort.transaction_id}?origin=${cohort.origin_id}`}
          >
            {cohort.receipt_reference || cohort.cutover_key || cohort.line_key}
          </Link>
        </dd>
      </div>
      <div>
        <dt>{text("Vị trí")}</dt>
        <dd>{where}</dd>
      </div>
      <div>
        <dt>{text("Tồn / cấp phát được")}</dt>
        <dd>
          {formatDisplayQuantity(
            cohort.physical_balance || cohort.remaining_quantity,
          )}{" "}
          /{" "}
          {cohort.available_quantity == null
            ? text("Chưa xác định")
            : formatDisplayQuantity(cohort.available_quantity)}{" "}
          {unit}
        </dd>
      </div>
      <div>
        <dt>{text("Hạn dùng")}</dt>
        <dd>{expiry}</dd>
      </div>
    </dl>
  );
}
