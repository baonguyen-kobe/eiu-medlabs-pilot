"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LifecycleBadge,
  OperationalStatusBadge,
  AssetEligibilityBadge,
} from "./asset-status-badge";
import { AssetQrLabel } from "./asset-qr-label";
import { AssetStateForm } from "./asset-state-form";
import { AssetLifecycleForm } from "./asset-lifecycle-form";
import { AssetCorrectionForm } from "./asset-correction-form";
import { AssetHistoryView } from "./asset-history-view";
import type {
  EquipmentAsset,
  EquipmentAssetEvent,
} from "@/lib/inventory/asset-types";
import {
  describeIneligibility,
  expiryPrecisionLabels,
  labelOf,
} from "@/lib/inventory/labels";
import { useLanguage } from "@/components/i18n/language-provider";

export interface AssetDetailViewProps {
  asset: EquipmentAsset;
  events: EquipmentAssetEvent[];
  eventsTotal: number;
  eventsPage: number;
  eventsPageSize: number;
  qrSvg: string;
  isAdmin: boolean;
}

export type DetailActionTab = "state" | "lifecycle" | "correction";

/** One coded asset in the Kho record layout (owner-approved 2026-11-18). */
export function AssetDetailView({
  asset,
  events,
  eventsTotal,
  eventsPage,
  eventsPageSize,
  qrSvg,
  isAdmin,
}: AssetDetailViewProps) {
  const { text } = useLanguage();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DetailActionTab>("state");

  return (
    <div className="kho-record">
      <header className="kho-record-header">
        <div className="kho-record-head">
          <div className="kho-record-title">
            <Link href="/inventory/assets">← {text("Thiết bị cá thể")}</Link>
            <h2 className="mono">{asset.asset_code}</h2>
            <LifecycleBadge status={asset.lifecycle_status} />
            <OperationalStatusBadge status={asset.operational_status} />
            <AssetEligibilityBadge
              eligible={asset.eligible}
              available={asset.available}
              reasons={asset.ineligibility_reasons}
            />
            <span className="kho-record-sub">
              {[asset.item_name, asset.manufacturer, asset.model]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </div>
        {asset.eligible ? null : (
          <p className="kho-alert-line" role="note">
            <strong>{text("Chưa cấp phát được:")}</strong>{" "}
            {asset.ineligibility_reasons.map(describeIneligibility).join("; ")}
          </p>
        )}
      </header>

      <div className="kho-record-grid">
        <div className="kho-record-main">
          <section
            className="kho-card kho-card-pad"
            aria-labelledby="asset-now"
          >
            <h3 id="asset-now">{text("Hiện trạng")}</h3>
            <dl className="kho-facts">
              <div>
                <dt>{text("Vị trí")}</dt>
                <dd>
                  {asset.location_name} <small>{asset.location_code}</small>
                </dd>
              </div>
              <div>
                <dt>{text("Người chịu trách nhiệm")}</dt>
                <dd>{asset.custodian_name || text("Chưa giao cho ai")}</dd>
              </div>
              <div>
                <dt>{text("Hạn dùng")}</dt>
                <dd>
                  {asset.expiry_date ||
                    text(
                      labelOf(expiryPrecisionLabels, asset.expiry_precision),
                    )}
                </dd>
              </div>
              <div>
                <dt>{text("Phiên bản")}</dt>
                <dd>#{asset.revision}</dd>
              </div>
            </dl>
          </section>

          <section className="kho-card kho-card-pad" aria-labelledby="asset-id">
            <h3 id="asset-id">{text("Định danh")}</h3>
            <dl className="kho-facts kho-facts-3">
              <div>
                <dt>{text("Hãng sản xuất")}</dt>
                <dd>{asset.manufacturer || "—"}</dd>
              </div>
              <div>
                <dt>{text("Model")}</dt>
                <dd>{asset.model || "—"}</dd>
              </div>
              <div>
                <dt>{text("Số sê-ri NSX")}</dt>
                <dd>{asset.manufacturer_serial || text("Không có")}</dd>
              </div>
              <div>
                <dt>{text("Tiếp nhận")}</dt>
                <dd>
                  {asset.intake_kind === "receive"
                    ? text("Nhận kho mới")
                    : text("Tồn đầu kỳ")}
                </dd>
              </div>
              <div>
                <dt>{text("Chứng từ")}</dt>
                <dd>{asset.intake_reference}</dd>
              </div>
              <div>
                <dt>{text("Mã vật tư")}</dt>
                <dd>{asset.item_code}</dd>
              </div>
            </dl>
            {asset.source_line_id ? (
              <p>
                <Link
                  href={`/inventory/assets?source_line_id=${asset.source_line_id}`}
                >
                  {text("Các thiết bị cùng dòng hồ sơ nguồn")}
                </Link>
              </p>
            ) : null}
          </section>

          <section className="kho-card" aria-labelledby="asset-actions">
            <div className="kho-card-head">
              <h3 id="asset-actions">{text("Cập nhật thiết bị")}</h3>
              <div
                className="segmented-control kho-op-tabs"
                role="group"
                aria-label={text("Loại cập nhật")}
              >
                {(
                  [
                    ["state", "Vị trí & vận hành"],
                    ["lifecycle", "Vòng đời"],
                    ["correction", "Đính chính"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={activeTab === value}
                    className={activeTab === value ? "selected" : ""}
                    onClick={() => setActiveTab(value)}
                  >
                    {text(label)}
                  </button>
                ))}
              </div>
            </div>
            <div className="kho-card-body kho-flat">
              {activeTab === "state" ? (
                <AssetStateForm
                  asset={asset}
                  onSuccess={() => router.refresh()}
                />
              ) : null}
              {activeTab === "lifecycle" ? (
                <AssetLifecycleForm
                  asset={asset}
                  isAdmin={isAdmin}
                  onSuccess={() => router.refresh()}
                />
              ) : null}
              {activeTab === "correction" ? (
                <AssetCorrectionForm
                  asset={asset}
                  events={events}
                  isAdmin={isAdmin}
                  onSuccess={() => router.refresh()}
                />
              ) : null}
            </div>
          </section>

          <section
            className="kho-card kho-card-pad kho-flat"
            aria-label={text("Sổ cái lịch sử")}
          >
            <AssetHistoryView
              events={events}
              total={eventsTotal}
              page={eventsPage}
              pageSize={eventsPageSize}
              onPageChange={(next) =>
                router.push(`/inventory/assets/${asset.id}?page=${next}`)
              }
            />
          </section>
        </div>

        <aside className="kho-record-aside kho-aside-plain">
          <AssetQrLabel asset={asset} qrSvg={qrSvg} />
        </aside>
      </div>
    </div>
  );
}
