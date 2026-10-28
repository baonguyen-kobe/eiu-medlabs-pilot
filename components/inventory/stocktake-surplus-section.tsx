"use client";

import React from "react";
import { Plus, Trash2 } from "@/components/icons";
import { InventoryLookup } from "@/components/inventory/inventory-lookup";
import type {
  ExpiryPrecision,
  InventoryCatalogItem,
  StockCondition,
} from "@/lib/inventory/types";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

export interface SurplusLineItem {
  id: string;
  catalogItemId: string;
  itemCode: string;
  itemName: string;
  baseUomCode: string;
  condition: StockCondition;
  countedQuantity: string;
  expiryPrecision: ExpiryPrecision;
  expiryInput: string;
  evidenceNote: string;
}

export interface StocktakeSurplusSectionProps {
  surplusLines: SurplusLineItem[];
  evaluatedSurplusLines: Array<{
    line: SurplusLineItem;
    hasItem: boolean;
    isValid: boolean;
    error: string | null;
  }>;
  onAddSurplusLine: () => void;
  onRemoveSurplusLine: (id: string) => void;
  onUpdateSurplusLine: (id: string, updates: Partial<SurplusLineItem>) => void;
}

export function StocktakeSurplusSection({
  surplusLines,
  evaluatedSurplusLines,
  onAddSurplusLine,
  onRemoveSurplusLine,
  onUpdateSurplusLine,
}: StocktakeSurplusSectionProps) {
  const { text: uiText } = useLanguage();

  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <span>
              {uiText(
                "2. Hàng thừa Kiểm kê Không rõ nguồn gốc / Unprovenanced Surplus (",
              )}
              {surplusLines.length})
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {uiText(
              "Vật tư phát hiện thực tế tại kho nhưng không liên kết được với chứng từ nhập nào trước đây.",
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onAddSurplusLine}
          className="button button-secondary text-xs flex items-center gap-1.5"
        >
          <Plus size={14} />
          <span>{uiText("+ Thêm dòng hàng thừa (SURPLUS)")}</span>
        </button>
      </div>

      {surplusLines.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-slate-200 rounded-xl text-xs text-slate-400">
          {uiText(
            "Không có hàng thừa không rõ nguồn gốc trong đợt kiểm kê này.",
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {evaluatedSurplusLines.map(({ line, error }, idx) => (
            <div
              key={line.id}
              className="p-4 bg-purple-50/40 border border-purple-200 rounded-xl space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-purple-900 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-purple-200 text-purple-800 inline-flex items-center justify-center text-[11px]">
                    {idx + 1}
                  </span>
                  <span>
                    {uiText(
                      "Dòng hàng thừa kiểm kê (STOCKTAKE_SURPLUS) — Sẽ vào TỒN THỰC TẾ ",
                    )}
                    {"&"}
                    {uiText(" TẠM GIỮ (HOLD)")}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveSurplusLine(line.id)}
                  className="text-slate-400 hover:text-rose-600 p-1"
                  title={uiText("Xóa dòng")}
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 min-w-0">
                {/* Catalog Item Lookup */}
                <div className="lg:col-span-2 min-w-0">
                  <InventoryLookup<InventoryCatalogItem>
                    resource="items"
                    filters={{ active: true }}
                    value={line.catalogItemId}
                    label={uiText("Vật tư danh mục *")}
                    id={`surplus-item-${line.id}`}
                    placeholder={uiText("Tìm mã hoặc tên vật tư...")}
                    onSelect={(item) =>
                      onUpdateSurplusLine(line.id, {
                        catalogItemId: item.id,
                        itemCode: item.code,
                        itemName: item.name,
                        baseUomCode: item.base_uom_code,
                      })
                    }
                  />
                </div>

                {/* Condition */}
                <div className="min-w-0">
                  <label
                    htmlFor={`surplus-cond-${line.id}`}
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    {uiText("Tình trạng *")}
                  </label>
                  <select
                    id={`surplus-cond-${line.id}`}
                    value={line.condition}
                    onChange={(e) =>
                      onUpdateSurplusLine(line.id, {
                        condition: e.target.value as StockCondition,
                      })
                    }
                    className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="good">{uiText("Hàng tốt / Good")}</option>
                    <option value="damaged">
                      {uiText("Hàng hỏng / Damaged")}
                    </option>
                  </select>
                </div>

                {/* Quantity */}
                <div className="min-w-0">
                  <label
                    htmlFor={`surplus-qty-${line.id}`}
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    {uiText("Số lượng thực tế *")}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id={`surplus-qty-${line.id}`}
                      type="text"
                      value={line.countedQuantity}
                      onChange={(e) =>
                        onUpdateSurplusLine(line.id, {
                          countedQuantity: e.target.value,
                        })
                      }
                      className="w-full font-mono text-xs py-2 px-3 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-purple-500 text-right"
                    />
                    <span className="text-slate-500 text-xs font-medium">
                      {line.baseUomCode || uiText("ĐVT")}
                    </span>
                  </div>
                </div>

                {/* Expiry precision */}
                <div className="min-w-0">
                  <label
                    htmlFor={`surplus-exp-prec-${line.id}`}
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    {uiText("Độ chính xác HSD")}
                  </label>
                  <select
                    id={`surplus-exp-prec-${line.id}`}
                    value={line.expiryPrecision}
                    onChange={(e) =>
                      onUpdateSurplusLine(line.id, {
                        expiryPrecision: e.target.value as ExpiryPrecision,
                      })
                    }
                    className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="not_required">
                      {uiText("Không yêu cầu HSD")}
                    </option>
                    <option value="unknown">
                      {uiText("Chưa rõ HSD (Tạm giữ)")}
                    </option>
                    <option value="day">
                      {uiText("Theo ngày cụ thể (YYYY-MM-DD)")}
                    </option>
                    <option value="month">
                      {uiText("Theo tháng (YYYY-MM)")}
                    </option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                {/* Expiry date input if day/month */}
                {line.expiryPrecision === "day" ||
                line.expiryPrecision === "month" ? (
                  <div>
                    <label
                      htmlFor={`surplus-exp-val-${line.id}`}
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      {uiText("Hạn sử dụng (")}
                      {line.expiryPrecision === "day"
                        ? "YYYY-MM-DD"
                        : "YYYY-MM"}
                      ) *
                    </label>
                    <input
                      id={`surplus-exp-val-${line.id}`}
                      type={line.expiryPrecision === "day" ? "date" : "month"}
                      value={line.expiryInput}
                      onChange={(e) =>
                        onUpdateSurplusLine(line.id, {
                          expiryInput: e.target.value,
                        })
                      }
                      className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                ) : null}

                {/* Line evidence note */}
                <div
                  className={
                    line.expiryPrecision === "not_required" ||
                    line.expiryPrecision === "unknown"
                      ? "md:col-span-2"
                      : ""
                  }
                >
                  <label
                    htmlFor={`surplus-note-${line.id}`}
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    {uiText("Ghi chú nguồn gốc / Bằng chứng phát hiện")}
                  </label>
                  <input
                    id={`surplus-note-${line.id}`}
                    type="text"
                    value={line.evidenceNote}
                    onChange={(e) =>
                      onUpdateSurplusLine(line.id, {
                        evidenceNote: e.target.value,
                      })
                    }
                    placeholder={uiText(
                      "VD: Tìm thấy ở kệ sau tủ số 2, nguyên tem nhà sản xuất...",
                    )}
                    className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              {error ? (
                <p className="text-[11px] text-rose-600 font-medium">
                  <LocalizedText text={error ?? ""} />
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
