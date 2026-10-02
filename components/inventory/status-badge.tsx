import React from "react";
import type {
  ExpiryPrecision,
  MaterialKind,
  ReturnSemantics,
  StockCondition,
  TransactionOperationType,
} from "@/lib/inventory/types";
import { evaluateExpiry } from "@/lib/inventory/dates";

export function ActiveBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="badge badge-success inline-flex items-center gap-1 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span>Hoạt động / Active</span>
      </span>
    );
  }
  return (
    <span className="badge badge-neutral inline-flex items-center gap-1 font-medium text-slate-500 bg-slate-100">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      <span>Ngừng HĐ / Inactive</span>
    </span>
  );
}

export function ConditionBadge({ condition }: { condition: StockCondition }) {
  if (condition === "good") {
    return (
      <span className="badge badge-teal inline-flex items-center gap-1">
        <span>Tốt / Good</span>
      </span>
    );
  }
  return (
    <span className="badge badge-warning inline-flex items-center gap-1 bg-amber-50 text-amber-800 border-amber-200">
      <span>Hỏng / Damaged</span>
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

  switch (evalResult.status) {
    case "valid":
      return <span className="badge badge-success">{evalResult.labelVi}</span>;
    case "expiring_soon":
      return <span className="badge badge-amber">{evalResult.labelVi}</span>;
    case "expired":
      return <span className="badge badge-danger">{evalResult.labelVi}</span>;
    case "unknown":
      return (
        <span className="badge badge-warning text-amber-900 bg-amber-100 font-semibold">
          {evalResult.labelVi}
        </span>
      );
    case "not_required":
    default:
      return (
        <span className="badge badge-neutral text-slate-400">
          {evalResult.labelVi}
        </span>
      );
  }
}

export function MaterialKindBadge({ kind }: { kind: MaterialKind }) {
  if (kind === "chemical") {
    return (
      <span className="badge badge-indigo font-medium">
        Hóa chất / Chemical
      </span>
    );
  }
  return (
    <span className="badge badge-neutral text-slate-600">
      Thông thường / Standard
    </span>
  );
}

export function ReturnSemanticsBadge({
  semantics,
}: {
  semantics: ReturnSemantics;
}) {
  if (semantics === "returnable") {
    return <span className="badge badge-teal">Hoàn trả / Returnable</span>;
  }
  if (semantics === "nonreturnable") {
    return <span className="badge badge-amber">Tiêu hao / Consumable</span>;
  }
  return <span className="badge badge-neutral">Tại chỗ / In-place</span>;
}

export function OperationBadge({
  operation,
}: {
  operation: TransactionOperationType;
}) {
  switch (operation) {
    case "RECEIVE":
      return <span className="badge badge-success">Nhận kho / RECEIVE</span>;
    case "OPENING":
      return <span className="badge badge-indigo">Tồn đầu kỳ / OPENING</span>;
    case "CORRECT_RECEIPT":
      return (
        <span className="badge badge-amber">Điều chỉnh nhận / CORRECT</span>
      );
    case "REVERSE_RECEIPT":
      return (
        <span className="badge badge-danger">Hủy phiếu nhận / REVERSE</span>
      );
    case "CORRECT_OPENING":
      return (
        <span className="badge badge-warning">
          Điều chỉnh tồn đầu / CORRECT_OPENING
        </span>
      );
    case "TRANSFER":
      return (
        <span className="badge badge-info bg-sky-50 text-sky-800 border-sky-200">
          Điều chuyển / TRANSFER
        </span>
      );
    case "CONDITION_CHANGE":
      return (
        <span className="badge badge-warning bg-orange-50 text-orange-800 border-orange-200">
          Hạ phẩm cấp / DETERIORATION
        </span>
      );
    case "STOCKTAKE_ADJUST":
      return (
        <span className="badge badge-purple bg-purple-50 text-purple-800 border-purple-200">
          Điều chỉnh kiểm kê / STOCKTAKE_ADJUST
        </span>
      );
    case "STOCKTAKE_SURPLUS":
      return (
        <span className="badge badge-indigo bg-indigo-50 text-indigo-800 border-indigo-200">
          Dư thừa kiểm kê / STOCKTAKE_SURPLUS
        </span>
      );
    case "VERIFY_SURPLUS":
      return (
        <span className="badge badge-success bg-emerald-50 text-emerald-800 border-emerald-200">
          Thẩm định dư thừa / VERIFY_SURPLUS
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
  if (status === "released") {
    return (
      <span className="badge inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        <span>Đã giải tỏa / RELEASED</span>
      </span>
    );
  }
  if (isHeld || status === "held" || status === "active") {
    return (
      <span
        title={
          holdReason ||
          "Tạm giữ chờ thẩm định / Held awaiting admin verification"
        }
        className="badge inline-flex items-center gap-1 bg-rose-50 text-rose-800 border-rose-200 text-xs font-semibold"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
        <span>TẠM GIỮ / HELD</span>
      </span>
    );
  }
  return (
    <span className="badge inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-medium">
      <span>Không tạm giữ</span>
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
          Dư thừa kiểm kê / SURPLUS
        </span>
      );
    case "RECEIVE":
      return (
        <span className="badge inline-flex items-center gap-1 bg-blue-50 text-blue-800 border-blue-200 text-xs font-medium">
          Tiếp nhận mua / RECEIPT
        </span>
      );
    case "OPENING":
      return (
        <span className="badge inline-flex items-center gap-1 bg-slate-100 text-slate-800 border-slate-300 text-xs font-medium">
          Tồn đầu kỳ / OPENING
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
