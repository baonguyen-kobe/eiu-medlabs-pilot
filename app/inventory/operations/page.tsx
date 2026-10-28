import React from "react";
import Link from "next/link";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead } from "@/lib/inventory/client";
import { OperationsHub } from "@/components/inventory/operations-hub";
import { InventoryPageHeader as PageHeader } from "@/components/inventory/inventory-page-header";
import type { InventoryOperationStock } from "@/lib/inventory/types";
import { LocalizedText } from "@/components/i18n/language-provider";

export default async function InventoryOperationsPage() {
  const viewer = await requireInventoryViewer();

  // Bounded stock preview and held count; selectors search locations on demand.
  const [stockRes, heldRes] = await Promise.all([
    inventoryRead<InventoryOperationStock>("operation_stock", {
      include_held: true,
      page: 1,
      page_size: 50,
    }),
    inventoryRead<InventoryOperationStock>("operation_stock", {
      is_held: true,
      include_held: true,
      page: 1,
      page_size: 1,
    }),
  ]);

  return (
    <div className="inventory-operations min-w-0 w-full space-y-6">
      <PageHeader
        title={
          <LocalizedText
            text={"Nghiệp vụ Kho Thực tế / Physical Inventory Operations"}
          />
        }
        description={
          <LocalizedText
            text={
              "Điều chuyển giữa các kho, Hạ phẩm cấp (Tốt → Hỏng), Kiểm kê đối soát thực tế và Thẩm định giải tỏa hàng thừa"
            }
          />
        }
        actions={
          <>
            <Link
              href="/inventory/stock"
              className="button button-secondary text-xs"
            >
              <LocalizedText text={"← Xem Tồn kho / Stock Balances"} />
            </Link>
            <Link
              href="/inventory/transactions"
              className="button button-secondary text-xs"
            >
              <LocalizedText text={"Lịch sử Sổ cái / Ledger →"} />
            </Link>
          </>
        }
      />

      <OperationsHub
        isAdmin={viewer.isAdmin}
        initialStock={stockRes.rows}
        heldStockCount={heldRes.total}
      />
    </div>
  );
}
