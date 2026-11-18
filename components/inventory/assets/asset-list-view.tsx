"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search } from "@/components/icons";
import {
  AssetEligibilityBadge,
  LifecycleBadge,
  OperationalStatusBadge,
} from "./asset-status-badge";
import { AssetQrLookup } from "./asset-qr-lookup";
import { PaginationControls } from "@/components/pagination-controls";
import type {
  AssetLifecycleStatus,
  AssetOperationalStatus,
  EquipmentAsset,
} from "@/lib/inventory/asset-types";
import { useLanguage } from "@/components/i18n/language-provider";

export interface AssetListViewProps {
  assets: EquipmentAsset[];
  total: number;
  page: number;
  pageSize: number;
  isAdmin: boolean;
  filters: {
    q?: string;
    lifecycle_status?: AssetLifecycleStatus;
    operational_status?: AssetOperationalStatus;
    source_line_id?: string;
  };
}

const path = "/inventory/assets";

/** Coded assets in the Kho list pattern (UI Master 0A.4). */
export function AssetListView({
  assets,
  total,
  page,
  pageSize,
  isAdmin,
  filters,
}: AssetListViewProps) {
  const { text } = useLanguage();
  const router = useRouter();
  const [showQrLookup, setShowQrLookup] = useState(false);
  const filtered = Boolean(
    filters.q ||
    filters.lifecycle_status ||
    filters.operational_status ||
    filters.source_line_id,
  );

  function go(values: Record<string, string | undefined>, nextPage = 1) {
    const params = new URLSearchParams();
    const merged = { ...filters, ...values };
    for (const [key, value] of Object.entries(merged)) {
      if (value && value !== "all") params.set(key, value);
    }
    if (nextPage > 1) params.set("page", String(nextPage));
    router.push(params.size ? `${path}?${params}` : path);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    go({
      q: String(form.get("q") ?? "").trim() || undefined,
      lifecycle_status: String(form.get("lifecycle_status") ?? ""),
      operational_status: String(form.get("operational_status") ?? ""),
    });
  }

  return (
    <>
      <div className="list-filters-actions">
        <Link
          href="/inventory/receive?kind=asset"
          className="button button-primary"
        >
          <Plus size={16} aria-hidden="true" />
          {text("Tiếp nhận thiết bị")}
        </Link>
        {isAdmin ? (
          <Link
            href="/inventory/opening?kind=asset"
            className="button button-secondary"
          >
            {text("Tồn đầu kỳ thiết bị")}
          </Link>
        ) : null}
        <button
          type="button"
          className="button button-secondary"
          aria-expanded={showQrLookup}
          onClick={() => setShowQrLookup((open) => !open)}
        >
          <Search size={16} aria-hidden="true" />
          {showQrLookup ? text("Ẩn tra cứu QR") : text("Quét / tra cứu QR")}
        </button>
      </div>

      {showQrLookup ? (
        <section aria-label={text("Tra cứu mã QR")}>
          <AssetQrLookup />
        </section>
      ) : null}

      <form
        className="list-filters"
        onSubmit={submit}
        key={JSON.stringify(filters)}
      >
        <label>
          {text("Tìm kiếm")}
          <input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder={text("Mã tài sản, số sê-ri, SKU, model")}
          />
        </label>
        <label>
          {text("Vòng đời")}
          <select
            name="lifecycle_status"
            defaultValue={filters.lifecycle_status ?? "all"}
          >
            <option value="all">{text("Tất cả")}</option>
            <option value="in_service">{text("Đang vận hành")}</option>
            <option value="registered">{text("Mới tiếp nhận")}</option>
            <option value="inactive">{text("Tạm ngưng")}</option>
            <option value="retired">{text("Ngừng sử dụng")}</option>
            <option value="disposed">{text("Đã thanh lý")}</option>
          </select>
        </label>
        <label>
          {text("Tình trạng")}
          <select
            name="operational_status"
            defaultValue={filters.operational_status ?? "all"}
          >
            <option value="all">{text("Tất cả")}</option>
            <option value="ready">{text("Sẵn sàng")}</option>
            <option value="in_use">{text("Đang sử dụng")}</option>
            <option value="under_maintenance">{text("Bảo trì")}</option>
            <option value="damaged">{text("Hư hỏng")}</option>
            <option value="prohibited">{text("Cấm lưu hành")}</option>
          </select>
        </label>
        <div className="list-filters-actions">
          <button type="submit" className="button button-primary">
            {text("Lọc")}
          </button>
          {filtered ? (
            <Link href={path} className="button button-secondary">
              {text("Xóa bộ lọc")}
            </Link>
          ) : null}
          <span className="inline-toolbar-count">
            {text("{0} thiết bị", [total])}
          </span>
        </div>
        {filters.source_line_id ? (
          <p>
            {text("Đang lọc theo dòng hồ sơ nguồn {0}", [
              filters.source_line_id.slice(0, 8),
            ])}
          </p>
        ) : null}
      </form>

      {assets.length === 0 ? (
        <p className="panel-empty">
          {filtered
            ? text("Không có thiết bị nào khớp bộ lọc.")
            : text("Chưa có thiết bị cá thể nào.")}
        </p>
      ) : (
        <div className="data-panel">
          <div className="responsive-table">
            <table className="data-table records-on-phone">
              <thead>
                <tr>
                  <th>{text("Mã thiết bị")}</th>
                  <th>{text("Vật tư")}</th>
                  <th>{text("Vị trí")}</th>
                  <th>{text("Tình trạng")}</th>
                  <th>{text("Cấp phát")}</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr
                    key={asset.id}
                    className="row-link"
                    onClick={() => router.push(`${path}/${asset.id}`)}
                  >
                    <td data-label={text("Mã thiết bị")}>
                      <span className="cell-stack">
                        <Link
                          href={`${path}/${asset.id}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {asset.asset_code}
                        </Link>
                        <small>
                          {asset.manufacturer_serial
                            ? text("S/N {0}", [asset.manufacturer_serial])
                            : text("Không có S/N")}
                        </small>
                      </span>
                    </td>
                    <td data-label={text("Vật tư")}>
                      <span className="cell-stack">
                        <strong>{asset.item_name}</strong>
                        <small>
                          {[asset.item_code, asset.manufacturer, asset.model]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </span>
                    </td>
                    <td data-label={text("Vị trí")}>
                      <span className="cell-stack">
                        <span>{asset.location_name}</span>
                        <small>{asset.location_code}</small>
                      </span>
                    </td>
                    <td data-label={text("Tình trạng")}>
                      <span className="cell-stack">
                        <OperationalStatusBadge
                          status={asset.operational_status}
                        />
                        <small>
                          <LifecycleBadge status={asset.lifecycle_status} />
                        </small>
                      </span>
                    </td>
                    <td data-label={text("Cấp phát")}>
                      <AssetEligibilityBadge
                        eligible={asset.eligible}
                        available={asset.available}
                        reasons={asset.ineligibility_reasons}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PaginationControls
        currentPage={page}
        totalItems={total}
        pageSize={pageSize}
        onPageChange={(next) => go({}, next)}
      />
    </>
  );
}
