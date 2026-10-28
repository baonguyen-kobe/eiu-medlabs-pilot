"use client";
import React from "react";
import type {
  ExpiryPrecision,
  MaterialKind,
  ReturnSemantics,
  StockCondition,
  TransactionOperationType,
} from "@/lib/inventory/types";
import { evaluateExpiry } from "@/lib/inventory/dates";
import {
  LocalizedText,
  useLanguage,
} from "@/components/i18n/language-provider";

export function ActiveBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="badge badge-success inline-flex items-center gap-1 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span>
          <LocalizedText text={"Hoạt động / Active"} />
        </span>
      </span>
    );
  }
  return (
    <span className="badge badge-neutral inline-flex items-center gap-1 font-medium text-slate-500 bg-slate-100">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      <span>
        <LocalizedText text={"Ngừng HĐ / Inactive"} />
      </span>
    </span>
  );
}

export function ConditionBadge({ condition }: { condition: StockCondition }) {
  if (condition === "good") {
    return (
      <span className="badge badge-teal inline-flex items-center gap-1">
        <span>
          <LocalizedText text={"Tốt / Good"} />
        </span>
      </span>
    );
  }
  return (
    <span className="badge badge-warning inline-flex items-center gap-1 bg-amber-50 text-amber-800 border-amber-200">
      <span>
        <LocalizedText text={"Hỏng / Damaged"} />
      </span>
    </span>
  );
}

export function ExpiryBadge({
  precision,
  expiryDate,
}: {
  precision: ExpiryPrecision;
  expiryDate?: string | null;
}) {
  const evalResult = evaluateExpiry(precision, expiryDate);
  const { language } = useLanguage();
  const expiryLabel =
    language === "en" ? evalResult.labelEn : evalResult.labelVi;

  switch (evalResult.status) {
    case "valid":
      return <span className="badge badge-success">{expiryLabel}</span>;
    case "expiring_soon":
      return <span className="badge badge-amber">{expiryLabel}</span>;
    case "expired":
      return <span className="badge badge-danger">{expiryLabel}</span>;
    case "unknown":
      return (
        <span className="badge badge-warning text-amber-900 bg-amber-100 font-semibold">
          {expiryLabel}
        </span>
      );
    case "not_required":
    default:
      return (
        <span className="badge badge-neutral text-slate-400">
          {expiryLabel}
        </span>
      );
  }
}

export function MaterialKindBadge({ kind }: { kind: MaterialKind }) {
  if (kind === "chemical") {
    return (
      <span className="badge badge-indigo font-medium">
        <LocalizedText text={"Hóa chất / Chemical"} />
      </span>
    );
  }
  return (
    <span className="badge badge-neutral text-slate-600">
      <LocalizedText text={"Thông thường / Standard"} />
    </span>
  );
}

export function ReturnSemanticsBadge({
  semantics,
}: {
  semantics: ReturnSemantics;
}) {
  if (semantics === "returnable") {
    return (
      <span className="badge badge-teal">
        <LocalizedText text={"Hoàn trả / Returnable"} />
      </span>
    );
  }
  if (semantics === "nonreturnable") {
    return (
      <span className="badge badge-amber">
        <LocalizedText text={"Tiêu hao / Consumable"} />
      </span>
    );
  }
  return (
    <span className="badge badge-neutral">
      <LocalizedText text={"Tại chỗ / In-place"} />
    </span>
  );
}

export function OperationBadge({
  operation,
}: {
  operation: TransactionOperationType;
}) {
  switch (operation) {
    case "RECEIVE":
      return (
        <span className="badge badge-success">
          <LocalizedText text={"Nhận kho / RECEIVE"} />
        </span>
      );
    case "OPENING":
      return (
        <span className="badge badge-indigo">
          <LocalizedText text={"Tồn đầu kỳ / OPENING"} />
        </span>
      );
    case "CORRECT_RECEIPT":
      return (
        <span className="badge badge-amber">
          <LocalizedText text={"Điều chỉnh nhận / CORRECT"} />
        </span>
      );
    case "REVERSE_RECEIPT":
      return (
        <span className="badge badge-danger">
          <LocalizedText text={"Hủy phiếu nhận / REVERSE"} />
        </span>
      );
    case "CORRECT_OPENING":
      return (
        <span className="badge badge-warning">
          <LocalizedText text={"Điều chỉnh tồn đầu / CORRECT_OPENING"} />
        </span>
      );
    case "TRANSFER":
      return (
        <span className="badge badge-info bg-sky-50 text-sky-800 border-sky-200">
          <LocalizedText text={"Điều chuyển / TRANSFER"} />
        </span>
      );
    case "CONDITION_CHANGE":
      return (
        <span className="badge badge-warning bg-orange-50 text-orange-800 border-orange-200">
          <LocalizedText text={"Hạ phẩm cấp / DETERIORATION"} />
        </span>
      );
    case "STOCKTAKE_ADJUST":
      return (
        <span className="badge badge-purple bg-purple-50 text-purple-800 border-purple-200">
          <LocalizedText text={"Điều chỉnh kiểm kê / STOCKTAKE_ADJUST"} />
        </span>
      );
    case "STOCKTAKE_SURPLUS":
      return (
        <span className="badge badge-indigo bg-indigo-50 text-indigo-800 border-indigo-200">
          <LocalizedText text={"Dư thừa kiểm kê / STOCKTAKE_SURPLUS"} />
        </span>
      );
    case "VERIFY_SURPLUS":
      return (
        <span className="badge badge-success bg-emerald-50 text-emerald-800 border-emerald-200">
          <LocalizedText text={"Thẩm định dư thừa / VERIFY_SURPLUS"} />
        </span>
      );
    case "ASSET_RECEIVE":
      return (
        <span className="badge badge-success">
          <LocalizedText text={"Nhận tài sản / Asset receipt"} />
        </span>
      );
    case "ASSET_OPEN":
      return (
        <span className="badge badge-indigo">
          <LocalizedText text={"Tài sản đầu kỳ / Asset opening"} />
        </span>
      );
    case "ASSET_SET_STATE":
      return (
        <span className="badge badge-info">
          <LocalizedText text={"Hiện trạng tài sản / Asset state"} />
        </span>
      );
    case "ASSET_SET_LIFECYCLE":
      return (
        <span className="badge badge-warning">
          <LocalizedText text={"Vòng đời tài sản / Asset lifecycle"} />
        </span>
      );
    case "ASSET_CORRECT":
      return (
        <span className="badge badge-amber">
          <LocalizedText text={"Đính chính tài sản / Asset correction"} />
        </span>
      );
    default:
      return <span className="badge badge-neutral">{operation}</span>;
  }
}

export function HoldStatusBadge({
  isHeld,
  holdReason,
  status,
}: {
  isHeld: boolean;
  holdReason?: string | null;
  status?: "held" | "released" | "active" | string | null;
}) {
  const { text: uiText } = useLanguage();
  if (status === "released") {
    return (
      <span className="badge inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        <span>
          <LocalizedText text={"Đã giải tỏa / RELEASED"} />
        </span>
      </span>
    );
  }
  if (isHeld || status === "held" || status === "active") {
    return (
      <span
        title={
          holdReason ||
          uiText("Tạm giữ chờ thẩm định / Held awaiting admin verification")
        }
        className="badge inline-flex items-center gap-1 bg-rose-50 text-rose-800 border-rose-200 text-xs font-semibold"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
        <span>
          <LocalizedText text={"TẠM GIỮ / HELD"} />
        </span>
      </span>
    );
  }
  return (
    <span className="badge inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-medium">
      <span>
        <LocalizedText text={"Không tạm giữ"} />
      </span>
    </span>
  );
}

export function ProvenanceBadge({
  provenance,
}: {
  provenance?: string | null;
}) {
  if (!provenance) return <span className="text-slate-400 text-xs">—</span>;

  switch (provenance) {
    case "STOCKTAKE_SURPLUS":
      return (
        <span className="badge inline-flex items-center gap-1 bg-purple-50 text-purple-800 border-purple-200 text-xs font-medium">
          <LocalizedText text={"Dư thừa kiểm kê / SURPLUS"} />
        </span>
      );
    case "RECEIVE":
      return (
        <span className="badge inline-flex items-center gap-1 bg-blue-50 text-blue-800 border-blue-200 text-xs font-medium">
          <LocalizedText text={"Tiếp nhận mua / RECEIPT"} />
        </span>
      );
    case "OPENING":
      return (
        <span className="badge inline-flex items-center gap-1 bg-slate-100 text-slate-800 border-slate-300 text-xs font-medium">
          <LocalizedText text={"Tồn đầu kỳ / OPENING"} />
        </span>
      );
    default:
      return (
        <span className="badge inline-flex items-center gap-1 bg-slate-50 text-slate-700 border-slate-200 text-xs font-medium">
          {provenance}
        </span>
      );
  }
}
