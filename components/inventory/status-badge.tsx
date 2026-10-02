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
    default:
      return <span className="badge badge-neutral">{operation}</span>;
  }
}
