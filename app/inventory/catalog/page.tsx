import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead } from "@/lib/inventory/client";
import { CatalogView } from "@/components/inventory/catalog-view";
import { InventoryPageHeader as PageHeader } from "@/components/inventory/inventory-page-header";
import type { InventoryCatalogItem } from "@/lib/inventory/types";
import { LocalizedText } from "@/components/i18n/language-provider";

interface CatalogPageProps {
  searchParams: Promise<{
    q?: string;
    category_id?: string;
    active?: string;
    sort?: string;
    page?: string;
    page_size?: string;
  }>;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const viewer = await requireInventoryViewer();
  const params = await searchParams;

  const q = (params.q ?? "").trim();
  const categoryId = params.category_id?.trim() || undefined;
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

  const itemsRes = await inventoryRead<InventoryCatalogItem>("items", {
    q: q || undefined,
    category_id: categoryId,
    active,
    sort,
    page,
    page_size: pageSize,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <LocalizedText text={"Danh mục Vật tư & Nhóm / Catalog Items"} />
        }
        description={
          <LocalizedText
            text={
              "Quản lý danh mục vật tư độc lập, phân loại hóa chất bắt buộc HSD và cấu hình đơn vị tính"
            }
          />
        }
      />

      <CatalogView
        initialItems={itemsRes.rows}
        total={itemsRes.total}
        currentPage={page}
        pageSize={pageSize}
        currentQ={q}
        currentCategoryId={categoryId || ""}
        currentActive={rawActive}
        currentSort={sort || ""}
        isAdmin={viewer.isAdmin}
      />
    </div>
  );
}
