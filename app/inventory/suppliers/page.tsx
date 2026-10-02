import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead } from "@/lib/inventory/client";
import { SuppliersView } from "@/components/inventory/suppliers-view";
import { PageHeader } from "@/components/patterns/page-header";
import type { InventorySupplier } from "@/lib/inventory/types";

interface SuppliersPageProps {
  searchParams: Promise<{
    q?: string;
    active?: string;
    sort?: string;
    page?: string;
    page_size?: string;
  }>;
}

export default async function SuppliersPage({
  searchParams,
}: SuppliersPageProps) {
  const viewer = await requireInventoryViewer();
  const params = await searchParams;

  const q = (params.q ?? "").trim();
  const rawActive = params.active ?? "all";
  const active =
    rawActive === "active" || rawActive === "true"
      ? true
      : rawActive === "inactive" || rawActive === "false"
        ? false
        : undefined;

  const sort = params.sort?.trim() || undefined;
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(params.page_size) || 50), 100);

  const suppliersRes = await inventoryRead<InventorySupplier>("suppliers", {
    q: q || undefined,
    active,
    sort,
    page,
    page_size: pageSize,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Danh mục Nhà cung cấp / Inventory Suppliers"
        description="Quản lý thông tin nhà cung cấp phục vụ tạo hồ sơ nguồn và đối chiếu nguồn gốc vật tư"
      />

      <SuppliersView
        initialSuppliers={suppliersRes.rows}
        total={suppliersRes.total}
        currentPage={page}
        pageSize={pageSize}
        currentQ={q}
        currentActive={rawActive}
        currentSort={sort || ""}
        isAdmin={viewer.isAdmin}
      />
    </div>
  );
}
